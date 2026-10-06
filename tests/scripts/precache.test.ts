import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Tests du manifeste de pré-cache.
 *
 * Ce fichier n'est pas de la documentation : c'est l'entrée du seul mécanisme qui
 * décide de ce que le coach pourra ouvrir **sans réseau**. Une liste fausse ne
 * produit aucune erreur — le navigateur installe le service worker, l'application
 * démarre, et le rechargement hors-ligne échoue des minutes plus tard, en
 * gymnase.
 *
 * Les tests tournent sur un dossier temporaire, pas sur `out/` : la version
 * installée du projet n'est pas un sujet de test, et la lire rendrait les tests
 * dépendants de l'ordre des commandes.
 */

const SCRIPT = join(process.cwd(), "scripts", "make-precache-manifest.mjs");

let workspace: string;

beforeEach(() => {
  workspace = join(
    process.cwd(),
    ".vitest",
    `precache-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(join(workspace, "_next", "static", "chunks"), { recursive: true });
  mkdirSync(join(workspace, "match"), { recursive: true });
  mkdirSync(join(workspace, "~offline"), { recursive: true });
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function write(relativePath: string, content: string): void {
  const absolute = join(workspace, relativePath);
  mkdirSync(join(absolute, ".."), { recursive: true });
  writeFileSync(absolute, content);
}

/**
 * Lance le script sur le dossier temporaire.
 *
 * `cwd` et un `space` temporaire : le script résout ses chemins depuis son propre
 * emplacement, il faut donc pointer `out/` quelque part de contrôlable. Un
 * `process.chdir` serait plus simple mais global, donc incompatible avec une
 * exécution parallèle.
 */
function run(): { revision: string; files: Array<Record<string, unknown>> } {
  const output = execFileSync("node", [SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, PRECACHE_OUT: workspace },
  });
  void output;
  return JSON.parse(
    readFileSync(join(workspace, "sw-precache-manifest.json"), "utf8"),
  ) as { revision: string; files: Array<Record<string, unknown>> };
}

/** Un `out/` minimal mais réaliste : deux pages, un dossier de route, des assets. */
function seedOut(): void {
  write("index.html", "<html>accueil</html>");
  write("match/index.html", "<html>match</html>");
  write("match/index.txt", "match rsc");
  write("~offline/index.html", "<html>hors-ligne</html>");
  write("sw.js", "// service worker");
  write("favicon.ico", "ico");
  write("icons/icon-192.png", "png");
  write("_next/static/chunks/app.js", "console.log(1)");
  write("_next/static/chunks/app.js.map", "{}");
}

describe("manifeste de pré-cache", () => {
  it("refuse de tourner sur un dossier vide", () => {
    // Un dossier vide signifie un build interrompu. Écrire un manifeste vide
    // produirait un service worker qui s'installe sans rien, et l'application
    // ne démarrerait jamais hors-ligne — silencieusement.
    expect(() => run()).toThrow();
  });

  it("inclut les pages HTML, pas seulement les assets", () => {
    seedOut();
    const urls = run().files.map((entry) => entry.url as string);

    // Sans les pages, le rechargement hors-ligne n'a rien à afficher : le
    // `output: 'export'` produit une page HTML par route.
    expect(urls).toContain("/index.html");
    expect(urls).toContain("/match/index.html");
    expect(urls).toContain("/~offline/index.html");
  });

  it("exclut le service worker lui-même", () => {
    seedOut();
    const urls = run().files.map((entry) => entry.url as string);

    // Un service worker ne doit pas se mettre en cache : il doit pouvoir être
    // remplacé, et un cache de l'ancienne version le bloquerait.
    expect(urls).not.toContain("/sw.js");
  });

  it("s'auto-exclut, pour rester reproductible", () => {
    seedOut();
    const first = run().revision;
    const second = run().revision;

    // Le manifeste d'un build précédent ne doit pas entrer dans le calcul de la
    // révision du suivant : deux builds du même code donneraient sinon deux
    // révisions différentes, donc un réinstallation complète à chaque déploiement.
    expect(second).toBe(first);
  });

  it("exclut les source maps", () => {
    seedOut();
    const urls = run().files.map((entry) => entry.url as string);
    expect(urls.some((url) => url.endsWith(".js.map"))).toBe(false);
  });

  it("déclare chaque route deux fois : fichier et dossier", () => {
    seedOut();
    const entries = run().files;

    // `trailingSlash: true` sert `/match/` alors que le fichier est
    // `/match/index.html`. Sans l'alias, le pré-cache serait complet et la page
    // hors-ligne introuvable — le symptôme le plus déroutant possible.
    const file = entries.find((entry) => entry.url === "/match/index.html");
    const alias = entries.find((entry) => entry.url === "/match/");

    expect(file).toBeDefined();
    expect(alias).toBeDefined();
    expect(alias?.directory).toBe(true);
    // Même contenu, donc même révision : c'est un alias, pas une copie.
    expect(alias?.revision).toBe(file?.revision);
  });

  it("trie les entrées, pour un pré-cache reproductible", () => {
    seedOut();
    const urls = run().files.map((entry) => entry.url as string);
    expect(urls).toEqual([...urls].sort());
  });

  it("change de révision dès qu'un contenu change", () => {
    seedOut();
    const before = run().revision;

    write("index.html", "<html>accueil modifié</html>");
    const after = run().revision;

    // La révision est le hash des contenus, pas la date : un déploiement sans
    // changement ne doit pas forcer le coach à retélécharger 1,7 Mo.
    expect(after).not.toBe(before);
  });

  it("change de révision quand un fichier est ajouté", () => {
    seedOut();
    const before = run().revision;

    // Un chunk supplémentaire doit invalider le cache : sans cela, le nouveau
    // fichier ne serait jamais servi hors-ligne et la page resterait bloquée sur
    // une erreur de chargement. La révision change donc bien — c'est le coût
    // assumé d'un `next build`, qui produit toujours le même jeu de chunks.
    write("icons/icon-512.png", "png 512");
    const after = run().revision;

    expect(after).not.toBe(before);
    expect(run().files.map((entry) => entry.url)).toContain(
      "/icons/icon-512.png",
    );
  });

  it("n'inclut que des chemins sous le dossier parcouru", () => {
    seedOut();
    // Aucun `../` dans les URLs : un chemin remontant hors de `out/` ferait
    // porter le pré-cache à un fichier que le service worker ne peut pas servir.
    for (const entry of run().files) {
      expect(String(entry.url).startsWith("/")).toBe(true);
      expect(String(entry.url)).not.toContain("..");
    }
  });
});
