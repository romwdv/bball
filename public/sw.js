/*
 * Service worker — mode hors-ligne.
 *
 * Écrit à la main, sans Workbox ni next-pwa, pour deux raisons :
 *
 * 1. **La surface à couvrir est minuscule.** Un cache, deux stratégies, un cycle
 *    de mise à jour. La bibliothèque qui ferait cela ferait aussi 40 ko de
 *    runtime, des règles déclaratives, et un fichier de configuration à maintenir
 *    en plus. L'apport serait négatif.
 * 2. **Le piège de `output: 'export'` est invisible dans une abstraction.** Next
 *    exporte une page HTML par route, sans route handler : la stratégie de cache
 *    doit savoir que `/match/` est un fichier, pas un appel serveur. Une
 *    configuration générique ne le sait pas et « fonctionne » en local.
 *
 * Ce qu'il fait, en une phrase : **les fichiers du pré-cache sont disponibles
 * immédiatement, les navigations vont d'abord au réseau, et rien n'échoue
 * silencieusement.**
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Version du format de données attendu. Un changement invalide le cache. */
const CACHE_FORMAT = "v1";

/** Nom du cache. Volontairement versionné : le vider est la mise à jour. */
const CACHE_NAME = `space-bunny-${CACHE_FORMAT}`;

/**
 * Fichiers à précacher, injectés à la construction.
 *
 * La liste vient de `sw-precache-manifest.json`, produit par le script de
 * post-build. Elle est vide dans la source : `sw.js` est volontairement versionné
 * tel quel, et le manifeste est régénéré à chaque build.
 */
const PRECACHE_MANIFEST = "/sw-precache-manifest.json";

/**
 * Page de repli quand une navigation échoue et que rien n'est en cache.
 *
 * Chemin de **dossier**, comme celui que le navigateur demande. La résolution
 * vers le fichier réel est faite par `fileForRoute()`.
 */
const OFFLINE_PAGE = "/~offline/";

/**
 * Les requêtes vers Supabase ne sont **jamais** mises en cache.
 *
 * Le cache est la déduction d'une réponse HTTP ; or une session et un jeton ne
 * se déduisent pas. Une ligne d'outbox servie depuis le cache au lieu du serveur
 * serait vidée de sa file et jamais acquittée — donc perdue, définitivement, sans
 * trace. C'est le seul endroit où une stratégie « tout cacher » causerait une
 * perte de données, et c'est exactement ce que ce projet s'interdit.
 */
const NEVER_CACHE = ["supabase.co"];

/**
 * Les requêtes qui ne valent pas la peine d'être mises en cache.
 *
 * Le service worker de Next en est un : il gère son propre cycle de vie et
 * n'a rien à faire dans le nôtre. Le laisser passer change le comportement des
 * assets selon un état qu'on ne contrôle pas.
 */
const IGNORED = ["/_next/webpack-hmr", "/__nextjs", "hot-update"];

// ---------------------------------------------------------------------------
// Cycle de vie
// ---------------------------------------------------------------------------

/** Manifeste courant, mis en cache à la première installation. */
let precache = { revision: "unknown", files: [] };

/**
 * Télécharge le manifeste de pré-cache, enProfitant du cache HTTP s'il est déjà
 * là : il est servi en `no-cache`, donc revalidé, donc disponible même hors-ligne
 * à la réinstallation.
 */
async function loadManifest() {
  try {
    const response = await fetch(PRECACHE_MANIFEST, { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn("[sw] manifeste indisponible", error);
    return { revision: "unknown", files: [] };
  }
}

/**
 * Installe le pré-cache.
 *
 * `cache.addAll` en une fois est volontairement évité : il est **atomique**, donc
 * si un seul fichier manque — un déploiement qui a retiré un vieux bundle —
 * rien n'est mis en cache et l'app ne démarre jamais hors-ligne. Chaque fichier
 * est donc mis en cache individuellement, avec son `Promise.allSettled` : au
 * pire, on perd un fichier, jamais l'install.
 */
async function precacheAll(cache, files) {
  const results = await Promise.allSettled(
    files.map(async (entry) => {
      // Un alias de dossier n'a pas de fichier derrière lui : `/match/` est servi
      // par Nginx depuis `/match/index.html`. Le mettre en cache tel quel
      // renverrait un 404, donc un pré-cache partiel — sans conséquence visible,
      // puisque c'est la stratégie réseau qui sert cette route.
      if (entry.directory === true) return;

      // `cache: "reload"` force la lecture réseau et contourne le cache HTTP :
      // installer une version périmée est pire que ne rien installer, car le
      // navigateur affiche quand même l'installation comme réussie.
      const response = await fetch(entry.url, { cache: "reload" });
      if (!response.ok) {
        throw new Error(`${entry.url} → HTTP ${response.status}`);
      }
      await cache.put(entry.url, response);
    }),
  );

  const failed = results.filter((result) => result.status === "rejected").length;
  if (failed > 0) {
    console.warn(`[sw] ${failed} fichier(s) non précachés sur ${files.length}`);
  }
}

/** Un nouveau worker est prêt : on prend la place immédiatement. */
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      precache = await loadManifest();
      indexPrecache(precache.files);
      const cache = await caches.open(CACHE_NAME);
      await precacheAll(cache, precache.files);
      // Sans ce `skipWaiting`, un worker déjà installé continuerait de servir
      // l'ancienne version jusqu'à la fermeture de **toutes** les fenêtres. Sur un
      // téléphone, c'est une saison entière.
      await self.skipWaiting();
    })(),
  );
});

/** Supprime les caches des versions précédentes. */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          // Le pré-cache courant est conservé ; tout le reste est d'une autre
          // version et ne sert plus à rien.
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Le coach a fermé puis rouvert l'app : on lui dit de recharger. */
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

// ---------------------------------------------------------------------------
// Stratégies
// ---------------------------------------------------------------------------

/** La requête touche-t-elle Supabase, ou est-elle du bruit de développement ? */
function isExcluded(url) {
  return (
    NEVER_CACHE.some((needle) => url.href.includes(needle)) ||
    IGNORED.some((needle) => url.pathname.includes(needle))
  );
}

/** Un fichier du pré-cache est immuable : son URL contient son hash. */
function isPrecached(url) {
  return precache.files.some((entry) => entry.url === url.pathname);
}

/**
 * Retrouve le fichier du pré-cache correspondant à un chemin de route.
 *
 * `/match/` est demandé, `/match/index.html` est stocké. Sans cette résolution,
 * le repli hors-ligne ne trouverait jamais la page — et le symptôme serait
 * « ça marche sur l'accueil mais pas en plein match », ce qui ne donne aucune
 * piste sur la cause.
 *
 * Le cache est indexé une fois par révision : sans cela, chaque requête
 * parcourait la totalité des entrées du manifeste.
 */
let precacheIndex = new Map();

function indexPrecache(files) {
  precacheIndex = new Map();
  for (const entry of files) {
    if (entry.directory === true) continue;
    precacheIndex.set(entry.url, entry);
  }
}

function fileForRoute(pathname) {
  const direct = precacheIndex.get(pathname);
  if (direct !== undefined) return direct.url;

  // Route de dossier : `/match/` → `/match/index.html`.
  const index = precacheIndex.get(`${pathname}index.html`);
  return index === undefined ? null : index.url;
}

/**
 * **Cache-first** sur les fichiers précachés et les assets hashés.
 *
 * Le nom des bundles Next contient le hash de leur contenu : si l'URL est la
 * même, le contenu est le même, forever. Le réseau n'apporterait rien, et en gymnasie
 * il est souvent absent.
 */
async function cacheFirst(request, cache) {
  const cached = await cache.match(request);
  if (cached !== undefined) return cached;

  try {
    const response = await fetch(request);
    // Seuls les succès et les 404 sont mis en cache : un 500 enregistrerait une
    // erreur comme une page valide, et le coach la verrait jusqu'au
    // rechargement suivant.
    if (response.ok || response.status === 404) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return Response.error();
  }
}

/**
 * **Network-first** sur les navigations, repli sur le cache, puis sur la page
 * hors-ligne.
 *
 * L'ordre est réseau d'abord, contrairement à l'intuition d'un cache-first. La
 * raison est que chaque route est un HTML distinct : un cache-first servirait
 * `/match/index.html` pour `/history/` — l'écran de saisie affiché à la place de
 * l'historique. Le réseau d'abord garantit un HTML à jour quand il y a du réseau,
 * ce qui est le cas le plus fréquent ; le cache ne sert que lorsque le réseau
 * manque, exactement quand il n'y a pas d'alternative.
 */
async function navigationStrategy(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);
    if (response.ok) {
      // Le HTML est mis en cache pour le prochain hors-ligne. En navigation
      // uniquement : un `fetch` de données ne doit pas polluer le cache.
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Le réseau a échoué : le cache d'abord, puis la page de repli.
    const cached = await cache.match(request);
    if (cached !== undefined) return cached;

    // Le chemin demandé peut être un dossier alors que le cache a le fichier.
    const routed = fileForRoute(new URL(request.url).pathname);
    if (routed !== null) {
      const file = await cache.match(routed);
      if (file !== undefined) return file;
    }

    const offlineFile = fileForRoute(OFFLINE_PAGE);
    const offline =
      offlineFile === null ? undefined : await cache.match(offlineFile);
    if (offline !== undefined) return offline;

    // Dernier recours : une réponse synthétique, plutôt qu'une promesse rejetée
    // qui laisserait le navigateur afficher son erreur brute en anglais.
    return new Response("<h1>Hors-ligne</h1>", {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}

// ---------------------------------------------------------------------------
// Routage
// ---------------------------------------------------------------------------

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Seules les requêtes `GET` sont interceptées. Les autres méthodes peuvent être
  // des écritures, qu'un cache ne doit jamais détourner.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isExcluded(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(navigationStrategy(request));
    return;
  }

  // `cache-first` sur tout le reste, qui est constitué des assets hashés.
  if (isPrecached(url) || url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        return cacheFirst(request, cache);
      })(),
    );
  }
});
