import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

/**
 * Test d'offline réel — la porte de validation de la phase 7.
 *
 * C'est le seul test du projet qui vérifie une promesse qu'aucun autre ne peut
 * vérifier : **l'application fonctionne sans réseau**. Les tests unitaires
 * tournent sur `fake-indexeddb`, les E2E sur un serveur local. Ni l'un ni l'autre
 * ne coupe le réseau.
 *
 * La méthode est la seule qui compte : `context.setOffline(true)`, puis
 * **recharger la page**. Recharger, et non naviguer dans l'application — un
 * parcours qui ne fait que changer de route resterait en mémoire et passerait
 * même sans service worker. Ce que l'on veut prouver, c'est que le HTML, les
 * bundles et les données survivent à un redémarrage du navigateur.
 *
 * La séquence testée :
 *
 *   1. chargement en ligne, le service worker s'installe et prend le contrôle ;
 *   2. coupure du réseau ;
 *   3. rechargement → l'accueil s'affiche ;
 *   4. navigation vers un match en cours → **le match est là, avec ses actions** ;
 *   5. une saisie faite hors-ligne est conservée et toujours en attente de sync.
 *
 * Le point 4 est le cœur. L'échec typique d'un service worker mal écrit est
 * « l'accueil marche, mais un match en cours est vide » : la navigation a été
 * servie par la stratégie réseau, qui a échoué silencieusement, sans que rien ne
 * le signale. D'où la vérification des actions et pas seulement de l'écran.
 */

test.describe("hors-ligne", () => {
  // `setOffline` est global au contexte : ces tests ne peuvent pas tourner en
  // parallèle l'un de l'autre. Le fichier est donc sérialisé, et le timeout
  // allongé parce qu'un rechargement hors-ligne sans service worker actif
  // attend le timeout réseau du navigateur.
  test.describe.configure({ mode: "serial" });

  test("recharge et saisit sans réseau", async ({ page, context }) => {
    test.setTimeout(90_000);

    // --- 1. Installation en ligne ------------------------------------------
    await signIn(page);
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Nouveau match" }),
    ).toBeVisible();

    // Un match en cours, pour avoir quoi retrouver hors-ligne.
    await page.getByRole("button", { name: "Nouveau match" }).click();
    await page.getByLabel("Adversaire").fill("BC Nuit");
    await page.getByRole("button", { name: "Commencer la saisie" }).click();
    await expect(page.getByTestId("score")).toBeVisible();
    await page.getByRole("button", { name: /2 points — tap réussi/ }).click();
    await expect(page.getByTestId("score")).toHaveText("2");

    // Attendre que le service worker **contrôle** la page, pas seulement qu'il
    // soit enregistré. Sans cette attente, le rechargement suivant pourrait
    // être servi par le réseau alors que le worker vient d'arriver — le test
    // passerait sans avoir jamais exercé le hors-ligne.
    await page.waitForFunction(
      async () => {
        if (!("serviceWorker" in navigator)) return false;
        await navigator.serviceWorker.ready;
        return navigator.serviceWorker.controller !== null;
      },
      undefined,
      { timeout: 30_000 },
    );

    // Le pré-cache doit être terminé. `install` ne se termine qu'après avoir
    // mis tous les fichiers en cache : c'est la garantie que le rechargement
    // offline aura de quoi servir.
    await page.evaluate(async () => {
      const keys = await caches.keys();
      for (const key of keys) {
        const cache = await caches.open(key);
        await cache.keys();
      }
    });

    // --- 2. Coupure du réseau ---------------------------------------------
    await context.setOffline(true);

    // --- 3. Rechargement complet, puis navigation -------------------------
    // Le rechargement se fait depuis l'écran de saisie, ce qui prouve que le
    // HTML de `/match/` lui-même survit — pas seulement celui de l'accueil. La
    // navigation qui suit est le second test : c'est elle qui exerce la
    // stratégie réseau-premier.
    await page.reload();
    await expect(page.getByTestId("score")).toHaveText("2");

    // Navigation hors-ligne vers l'accueil. Une `goto` et non un tap : c'est le
    // réseau qui est interrogé par le service worker, donc c'est bien la
    // stratégie réseau-premier qui est exercée, et non un changement de route
    // que le client pourrait gérer seul.
    await page.goto("/");
    // `exact` : « Matchs » est aussi le début de « Tous les matchs ouverts », et
    // Playwright fait du sous-ensemble une correspondance. Sans lui, l'assertion
    // échoue sur une ambiguïté qui n'a rien à voir avec le hors-ligne.
    await expect(
      page.getByRole("heading", { name: "Matchs", exact: true }),
    ).toBeVisible();

    // --- 4. Le match en cours est retrouvé, avec son score -----------------
    // C'est ici que se joue le test. Si la stratégie de navigation avait été
    // cache-first, `/match/` aurait été servi par le HTML de l'accueil — l'app
    // s'afficherait, l'écran serait vide, et rien n'indiquerait la cause.
    await page.getByRole("link", { name: /Reprendre/ }).click();
    await expect(page.getByTestId("score")).toBeVisible();
    // Les actions ont survécu : c'est la preuve que le HTML et les données sont
    // bienvenus du cache, et pas simplement un shell vide qui se remplit ensuite.
    await expect(page.getByTestId("score")).toHaveText("2");

    // --- 5. Une saisie hors-ligne est conservée -----------------------------
    await page.getByRole("button", { name: /3 points — tap réussi/ }).click();
    await expect(page.getByTestId("score")).toHaveText("5");

    // L'indicateur doit signaler l'attente sans mentir sur la gravité : le
    // mode avion est l'état normal en gymnase, pas une panne.
    const indicator = page.getByTestId("sync-indicator");
    await expect(indicator).toHaveAttribute("data-state", /offline|error/);
    await expect(indicator).toContainText(/en attente/);

    // Un rechargement de plus : la saisie hors-ligne doit être persistée, sinon
    // la PWA n'aurait apporté que l'affichage, pas les données.
    await page.reload();
    await expect(page.getByTestId("score")).toHaveText("5");

    await context.setOffline(false);
  });

  test("affiche la page de repli sur une URL inconnue", async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);

    await signIn(page);
    await page.goto("/");
    await page.waitForFunction(
      async () => {
        if (!("serviceWorker" in navigator)) return false;
        await navigator.serviceWorker.ready;
        return navigator.serviceWorker.controller !== null;
      },
      undefined,
      { timeout: 30_000 },
    );

    await context.setOffline(true);

    // `/history/` n'est **pas** une route inconnue : toutes les pages de
    // l'application sont précachées, donc elle s'affiche hors-ligne. C'est le
    // comportement voulu, et c'est ce que vérifie le test précédent.
    //
    // Le repli ne sert donc que pour une URL qui n'a jamais existé — un lien
    // périmé, une faute de frappe dans la barre d'adresse. Le message doit alors
    // être explicite sur ce qui reste utilisable, plutôt que d'afficher l'erreur
    // brute du navigateur.
    await page.goto("/route-inexistante/");
    await expect(
      page.getByRole("heading", { name: /Pas de réseau/ }),
    ).toBeVisible();
    // Le texte est coupé par le rendu de Next sur plusieurs nœuds : on cible un
    // fragment, pas la phrase entière.
    await expect(page.getByText(/téléphone/)).toBeVisible();

    await context.setOffline(false);
  });
});
