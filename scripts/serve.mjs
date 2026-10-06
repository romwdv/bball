/**
 * Serveur statique local pour tester le build exporté.
 *
 * `next dev` ne suffit pas pour valider ce qui compte : le build de
 * `output: 'export'` se comporte différemment (routes prérendues, pas de rendu
 * dynamique), et le service worker de la phase 7 n'existera qu'en production.
 * Tester sur `pnpm dev`, c'est tester autre chose.
 *
 * Trois choix qui ne sont pas des détails :
 *
 * - **En-têtes par type de fichier.** `no-cache` sur le HTML et le manifeste,
 *   `immutable` sur les assets hashés. C'est exactement ce que demandera Nginx en
 *   phase 7 ; le tester ici évite de découvrir en production qu'un HTML périmé
 *   pointe vers un bundle supprimé.
 * - **Répertoire → `index.html`.** `trailingSlash: true` produit `out/match/` et
 *   non `out/match.html`. Sans cette règle, `/match/` répond 404 et on croit à
 *   un bug de routage alors que c'est le serveur.
 * - **HTTPS optionnel.** iOS n'ouvre **pas** IndexedDB hors contexte sécurisé :
 *   en `http://192.168.x.x`, Safari refuse la base et l'app ne démarre pas.
 *   Chrome et Firefox, eux, l'ouvrent. D'où le besoin d'un vrai certificat pour
 *   tester sur iPhone — voir le README.
 *
 * Aucune dépendance : `node:https` fait le travail. Un script d'une centaine de
 * lignes évite d'ajouter `serve` ou `http-server` au projet.
 */

import { createReadStream, existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer as createHttp } from "node:http";
import { createServer as createHttps } from "node:https";
import { networkInterfaces } from "node:os";
import {
  basename,
  dirname,
  extname,
  join,
  normalize,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "out");
const DEFAULT_PORT = 4321;

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

/**
 * @param {readonly string[]} argv
 */
function parseArgs(argv) {
  const options = {
    port: Number(process.env.PORT ?? DEFAULT_PORT),
    host: process.env.HOST ?? "0.0.0.0",
    https: process.argv.includes("--https"),
    certDir: process.env.CERT_DIR ?? ".certs",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port" && argv[i + 1] !== undefined)
      options.port = Number(argv[i + 1]);
    if (arg === "--host" && argv[i + 1] !== undefined)
      options.host = argv[i + 1];
  }

  return options;
}

// ---------------------------------------------------------------------------
// Types MIME
// ---------------------------------------------------------------------------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

/**
 * Fichiers jamais mis en cache.
 *
 * Le HTML référence les assets par leur nom hashé : le laisser en cache
 * permettrait de servir une page qui pointe vers un bundle supprimé. Le manifeste et
 * le service worker suivent la même règle, sinon une nouvelle version peut ne
 * jamais être vue.
 *
 * `sw.js` est le cas le plus important : le navigateur le met à jour en arrière-plan
 * et ne l'exécute qu'au **prochain** chargement. Le servir en cache, c'est
 * garantir que le coach utilise un service worker d'une version antérieure pour
 * le reste de la saison — avec le pré-cache d'une autre version, donc des
 * requêtes qui échouent.
 */
const NEVER_CACHED = new Set([".html", ".webmanifest", ".js.map"]);

/**
 * Fichiers en cache court, relus à chaque visite.
 *
 * `manifest.webmanifest` est déjà couvert par `NEVER_CACHED`. `manifest.json` ne
 * l'est pas, parce que ce fichier est généré par Next en route statique et non
 * déposé dans `public/` : son extension ne dit rien de son importance. Le nom,
 * lui, est explicite — d'où une liste plutôt qu'un test sur l'extension.
 */
const SHORT_CACHED = new Set(["sw-precache-manifest.json"]);

/** @param {string} path */
function contentType(path) {
  return MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
}

/** @param {string} path */
function cacheControl(path) {
  const name = basename(path).toLowerCase();

  // `sw.js` et le manifeste de pré-cache sont servis en `no-cache` : le premier
  // doit pouvoir se mettre à jour en arrière-plan, le second change à chaque
  // build. Voir `NEVER_CACHED` et `SHORT_CACHED`.
  if (name === "sw.js" || SHORT_CACHED.has(name)) return "no-cache";
  if (NEVER_CACHED.has(extname(path).toLowerCase())) return "no-cache";
  // Les assets Next sont sous `/_next/static/` et leur nom contient le hash de
  // leur contenu : ils peuvent être mis en cache indéfiniment.
  return path.includes(`${sep}_next${sep}static${sep}`)
    ? "public, max-age=31536000, immutable"
    : "public, max-age=3600";
}

// ---------------------------------------------------------------------------
// Résolution de fichier
// ---------------------------------------------------------------------------

/**
 * Empêche `../` de remonter hors de `out/`.
 *
 * @param {string} urlPath
 * @returns {string | null}
 */
function safeJoin(urlPath) {
  const decoded = decodeURIComponent(
    (urlPath.split("?")[0] ?? "/").split("#")[0],
  );
  const target = normalize(join(ROOT, decoded));
  return target === ROOT || target.startsWith(ROOT + sep) ? target : null;
}

/** @param {string} path */
function resolveFile(path) {
  if (existsSync(path) && statSync(path).isFile()) return path;

  // `/match/` → `/match/index.html`
  const index = join(path, "index.html");
  if (existsSync(index) && statSync(index).isFile()) return index;

  // Dernier recours : le 404 statique produit par l'export.
  const notFound = join(ROOT, "404.html");
  return existsSync(notFound) ? notFound : null;
}

// ---------------------------------------------------------------------------
// Serveur
// ---------------------------------------------------------------------------

function handler() {
  return (request, response) => {
    const target = safeJoin(request.url ?? "/");
    const file = resolveFile(target ?? join(ROOT, "404.html"));

    if (file === null) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("404");
      return;
    }

    response.writeHead(file.endsWith("404.html") ? 404 : 200, {
      "content-type": contentType(file),
      "cache-control": cacheControl(file),
      "x-content-type-options": "nosniff",
    });
    createReadStream(file).pipe(response);
  };
}

/** Adresses LAN, pour l'URL à taper sur le téléphone. */
function localAddresses() {
  const found = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) found.push(entry.address);
    }
  }
  return found;
}

function announce(options, scheme) {
  console.log(
    `\n  Build servi depuis out/ sur ${scheme}://localhost:${options.port}`,
  );
  for (const address of localAddresses()) {
    console.log(`  réseau local → ${scheme}://${address}:${options.port}`);
  }
  if (scheme === "http") {
    console.log(
      "\n  ⚠️  iPhone/iPad : Safari refuse d'ouvrir IndexedDB en HTTP.\n" +
        "     Android et desktop fonctionnent ; pour iOS, utilisez --https.",
    );
  }
  console.log("");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!existsSync(ROOT)) {
    console.error("out/ est absent — lance `pnpm build` d'abord.");
    process.exit(1);
  }

  const scheme = options.https ? "https" : "http";

  if (!options.https) {
    createHttp(handler()).listen(options.port, options.host, () =>
      announce(options, scheme),
    );
    return;
  }

  // Le nom de fichier suit l'hôte : un certificat valable pour `192.168.1.20`
  // n'est pas valable pour `192.168.1.21`, et mkcert les génère séparément.
  const key = join(options.certDir, `${options.host}-key.pem`);
  const cert = join(options.certDir, `${options.host}.pem`);
  if (!existsSync(key) || !existsSync(cert)) {
    console.error(
      `Certificats introuvables : ${key} et ${cert}\n` +
        `Génère-les avec mkcert (voir README.md), puis réessaie.`,
    );
    process.exit(1);
  }

  createHttps(
    { key: await readFile(key), cert: await readFile(cert) },
    handler(),
  ).listen(options.port, options.host, () => announce(options, scheme));
}

void main();
