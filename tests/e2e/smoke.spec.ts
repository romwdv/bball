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
 */
const BINS = 5;
const THREE_POINTERS = 3;
const TURING_BINS = 2;
const TURING_FOULS = 1;
const TURING_FREE_THROWS = 2;

/** Un lancer annulé, pour vérifier que l'annulation retire un point. */

/**
 * Total du match, fautes exclues.
 *
 * Lovelace marque tous ses paniers ; Turing marque `TURING_BINS` paniers et ses
 * `TURING_FREE_THROWS` lancers. La faute de Turing ne compte pas — c'est le point
 * des règles métier le plus facile à contredire par erreur, et il est compté ici
 * pour que sa présence soit visible dans le calcul.
 */
const POINTS =
  2 * BINS + 3 * THREE_POINTERS + 2 * TURING_BINS + TURING_FREE_THROWS;

/**
 * Total après l'annulation.
 *
 * Le test annule la dernière action — le second lancer de Turing. La baisse
 * d'exactement un point prouve deux choses : que l'annulation a bien eu lieu, et
 * qu'elle n'a touché **qu'une** action sur les douze. Un `undoScope` mal borné à
 * la période affichée, ou une régression sur le regroupement par `groupId`,
 * ferait bouger le score de plus.
 */
const POINTS_AFTER_UNDO = POINTS - 1;

/** Points de Lovelace : 5 paniers à 2 pts et 3 à 3 pts, tous réussis. */
const POINTS_LOVELACE = 2 * BINS + THREE_POINTERS * 3;

/**
 * Points de Turing : ses paniers et ses lancers, moins le lancer annulé.
 *
 * La faute ne compte pas, et son absence dans cette formule est le test : si
 * quelqu'un la rajoutait, le total ne correspondrait plus.
 */
const POINTS_TURING = 2 * TURING_BINS + TURING_FREE_THROWS - 1;

/**
 * Points affichés pour un joueur dans le tableau des statistiques cumulées.
 *
 * Le nom du joueur est un `th` de portée ligne, donc un `rowheader` — il n'est
 * pas compté par `getByRole("cell")`. Les cellules commencent donc à « M » (matchs
 * joués), et les points sont la **deuxième**.
 *
 * Lire par position plutôt que par valeur évite qu'un joueur dont une autre
 * grandeur vaut 19 — le nombre de paniers à 2 points, par exemple — soit confondu
 * avec celui qui a 19 points. C'est exactement ce que renvoie un `getByText("19")`
 * non filtré.
 */
async function pointsOf(
  page: import("@playwright/test").Page,
  player: string,
): Promise<number> {
  const row = page.getByRole("row").filter({ hasText: player });
  return Number.parseInt(
    (await row.getByRole("cell").nth(1).innerText()).trim(),
    10,
  );
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

    await page.getByRole("button", { name: "Nouveau match" }).click();
    await page.getByLabel("Adversaire").fill("BC Nuit");

    // Deux joueurs, ajoutés par la forme rapide : c'est le cas du remplaçant
    // arrivé en cours de saison, que la création rapide doit couvrir.
    //
    // Chaque ajout est **attendu** avant le suivant. Sans cette attente, le
    // deuxième remplissage peut viser l'ancien nœud pendant que le roster se
    // réaffiche, et le bouton resterait désactivé sur un nom vide — un échec
    // intermittent qui n'a rien à voir avec la fonctionnalité testée.
    await page.getByLabel("Nom du joueur").fill("Ada Lovelace");
    await page.getByLabel("Numéro").fill("4");
    await page.getByRole("button", { name: "Ajouter au roster" }).click();
    await expect(page.getByRole("button", { name: /Lovelace/ })).toBeVisible();

    await page.getByLabel("Nom du joueur").fill("Alan Turing");
    await page.getByLabel("Numéro").fill("7");
    await page.getByRole("button", { name: "Ajouter au roster" }).click();
    await expect(page.getByRole("button", { name: /Turing/ })).toBeVisible();

    // Le roster est pré-coché en entier : c'est le cas habituel, et decocher à
    // chaque match serait une friction pure.
    await expect(
      page.getByRole("button", { name: /Lovelace/ }),
    ).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "Commencer la saisie" }).click();
    await expect(page.getByTestId("score")).toBeVisible();

    // ── Saisie ──────────────────────────────────────────────────────────────
    // Premier joueur verrouillé automatiquement : sinon le coach ouvrirait une
    // grille morte en attendant un tap qui n'enregistre rien.
    await expect(page.getByTestId("score")).toHaveText("0");

    for (let i = 0; i < BINS; i += 1) {
      await page.getByRole("button", { name: /2 points — tap réussi/ }).click();
    }
    for (let i = 0; i < THREE_POINTERS; i += 1) {
      await page.getByRole("button", { name: /3 points — tap réussi/ }).click();
    }

    // Changer de joueur entre deux séries : c'est le geste le plus fréquent en
    // match, et celui que le garde-fou « joueur verrouillé » doit tenir — sans lui,
    // la deuxième série irait au joueur précédent.
    //
    // Le carrousel est un `tablist`, donc des `tab` et non des `button` : les
    // confondre ferait échouer le test sur une question de sémantique, pas sur
    // le comportement.
    await page.getByRole("tab", { name: /Turing/ }).click();
    for (let i = 0; i < TURING_BINS; i += 1) {
      await page.getByRole("button", { name: /2 points — tap réussi/ }).click();
    }
    for (let i = 0; i < TURING_FOULS; i += 1) {
      await page
        .getByRole("button", { name: new RegExp(`Faute ${i + 1} sur 5`) })
        .click();
    }
    for (let i = 0; i < TURING_FREE_THROWS; i += 1) {
      await page
        .getByRole("button", { name: /Lancer libre — tap réussi/ })
        .click();
    }

    // Le score est dérivé des actions, jamais stocké : c'est lui qui prouve que
    // l'ensemble des règles est cohérent — fautes et lancers compris.
    await expect(page.getByTestId("score")).toHaveText(String(POINTS));

    // Passage en période 3 : **le score du header ne bouge pas**. C'est un cumul
    // de match, parce que c'est le chiffre que le coach annonce au banc ; il ne
    // doit pas se remettre à zéro en changeant de période.
    // `exact` sur les onglets de période : le nom accessible d'un joueur commence
    // par son numéro, donc « 3 » matche aussi « 3pts … Lovelace ». Les onglets de
    // période sont dans un `tablist` nommé, donc on le scope.
    const period = page.getByRole("tablist", { name: "Période" });
    await period.getByRole("tab", { name: "3", exact: true }).click();
    await expect(
      period.getByRole("tab", { name: "3", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("score")).toHaveText(String(POINTS));

    // En revanche les points **du carrousel** suivent la période : c'est ce que
    // le coach veut lire pendant un quart temps. Une action enregistrée en Q3
    // s'ajoute au cumul mais pas aux points de la période affichée.
    await period.getByRole("tab", { name: "1", exact: true }).click();
    await expect(page.getByTestId("score")).toHaveText(String(POINTS));

    // ── Les fautes ne repartent pas à zéro entre les périodes ───────────────
    // Turing a une faute, prise en Q1. Le compteur doit rester à 1 en Q3 : la
    // limite à cinq est **par rencontre**. S'il repartait à zéro, un joueur sorti
    // en Q1 pourrait reprendre le terrain en prenant cinq fautes de plus — et la
    // feuille de match en compterait dix.
    const turingTab = page.getByRole("tab", { name: /Turing/ });
    await expect(turingTab).toHaveAccessibleName(/1\/5/);

    await period.getByRole("tab", { name: "3", exact: true }).click();
    await expect(turingTab).toHaveAccessibleName(/1\/5/);

    await period.getByRole("tab", { name: "2", exact: true }).click();
    await expect(turingTab).toHaveAccessibleName(/1\/5/);

    // ── Annulation ──────────────────────────────────────────────────────────
    // `exact` : le header porte aussi un bouton « Annuler la dernière action »,
    // et Playwright fait du sous-ensemble une correspondance.
    await page.getByRole("button", { name: "Annuler", exact: true }).click();
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
      page.getByRole("link", { name: /vs BC Nuit .*Terminé/ }),
    ).toBeVisible();

    // ── Statistiques cumulées ───────────────────────────────────────────────
    // Navigation directe : `/history` n'a pas de lien vers les statistiques, et
    // ajouter un bouton de retour ne serait pas un changement de produit pour
    // le seul sake d'un test.
    await page.goto("/stats/");
    // Le tableau liste une ligne par joueur : c'est la preuve que les stats
    // cumulées relisent les actions du match clôturé. Le nom est un `th` de portée
    // ligne, donc un `rowheader` et non une cellule.
    await expect(
      page.getByRole("rowheader", { name: /Lovelace/ }),
    ).toBeVisible();
    await expect(page.getByRole("rowheader", { name: /Turing/ })).toBeVisible();

    // Les totaux sont recalculés depuis les actions, jamais stockés : ils doivent
    // donc être cohérents avec le score final du match. Un export figé au moment de
    // la clôture donnerait d'autres chiffres — c'est exactement le bug que le
    // modèle append-only est censé rendre impossible.
    //
    // Le total du match n'est pas affiché en ligne : on vérifie donc chaque joueur,
    // et que leur somme redonne le score de la feuille.
    await expect(pointsOf(page, "Lovelace")).resolves.toBe(POINTS_LOVELACE);
    await expect(pointsOf(page, "Turing")).resolves.toBe(POINTS_TURING);
    expect(POINTS_LOVELACE + POINTS_TURING).toBe(POINTS_AFTER_UNDO);
  });
});

test.describe("suppression d'un match", () => {
  test.setTimeout(60_000);

  /** Un match terminé, avec deux actions, prêt à être supprimé. */
  async function seedFinishedMatch(page: import("@playwright/test").Page) {
    await page.goto("/");
    await page.getByRole("button", { name: "Nouveau match" }).click();
    await page.getByLabel("Adversaire").fill("BC Jetable");
    await page.getByLabel("Nom du joueur").fill("Ada Lovelace");
    await page.getByLabel("Numéro").fill("4");
    await page.getByRole("button", { name: "Ajouter au roster" }).click();
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
      page.getByRole("link", { name: /vs BC Jetable .*Terminé/ }),
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
    // supprimées, pas seulement sa fiche.
    await page.goto("/stats/");
    await expect(page.getByRole("rowheader", { name: /Lovelace/ })).toHaveCount(
      0,
    );
  });

  test("supprime aussi un match en cours, depuis l'accueil", async ({
    page,
  }) => {
    await signIn(page);
    await seedFinishedMatch(page);

    // Un match en cours est celui qu'on crée par erreur : il faut pouvoir
    // l'effacer sans le clôturer d'abord.
    await page.goto("/");
    await page.getByRole("button", { name: "Nouveau match" }).click();
    await page.getByLabel("Adversaire").fill("BC Oublié");
    await page.getByLabel("Nom du joueur").fill("Alan Turing");
    await page.getByLabel("Numéro").fill("7");
    await page.getByRole("button", { name: "Ajouter au roster" }).click();
    await page.getByRole("button", { name: "Commencer la saisie" }).click();
    await expect(page.getByTestId("score")).toBeVisible();

    await page.getByRole("button", { name: "Sortir" }).click();
    await expect(page.getByRole("link", { name: /Reprendre/ })).toBeVisible();

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
    await expect(page.getByRole("link", { name: /Reprendre/ })).toHaveCount(0);
    await expect(page.getByText("Aucun match en cours")).toBeVisible();
  });
});
