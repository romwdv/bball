/**
 * Budget de bundle — vérifié après chaque build.
 *
 * ```
 * node scripts/check-bundle.mjs
 * ```
 *
 * ## Pourquoi un budget
 *
 * La phase 8 demande de « vérifier le budget de bundle au build ». Une simple
 * impression d'écran ne protège de rien : la régression arrive par un
 * `import` oublié, un `lodash` qui traîne, une mise à jour de dépendance — et
 * personne ne le voit avant que le coach attende trente secondes à l'ouverture,
 * en gymnase, sur un réseau qui est déjà le point faible du produit.
 *
 * Un budget **échoue le build**. C'est le seul moyen qu'il serve à quelque
 * chose.
 *
 * ## Ce qui est mesuré, et pourquoi
 *
 * **Le poids gzippé, pas le poids brut.** C'est ce que reçoit le téléphone. Un
 * chiffre brut de 1,4 Mo donne une fausse impression de catastrophe alors que le
 * coach télécharge 400 ko — et inversement, un budget en brut tolère des
 * polyfillsafes qu'on ne verrait jamais.
 *
 * **Le premier écran, pas le total.** Le total du build inclut le service
 * worker, les icônes et les fichiers RSC : il ne dit rien de ce que le coach
 * attend. Ce qui compte est le JavaScript et le CSS **référencés par le HTML de
 * l'accueil**, c'est-à-dire ce que le navigateur télécharge avant le premier
 * rendu utilisable.
 *
 * **Un seuil en dur, pas une tendance.** 400 ko est une décision, pas une
 * mesure. Elle vient du fait que l'application doit démarrer vite sur une
 * connexion de 1 Mbit/s : à 400 ko gzippés, le premier rendu arrive en trois
 * secondes ; à 600 ko, en cinq — et l'utilisateur a déjà refermé l'onglet.
 *
 * ## Les polyfills
 *
 * Le build embarque ~120 ko gzippés de polyfills `core-js`. C'est le coût d'un
 * `browserslist` absent : Next qui vise « tous les navigateurs » inclut IE 11 et
 * d'anciennes versions de Safari qui ont besoin de `Promise`, `Symbol`,
 * `Array.from` et consorts.
 *
 * L'application ne les a pas besoin — le plan (phase 2) pose déjà iOS 15.4+ comme
 * cible à cause de `crypto.randomUUID`. Voir `browserslist` dans `package.json`.
 */

// ---------------------------------------------------------------------------
// Seuils
// ---------------------------------------------------------------------------

/**
 * Poids gzippé maximal du premier écran, en kilo-octets.
 *
 * 400 ko ≈ 3 secondes sur une connexion de 1 Mbit/s, ce qui correspond à la
 * qualité de réseau d'une salle de sport. Un seul kilo-octet de plus se sent sur
 * un téléphone d'entrée de gamme.
 */
const FIRST_LOAD_BUDGET_KB = 400;

/**
 * Poids gzippé maximal du JavaScript total.
 *
 * Le premier écran est le budget qui compte au quotidien ; celui-ci sert de
 * garde-fou long terme. Il est plus large que le premier parce qu'il inclut ce
 * qui n'est chargé qu'en navigation (historique, statistiques).
 */
const TOTAL_JS_BUDGET_KB = 500;

/** Marge tolérée au-dessus du budget, en pourcentage. */
const TOLERANCE_PERCENT = 5;

// ---------------------------------------------------------------------------
// Mesure
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "out");

/**
 * Taille gzippée, en kilo-octets.
 *
 * `gzipSync` de `node:zlib` et non l'outil système : la mesure est alors la même
 * sur une machine de développement, sur le VPS de build et sur une CI, et le
 * budget ne dépend pas de la version de gzip installée.
 */
function gzipKb(path) {
  return gzipSync(readFileSync(path), { level: 9 }).length / 1024;
}

/** Tous les fichiers d'un dossier, récursivement. */
function walk(directory) {
  const found = [];
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) found.push(...walk(absolute));
    else found.push(absolute);
  }
  return found;
}

/**
 * Les ressources référencées par une page.
 *
 * Le HTML est lu et les `src`/`href` extraits, puis résolus relativement à la
 * page — un bundle peut être référencé par `./`, `/`, ou par une base. Cette
 * lecture est volontairement **naïve** : elle suit ce que le navigateur suit.
 * Une analyse complète de graphe serait ici de la sur-ingénierie, et surtout
 * mesurerait des fichiers que le navigateur ne demandera pas.
 */
function firstLoadResources(htmlPath) {
  const html = readFileSync(htmlPath, "utf8");
  const base = dirname(htmlPath);
  const found = new Set();

  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const reference = match[1];
    if (reference === undefined) continue;
    // Les URL absolues pointent hors du build : CDN, données, ancres.
    if (/^(https?:)?\/\//.test(reference) || reference.startsWith("data:"))
      continue;
    if (reference.startsWith("#")) continue;
    // Next sépare le nom de fichier de sa version par un point d'interrogation :
    // `/favicon.ico?favicon.3t6_grndc7gt8.ico`. Le navigateur ignore la requête,
    // le disque non — il faut donc la retirer avant de résoudre.
    const path = reference.split("?")[0];
    if (path === undefined || path === "") continue;

    const resolved = path.startsWith("/") ? join(OUT, path) : join(base, path);
    found.add(resolved);
  }

  // Seuls les fichiers **présents** : une référence cassée ne se télécharge
  // pas, donc elle ne pèse rien. next/image et les liens conditionnels en
  // produisent.
  return [...found].filter((path) => {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  });
}

// ---------------------------------------------------------------------------
// Rapport
// ---------------------------------------------------------------------------

if (!statSync(OUT).isDirectory()) {
  console.error("out/ est absent. Lancer `pnpm build` avant ce script.");
  process.exit(1);
}

const staticDir = join(OUT, "_next", "static");
const allJs = walk(join(staticDir, "chunks"))
  .concat(walk(staticDir).filter((path) => path.endsWith(".js")))
  .filter((path, index, list) => list.indexOf(path) === index);
const allCss = walk(staticDir).filter((path) => path.endsWith(".css"));

const homeHtml = join(OUT, "index.html");
const firstLoad = [...new Set([...firstLoadResources(homeHtml), ...allCss])]
  // Les `.txt` RSC ne sont pas exécutés : ils pèsent au build, pas au premier
  // rendu. Les compter ici ferait dépendre le budget de l'implémentation de
  // routage de Next.
  .filter((path) => !path.endsWith(".txt"));

const firstLoadJs = firstLoad.filter((path) => path.endsWith(".js"));
const firstLoadKb = firstLoad.reduce((total, path) => total + gzipKb(path), 0);
const firstLoadJsKb = firstLoadJs.reduce(
  (total, path) => total + gzipKb(path),
  0,
);
const cssKb = firstLoad
  .filter((path) => path.endsWith(".css"))
  .reduce((total, path) => total + gzipKb(path), 0);
const totalJsKb = allJs.reduce((total, path) => total + gzipKb(path), 0);

const relativeOf = (path) => relative(OUT, path).split(sep).join("/");

// ---------------------------------------------------------------------------

console.log("Poids gzippé\n");
console.log(
  `  premier écran   ${firstLoadKb.toFixed(1)} ko  (budget ${FIRST_LOAD_BUDGET_KB} ko)`,
);
console.log(`    dont JS       ${firstLoadJsKb.toFixed(1)} ko`);
console.log(`    dont CSS      ${cssKb.toFixed(1)} ko`);
console.log(
  `  JS total        ${totalJsKb.toFixed(1)} ko  (budget ${TOTAL_JS_BUDGET_KB} ko)`,
);

if (process.env.BUNDLE_REPORT === "1") {
  console.log("\nDétail du premier écran\n");
  for (const path of firstLoad.sort((a, b) => gzipKb(b) - gzipKb(a))) {
    console.log(
      `  ${gzipKb(path).toFixed(1).padStart(7)} ko  ${relativeOf(path)}`,
    );
  }
  console.log("\nCinq plus gros chunks du build\n");
  for (const path of [...allJs]
    .sort((a, b) => gzipKb(b) - gzipKb(a))
    .slice(0, 5)) {
    console.log(
      `  ${gzipKb(path).toFixed(1).padStart(7)} ko  ${relativeOf(path)}`,
    );
  }
}

// ---------------------------------------------------------------------------

const over = [];

if (firstLoadKb > FIRST_LOAD_BUDGET_KB * (1 + TOLERANCE_PERCENT / 100)) {
  over.push(
    `premier écran : ${firstLoadKb.toFixed(1)} ko > ${FIRST_LOAD_BUDGET_KB} ko`,
  );
}

if (totalJsKb > TOTAL_JS_BUDGET_KB * (1 + TOLERANCE_PERCENT / 100)) {
  over.push(`JS total : ${totalJsKb.toFixed(1)} ko > ${TOTAL_JS_BUDGET_KB} ko`);
}

if (over.length > 0) {
  console.error(
    `\nBudget dépassé :\n${over.map((line) => `  · ${line}`).join("\n")}\n\n` +
      "Lancer `BUNDLE_REPORT=1 node scripts/check-bundle.mjs` pour le détail.\n" +
      "Les polyfills sont la cause la plus fréquente : vérifier `browserslist`.",
  );
  process.exit(1);
}

console.log("\n✅ Budget respecté.");
