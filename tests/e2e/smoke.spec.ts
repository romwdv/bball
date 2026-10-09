import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

/**
 * Smoke test — un match complet, du début à la fin.
 *
 * ## Différence avec `match.spec.ts`
 *
 * Les autres tests vérifient **une chose chacun** : un appui long enregistre un
 * tir raté, une annulation groupe les actions d'un combo. C'est la bonne
 * granularité pour diagnostiquer une régression — un test qui échoue doit dire
 * *quoi* ne marche plus.
 *
 * Ce test vérifie l'**enchaînement** : l'écran de saisie reste cohérent d'un bout
 * à l'autre, et les données sont lisibles après coup. C'est un test différent,
 * pas un test plus long. Les deux ensemble sont nécessaires : les tests fins
 * passent sur une application dont le parcours global est cassé, et inversement.
 *
 * ## Ce qu'il ne vérifie pas
 *
 * La synchronisation. Les requêtes réseau sont coupées par `tests/e2e/auth.ts`,
 * donc la validation de bout en bout est faite par le test d'offline, et le
 * comportement face au vrai Supabase reste à vérifier sur un téléphone.
 */

/**
 * Nombres d'actions, écrits en expressions plutôt qu'en dur.
 *
 * « 5 paniers à 2 points » se lit mieux que « cinq » dans le commentaire, mais
 * l'erreur la plus probable ici est d'oublier de mettre à jour la constante en
 * ajoutant une action. Une expression rend le compte impossible à falsifier.
 *
 * Un seul joueur est suivi (PLAN.md §11) : plus de changement de joueur en cours
 * de match, donc plus de constante par joueur. Le test garde le même volume
 * d'actions et la même vérification du cumul — c'est la logique qui est à
 * prouver, pas le nombre de joueurs.
 */
const BINS = 5;
const THREE_POINTERS = 3;
/** Paniers enregistrés en période 3, pour séparer période et cumul. */
const LATE_BINS = 2;
const FOULS = 1;
const FREE_THROWS = 2;

/** Un lancer annulé, pour vérifier que l'annulation retire un point. */
/**
 * Total du match, fautes exclues.
 *
 * La faute ne compte pas — c'est le point des règles métier le plus facile à
 * contredire par erreur, et il est compté ici pour que sa présence soit visible
 * dans le calcul.
 */
const POINTS_FINISHED = 2 * BINS + 3 * THREE_POINTERS + FREE_THROWS;

/** Idem, après les deux paniers enregistrés en période 3. */
const POINTS = POINTS_FINISHED + 2 * LATE_BINS;

/**
 * Total après l'annulation.
 *
 * Le test annule la **dernière action écrite**, donc un des paniers de `LATE_BINS`
 * : la baisse est de deux points, pas d'un. La baisse d'**exactement** deux points
 * prouve que l'annulation a bien eu lieu, qu'elle n'a touché **qu'une** action, et
 * que le cumul n'a pas été recalculé sur la seule période affichée. Un `undoScope`
 * mal borné à la période, ou une régression sur le regroupement par `groupId`,
 * ferait bouger le score davantage.
 */
const POINTS_AFTER_UNDO = POINTS - 2;

/**
 * Valeur d'une carte de statistique (PLAN.md §12).
 *
 * La carte est un bloc avec une étiquette puis une valeur : « Points » suivi
 * de « 17 ». La lecture prend la carte (`..` = parent de l'étiquette) et en
 * extrait le nombre.
 */
async function pointsOf(
  page: import("@playwright/test").Page,
  label: string,
): Promise<number> {
  const card = page.getByText(label, { exact: true }).locator("..");
  const text = await card.innerText();
  const match = text.match(/-?\d+/);
  return match === null ? NaN : Number.parseInt(match[0], 10);
}

/** Un match terminé, avec deux actions, prêt à être supprimé. */
async function seedFinishedMatch(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Ajouter un match" }).click();
  await page.getByLabel("Adversaire").fill("BC Jetable");
  await page.getByRole("button", { name: "Commencer la saisie" }).click();
  await expect(page.getByTestId("score")).toBeVisible();

  await page.getByRole("button", { name: /2 points — tap réussi/ }).click();
  await page.getByRole("button", { name: /2 points — tap réussi/ }).click();
  await expect(page.getByTestId("score")).toHaveText("4");

  await page.getByRole("button", { name: "Terminer" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Terminer", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retour à l'accueil" }),
  ).toBeVisible();
}
test.describe("un match de bout en bout", () => {
  test.setTimeout(60_000);

  test("créer, saisir, clôturer, relire", async ({ page }) => {
    await signIn(page);

    // ── Création ────────────────────────────────────────────────────────────
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Matchs", exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Ajouter un match" }).click();
    await page.getByLabel("Adversaire").fill("BC Nuit");

    // Le joueur est créé automatiquement (PLAN.md §11) : il n'y a plus rien à
    // cocher, et la saisie est immédiatement opérationnelle — plus de carrousel
    // à verrouiller.
    await page.getByRole("button", { name: "Commencer la saisie" }).click();
    await expect(page.getByTestId("score")).toBeVisible();

    // ── Saisie ──────────────────────────────────────────────────────────────
    await expect(page.getByTestId("score")).toHaveText("0");

    for (let i = 0; i < BINS; i += 1) {
      await page.getByRole("button", { name: /2 points — tap réussi/ }).click();
    }
    for (let i = 0; i < THREE_POINTERS; i += 1) {
      await page.getByRole("button", { name: /3 points — tap réussi/ }).click();
    }
    for (let i = 0; i < FOULS; i += 1) {
      await page
        .getByRole("button", { name: new RegExp(`Faute ${i + 1} sur 5`) })
        .click();
    }
    for (let i = 0; i < FREE_THROWS; i += 1) {
      await page
        .getByRole("button", { name: /Lancer libre — tap réussi/ })
        .click();
    }

    // Le score est dérivé des actions, jamais stocké : c'est lui qui prouve que
    // l'ensemble des règles est cohérent — fautes et lancers compris.
    await expect(page.getByTestId("score")).toHaveText(String(POINTS_FINISHED));

    // Passage en période 3 : **le score du header ne bouge pas**. C'est un cumul
    // de match, parce que c'est le chiffre que le coach annonce au banc ; il ne
    // doit pas se remettre à zéro en changeant de période.
    //
    // `exact` sur les onglets de période : « 3 » matcherait aussi « 3 points ».
    const period = page.getByRole("tablist", { name: "Période" });
    await period.getByRole("tab", { name: "3", exact: true }).click();
    await expect(
      period.getByRole("tab", { name: "3", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("score")).toHaveText(String(POINTS_FINISHED));

    // Deux paniers de plus, enregistrés **en période 3**. Le cumul du header
    // monte : une action écrite en Q3 compte comme les autres, ce que le test
    // ne prouverait pas s'il ne saisissait rien après le changement de période.
    for (let i = 0; i < LATE_BINS; i += 1) {
      await page.getByRole("button", { name: /2 points — tap réussi/ }).click();
    }
    await expect(page.getByTestId("score")).toHaveText(String(POINTS));

    // ── Les fautes ne repartent pas à zéro entre les périodes ───────────────
    // La limite à cinq fautes est **par rencontre**. Le libellé du bouton FAUTE
    // porte ce compteur : une faute ayant déjà été saisie en Q1, il affiche
    // « Faute 2 sur 5 ». S'il repartait à zéro en changeant de période, il
    // reviendrait à « Faute 1 sur 5 » — et un joueur sorti en Q1 pourrait
    // reprendre le terrain en prenant cinq fautes de plus, la feuille de match
    // en comptant dix.
    const foulButton = page.getByRole("button", { name: /Faute 2 sur 5/ });
    await expect(foulButton).toBeVisible();
    await period.getByRole("tab", { name: "2", exact: true }).click();
    await expect(foulButton).toBeVisible();
    await period.getByRole("tab", { name: "4", exact: true }).click();
    await expect(foulButton).toBeVisible();

    // ── Annulation ──────────────────────────────────────────────────────────
    // Le bouton undo porte son libellé en `aria-label` (il n'affiche qu'une
    // icône, PLAN.md §12).
    await page
      .getByRole("button", { name: "Annuler la dernière action" })
      .click();
    await expect(page.getByText("Dernière action annulée")).toBeVisible();

    // Le cumul du header baisse d'exactement un point. Comme il est calculé sur
    // toutes les actions, cela ne dépend pas de la période affichée : l'annulation
    // porte sur le **dernier appui du match**.
    await expect(page.getByTestId("score")).toHaveText(
      String(POINTS_AFTER_UNDO),
    );

    // ── Clôture ─────────────────────────────────────────────────────────────
    await page.getByRole("button", { name: "Terminer" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    // `exact` : la barre d'actions porte aussi « Terminer ». La fiche de clôture
    // reprend le même mot, et Playwright ferait de « Terminer » une correspondance
    // pour les deux.
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Terminer", exact: true })
      .click();

    // L'écran de saisie disparaît, et la feuille de match prend sa place. La
    // balise `section` porte le libellé : le titre affiché est « vs BC Nuit ».
    await expect(
      page.getByRole("region", { name: "Feuille de match" }),
    ).toBeVisible();
    // Le statut est passé à « Terminé » dans la feuille, pas seulement dans la
    // base : c'est ce que le coach relit.
    await expect(page.getByText("Terminé")).toBeVisible();

    // ── Relecture depuis l'accueil ──────────────────────────────────────────
    await page.getByRole("button", { name: "Retour à l'accueil" }).click();
    await expect(
      page.getByRole("heading", { name: "Matchs", exact: true }),
    ).toBeVisible();

    // Un match terminé ne doit plus être proposé comme « en cours » : c'est
    // l'erreur qui ferait rouvrir au coach une partie terminée qu'il confondrait avec
    // un match en cours.
    await expect(page.getByText("Aucun match en cours")).toBeVisible();

    // ── Historique ──────────────────────────────────────────────────────────
    await page.getByRole("link", { name: "Historique" }).click();
    // Le lien porte l'adversaire, la date et le statut dans son nom accessible :
    // une seule assertion, et pas d'ambiguïté avec le titre « Terminés ».
    await expect(
      page.getByRole("link", { name: /Match terminé contre BC Nuit/ }),
    ).toBeVisible();

    // ── Statistiques cumulées ───────────────────────────────────────────────
    // Navigation directe : `/history` n'a pas de lien vers les statistiques, et
    // ajouter un bouton de retour ne serait pas un changement de produit pour
    // le seul sake d'un test.
    await page.goto("/stats/");
    // La grille de cartes (PLAN.md §12) montre les cumuls du joueur. La carte
    // « Points » est la preuve que les stats relisent les actions du match
    // clôturé, et qu'une seule série de cartes existe (un seul joueur suivi).
    await expect(page.getByText("Points", { exact: true })).toHaveCount(1);

    // Les totaux sont recalculés depuis les actions, jamais stockés : ils doivent
    // donc être cohérents avec le score final du match. Un export figé au moment de
    // la clôture donnerait d'autres chiffres — c'est exactement le bug que le
    // modèle append-only est censé rendre impossible.
    await expect(pointsOf(page, "Points")).resolves.toBe(POINTS_AFTER_UNDO);
  });
});

test.describe("suppression d'un match", () => {
  test.setTimeout(60_000);

  test("demande confirmation, puis efface le match et ses actions", async ({
    page,
  }) => {
    await signIn(page);
    await seedFinishedMatch(page);

    // ── Confirmation ───────────────────────────────────────────────────────
    await page.goto("/history/");
    await page
      .getByRole("button", { name: "Supprimer le match contre BC Jetable" })
      .click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Le nombre d'actions est ce qui permet de vérifier qu'on choisit le bon
    // match : deux matchs contre la même équipe sont courants dans une saison.
    await expect(dialog).toContainText("2 actions");

    // « Garder » ne supprime rien : c'est le geste de sortie de secours.
    await dialog.getByRole("button", { name: "Garder" }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("link", { name: /Match terminé contre BC Jetable/ }),
    ).toBeVisible();

    // ── Suppression effective ───────────────────────────────────────────────
    await page
      .getByRole("button", { name: "Supprimer le match contre BC Jetable" })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Supprimer", exact: true })
      .click();

    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByText(/vs BC Jetable/)).toHaveCount(0);

    // Le match est absent des **stats cumulées** aussi : ses actions ont été
    // supprimées, pas seulement sa fiche. Sans match terminé, la page dit
    // explicitement qu'il n'y a rien à montrer.
    await page.goto("/stats/");
    await expect(page.getByText("Aucun match terminé")).toBeVisible();
  });

  test("supprime aussi un match en cours, depuis l'accueil", async ({
    page,
  }) => {
    await signIn(page);
    await seedFinishedMatch(page);

    // Un match en cours est celui qu'on crée par erreur : il faut pouvoir
    // l'effacer sans le clôturer d'abord.
    await page.goto("/");
    await page.getByRole("button", { name: "Ajouter un match" }).click();
    await page.getByLabel("Adversaire").fill("BC Oublié");
    await page.getByRole("button", { name: "Commencer la saisie" }).click();
    await expect(page.getByTestId("score")).toBeVisible();

    await page.getByRole("button", { name: "Sortir" }).click();
    await expect(
      page.getByRole("link", { name: /Match en cours contre BC Oublié/ }),
    ).toBeVisible();

    await page
      .getByRole("button", { name: "Supprimer le match contre BC Oublié" })
      .click();

    const dialog = page.getByRole("dialog");
    // Un match sans action le dit franchement : « aucune » plutôt qu'un « 0
    // actions » qui ferait croire à un bug de comptage.
    await expect(dialog).toContainText("n’en a aucune");

    await dialog
      .getByRole("button", { name: "Supprimer", exact: true })
      .click();

    await expect(page.getByText(/vs BC Oublié/)).toHaveCount(0);
    // Les autres matchs sont intacts : la suppression est ciblée.
    await expect(
      page.getByRole("link", { name: /Match en cours contre/ }),
    ).toHaveCount(0);
    await expect(page.getByText("Aucun match en cours")).toBeVisible();
  });
});

test.describe("voyant de synchronisation", () => {
  test.setTimeout(60_000);

  /**
   * Le voyant doit exister **partout où une donnée change**, pas seulement là où
   * le plan le mentionnait — c'est-à-dire le header du match.
   *
   * Sans lui sur l'accueil et l'historique, une suppression hors-ligne est
   * indiscernable d'une suppression réussie : le match disparaît localement, et
   * rien ne dit qu'il attend encore d'envoyer. Le coach le verrait réapparaître
   * au tirage suivant sans explication.
   */
  test("le voyant est présent sur l'accueil", async ({ page }) => {
    await signIn(page);
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Matchs", exact: true }),
    ).toBeVisible();

    await expect(page.getByTestId("sync-indicator")).toBeVisible();
    await expect(page.getByTestId("sync-indicator")).toHaveAttribute(
      "data-state",
      /idle|syncing|offline|error/,
    );
  });

  test("le voyant est présent sur l'historique", async ({ page }) => {
    await signIn(page);
    await seedFinishedMatch(page);
    await page.goto("/history/");

    await expect(page.getByTestId("sync-indicator")).toBeVisible();
  });

  test("annonce une suppression encore en attente", async ({
    page,
    context,
  }) => {
    await signIn(page);
    await seedFinishedMatch(page);

    await page.goto("/history/");
    await page
      .getByRole("button", { name: "Supprimer le match contre BC Jetable" })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Supprimer", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeHidden();

    // Suppression réussie et déjà synchronisée : le voyant doit le dire, sinon le
    // coach ne sait pas s'il peut rouvrir la page web.
    await expect(page.getByTestId("sync-indicator")).toHaveText("synchronisé");

    // Un match créé hors-ligne, puis supprimé hors-ligne : la suppression
    // reste en file, et c'est exactement ce que le voyant doit annoncer.
    await context.setOffline(true);
    await page.goto("/");
    await page.getByRole("button", { name: "Ajouter un match" }).click();
    await page.getByLabel("Adversaire").fill("BC Hors-ligne");
    await page.getByRole("button", { name: "Commencer la saisie" }).click();
    await expect(page.getByTestId("score")).toBeVisible();

    await page.getByRole("button", { name: "Sortir" }).click();
    await page
      .getByRole("button", { name: "Supprimer le match contre BC Hors-ligne" })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Supprimer", exact: true })
      .click();
    await expect(page.getByText(/vs BC Hors-ligne/)).toHaveCount(0);

    // Le match a disparu de l'écran, mais la suppression n'est pas partie : sans
    // ce libellé, le coach croirait avoir effacé un match qui reviendra. Et le
    // bandeau est toujours là malgré la liste vide — c'est le cas où il compte
    // le plus.
    const indicator = page.getByTestId("sync-indicator");
    await expect(indicator).toHaveAttribute("data-state", "offline");
    // Le compte exact n'intéresse pas : ce qui compte est qu'il soit non nul.
    // Après création + saisie + sortie + suppression hors-ligne, la file contient
    // bien plus que la seule suppression.
    await expect(indicator).toHaveText(/\d+ en attente/);

    await context.setOffline(false);
  });
});
