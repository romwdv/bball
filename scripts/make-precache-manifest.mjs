/**
 * Manifeste de pré-cache, généré après le build.
 *
 * Le service worker doit connaître la liste exacte des fichiers à mettre en cache
 * au premier lancement. Cette liste ne peut pas être écrite à la main : elle
 * dépend du hash de chaque bundle, qui change à chaque build. D'où ce script,
 * exécuté en post-build.
 *
 * ```
 * node scripts/make-precache-manifest.mjs
 * ```
 *
 * Deux décisions qui méritent d'être expliquées.
 *
 * **Les pages HTML sont incluses.** C'est contre-intuitif — un service worker
 * classique ne précache que les assets. Ici, sans page mise en cache, un
 * rechargement hors-ligne n'a rien à afficher : l'app est une application
 * monopage dont *chaque* écran est un fichier HTML distinct (`output: 'export'`
 * + `trailingSlash`). Les précacher, c'est ce qui permet d'ouvrir `/match/` en
 * mode avion et de retrouver le match en cours.
 *
 * **Rien n'est ignoré, et c'est délibéré.** Un `ignore` typographique (« tout
 * sauf `*.map` ») ne romprait qu'après le premier build qui produirait un format
 * inattendu, en silence. La liste est donc exhaustive, et les exclusions sont
 * nommées une par une, avec leur raison.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Dossier à parcourir.
 *
 * `PRECACHE_OUT` permet aux tests de pointer un dossier temporaire. La variable
 * est lisible depuis l'extérieur, donc c'est une interface — pas un échappatoire :
 * le build de production ne la définit pas, et se comporte donc comme avant.
 */
const OUT = process.env.PRECACHE_OUT ?? join(ROOT, "out");

/**
 * Fichiers exclus du pré-cache, par chemin relatif à `out/`.
 *
 * `sw.js` lui-même : un service worker ne doit pas se mettre en cache. Il doit
 * pouvoir être remplacé, et un cache de l'ancienne version le bloquerait — c'est
 * le mécanisme qui produit un worker bloqué indéfiniment.
 */
/**
 * `sw-precache-manifest.json` s'auto-exclut, et c'est obligatoire.
 *
 * Sans cela, le fichier d'un build précédent se retrouve dans la liste du build
 * suivant, et son contenu — qui contient la révision — entre dans le calcul de la
 * révision suivante. La révision ne serait alors plus reproductible : deux builds
 * successifs du même code donneraient deux valeurs différentes, donc le coach
 * réinstallerait tout le pré-cache à chaque déploiement.
 */
const EXCLUDED = new Set(["sw.js", "sw-precache-manifest.json"]);

/**
 * Extensions exclues, et pourquoi.
 *
 * Les source maps ne sont ni nécessaires au fonctionnement ni volumineuses à
 * envoyer au coach : un navigator les télécharge, et il n'en a aucun usage.
 */
const EXCLUDED_EXTENSIONS = new Map([[".map", "source map, jamais exécutée"]]);

/**
 * Le fichier est-il un artefact de développement ?
 *
 * Un fichier BuildManifest ou un `.txt` de métadonnées ne sert à rien au client
 * et ne doit pas être gelé dans le cache : leVersions bump est inutile.
 */
function isArtifact(relativePath) {
  const dot = relativePath.lastIndexOf(".");
  if (dot === -1) return false;
  const extension = relativePath.slice(dot).toLowerCase();
  return EXCLUDED_EXTENSIONS.has(extension);
}

/**
 * Liste récursive des fichiers d'un dossier.
 *
 * Le tri final n'est pas cosmétique : `sw.js` installe le pré-cache dans l'ordre
 * donné, et deux installations concurrentes sur des navigateurs différents
 * produiraient des caches différents à partir des mêmes fichiers. Un tri rend le
 * résultat reproductible.
 *
 * @param {string} directory
 * @returns {string[]} chemins relatifs, séparés `/`
 */
function walk(directory) {
  const found = [];

  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      found.push(...walk(absolute));
    } else {
      found.push(relative(OUT, absolute).split(sep).join("/"));
    }
  }

  return found.sort();
}

const files = walk(OUT).filter((path) => {
  if (EXCLUDED.has(path)) return false;
  return !isArtifact(path);
});

if (files.length === 0) {
  console.error(
    "out/ est vide — le manifeste de pré-cache ne peut pas être construit. " +
      "Lancer `pnpm build` avant ce script.",
  );
  process.exit(1);
}

/**
 * Version du pré-cache : le hash des contenus, pas la date.
 *
 * Indexed `Date.now()` ferait reinstaller le cache à chaque build, donc vider
 * et retélécharger 200 ko à chaque déploiement — en gymnase, sur une connexion
 * qui est déjà le point faible. Le hash ne change que si un fichier change
 * réellement, donc un déploiement sans changement ne coûte rien.
 */
const version = createHash("sha256");
for (const path of files) {
  version.update(path);
  version.update(readFileSync(join(OUT, path)));
}
const revision = version.digest("hex").slice(0, 12);

/**
 * Les fichiers, avec leur revision.
 *
 * Le `revision` par fichier permet à `sw.js` de comparer la liste qu'il reçoit à
 * celle qu'il a, et de ne télécharger que ce qui manque. Sans lui, un changement
 * du seul `sw.js` forcerait de retélécharger tout le pré-cache.
 */
const entries = files.map((path) => ({
  url: `/${path}`,
  revision,
}));

/**
 * Chaque route HTML est déclarée **deux fois** : par le fichier et par le chemin
 * de dossier.
 *
 * `trailingSlash: true` fait que l'application est servie en `/match/`, alors que
 * le fichier sur disque est `/match/index.html`. Le service worker doit répondre
 * sur le chemin que le navigateur demande, pas sur celui du fichier — sinon le
 * pré-cache est complet et la page hors-ligne introuvable.
 *
 * Une entrée `directory: true` marque la seconde : à la construction elle est
 * ignorée (le dossier n'est pas un fichier), mais en ligne elle sert à retrouver
 * le bon chemin depuis un nom lisible.
 */
for (const entry of entries) {
  const match = /^\/(.*)\/index\.html$/.exec(entry.url);
  if (match === null) continue;

  entries.push({
    url: `/${match[1]}/`,
    // Le même contenu, donc la même révision : c'est un alias, pas une copie.
    revision: entry.revision,
    directory: true,
  });
}

entries.sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));

const manifest = {
  revision,
  generatedAt: new Date().toISOString(),
  files: entries,
};

writeFileSync(
  join(OUT, "sw-precache-manifest.json"),
  `${JSON.stringify(manifest)}\n`,
);

// Seuls les vrais fichiers sont comptés : les alias de dossier pèsent zéro octet.
const bytes = files.reduce(
  (total, path) => total + statSync(join(OUT, path)).size,
  0,
);

console.log(
  `sw-precache-manifest.json  révision ${revision}  ` +
    `${files.length} fichiers (${entries.length} entrées)  ` +
    `${(bytes / 1024).toFixed(0)} ko`,
);
