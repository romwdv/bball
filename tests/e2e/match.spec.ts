import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

/**
 * Parcours de bout en bout, sur le build statique et un vrai navigateur.
 *
 * Les tests RTL tournent sur `fake-indexeddb` : ils prouvent que la logique est
 * correcte, pas que l'app démarre. Ici Chromium ouvre IndexedDB pour de bon, les
 * routes sont servies depuis `out/`, et le cycle complet — créer un match, saisir,
 * lire le score, clôturer, retrouver le match — passe par la même interface que
 * le coach le soir du match.
 *
 * Ce test est la raison d'être de la phase 4 : tout le reste pourrait être écrit
 * et vérifié unitairement sans jamais confirmer que l'app se tient debout.
 */

/**
 * Le joueur suivi est créé automatiquement (PLAN.md §11) : le parcours E2E n'a
 * donc plus à l'ajouter. C'est un changement de fond — avant, un test qui oubliait
 * cette étape créait un match sans joueur et la grille restait morte.
 */

async function createMatch(
  page: import("@playwright/test").Page,
): Promise<void> {
  await signIn(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Ajouter un match" }).click();
  await page.getByLabel("Adversaire").fill("BC Nuit");
  await page.getByRole("button", { name: "Commencer la saisie" }).click();
  await expect(page.getByTestId("score")).toBeVisible();
}

test.describe("parcours complet", () => {
  test("crée un match, saisit 10 actions et lit le score", async ({ page }) => {
    await createMatch(page);

    // 5 paniers à 2 pts (10) + 3 paniers à 3 pts (9) + 1 faute + 1 LF (1)
    // = 10 actions, 20 points. La faute et le LF vérifient que des actions
    // sans points ne faussent pas le total.
    for (let i = 0; i < 5; i += 1) {
      await page.getByRole("button", { name: /2 points — tap réussi/ }).click();
    }
    for (let i = 0; i < 3; i += 1) {
      await page.getByRole("button", { name: /3 points — tap réussi/ }).click();
    }
    await page.getByRole("button", { name: /Faute 1 sur 5/ }).click();
    await page
      .getByRole("button", { name: /Lancer libre — tap réussi/ })
      .click();

    // Le score est dérivé des actions, jamais stocké : c'est lui qui prouve
    // que les 10 gestes ont bien été écrits.
    await expect(page.getByTestId("score")).toHaveText("20", { timeout: 5000 });
  });

  test("enregistre un tir raté à l'appui long", async ({ page }) => {
    await createMatch(page);

    // Appui long de 500 ms : au-delà des 400 ms du seuil, sous un délai qui
    // rendrait le test lent. `page.mouse` plutôt que `dispatchEvent` : on
    // cherche à rejouer un vrai geste, pas à appeler un handler à la main.
    const button = page.getByRole("button", { name: /2 points — tap réussi/ });
    const box = (await button.boundingBox()) ?? {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    };
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(500);
    await page.mouse.up();

    // Un tir raté ne change pas le score : c'est le ratio `réussis/tentés` du
    // carrousel qui le rend visible.
    await expect(page.getByText("0/1")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("score")).toHaveText("0");
  });

  test("ouvre la fiche de lancers après un tir raté + faute", async ({
    page,
  }) => {
    await createMatch(page);

    await page.getByRole("button", { name: /2 lancers/ }).click();

    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText("Lancers libres");
  });

  test("clôture le match et affiche la feuille", async ({ page }) => {
    await createMatch(page);

    await page.getByRole("button", { name: /2 points — tap réussi/ }).click();
    await expect(page.getByTestId("score")).toHaveText("2");

    await page.getByRole("button", { name: "Terminer" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Terminer", exact: true })
      .click();

    // La feuille remplace la grille : la saisie n'est plus possible, et le
    // score final est là.
    await expect(page.getByText("Feuille de match")).toBeHidden();
    await expect(page.getByText("vs BC Nuit")).toBeVisible();
    await expect(page.getByText("Exporter en CSV")).toBeVisible();
    // La grille d'actions n'est plus proposée.
    await expect(
      page.getByRole("button", { name: /2 points — tap réussi/ }),
    ).toHaveCount(0);
  });

  test("reprend un match en cours depuis l'accueil", async ({ page }) => {
    await createMatch(page);
    await page.getByRole("button", { name: /2 points — tap réussi/ }).click();
    await page.getByRole("button", { name: "Sortir" }).click();

    // Retour à l'accueil : la carte pilule du match doit être reprise, pas
    // perdue (PLAN.md §12).
    const resume = page.getByRole("link", {
      name: /Match en cours contre BC Nuit/,
    });
    await expect(resume).toBeVisible();
    await resume.click();

    // Le score est relu depuis la base, pas depuis un état volatile.
    await expect(page.getByTestId("score")).toHaveText("2");
  });

  test("n'affiche plus le match terminé comme « en cours »", async ({
    page,
  }) => {
    await createMatch(page);
    await page.getByRole("button", { name: "Terminer" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Terminer", exact: true })
      .click();
    await page.getByRole("button", { name: "Retour à l'accueil" }).click();

    // Un match terminé n'a plus rien à faire dans la liste des matchs ouverts.
    await expect(page.getByText("Aucun match en cours")).toBeVisible();
    await expect(page.getByText(/Reprendre/)).toHaveCount(0);
  });

  test("crée le joueur suivi sans passer par un roster", async ({ page }) => {
    await signIn(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Ajouter un match" }).click();

    // Le joueur n'est jamais demandé (PLAN.md §11) et l'écran n'affiche plus de
    // contrôle de roster — c'est la régression que ce test verrouille, pas un
    // détail d'affichage.
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Ajouter au roster/ }),
    ).toHaveCount(0);

    await page.getByLabel("Adversaire").fill("Étoile Béziers");
    await page.getByRole("button", { name: "Commencer la saisie" }).click();

    // La saisie est immédiatement opérationnelle : avant, le coach devait
    // verrouiller un joueur dans le carrousel, faute de quoi la grille était
    // morte. C'est le risque que la suppression du carrousel supprime.
    await expect(page.getByTestId("score")).toBeVisible();
    await page.getByRole("button", { name: /2 points — tap réussi/ }).click();
    await expect(page.getByTestId("score")).toContainText("2");
  });
});

test.describe("garde-fou d'accès", () => {
  test("bloque la saisie sans session", async ({ page }) => {
    // La contrepartie obligatoire de tous les autres tests : ceux-ci amorcent
    // une session, il faut prouver que son absence verrouille vraiment l'app.
    await page.route(/supabase\.co\/(rest|auth)\//, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      }),
    );
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "Connexion" }),
    ).toBeVisible();
    // Ni la grille de saisie, ni la création de match : l'app est verrouillée,
    // pas simplement redirigée.
    await expect(
      page.getByRole("button", { name: "Ajouter un match" }),
    ).toHaveCount(0);
    await expect(page.getByTestId("score")).toHaveCount(0);
  });

  test("reste verrouillé sur une route de saisie", async ({ page }) => {
    await page.route(/supabase\.co\/(rest|auth)\//, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      }),
    );
    // URL directe vers un match : le verrou ne peut pas dépendre du chemin suivi
    // pour arriver à l'écran de saisie.
    await page.goto("/match/?m=00000000-0000-4000-8000-000000000002");

    await expect(
      page.getByRole("heading", { name: "Connexion" }),
    ).toBeVisible();
    await expect(page.getByTestId("score")).toHaveCount(0);
  });
});
