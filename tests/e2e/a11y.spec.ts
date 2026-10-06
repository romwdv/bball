import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

/**
 * Audit des cibles tactiles et des contrastes — mesuré, pas supposé.
 *
 * La phase 0 a posé deux seuils (44 px, 88 px) et un thème dark. Les seuils
 * étaient appliqués par convention — une classe `min-h-tap-min` sur chaque bouton
 * — ce qui garantit la **hauteur** et laisse la largeur libre. Or un bouton de
 * retour fait 32 px de large avec `px-3` et `min-h-tap-min` : la classe est
 * présente, la cible ne l'est pas.
 *
 * Ces tests lisent donc la géométrie **réelle** après rendu, sur un viewport de
 * téléphone. Un écart se voit dans la valeur mesurée, avec l'élément nommé —
 * là où une relecture de CSS ne le verrait pas.
 *
 * Les deux audits sont volontairement tolérants sur la forme et stricts sur le
 * fond : les éléments dynamicales (vides, non montés) sont ignorés, mais tout
 * élément visible sous le seuil est signalé avec sa classe, ce qui suffit à le
 * retrouver.
 */

/** Seuil Material : cible tactile minimale. */
const MIN_TARGET = 44;

/** Seuil AA WCAG pour du texte courant. */
const MIN_CONTRAST = 4.5;

test.describe("cibles tactiles", () => {
  test("le sélecteur de période respecte la cible minimale", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Nouveau match" }).click();
    await page.getByLabel("Adversaire").fill("BC Nuit");
    await page.getByLabel("Nom du joueur").fill("Ada Lovelace");
    await page.getByLabel("Numéro").fill("4");
    await page.getByRole("button", { name: "Ajouter au roster" }).click();
    await page.getByRole("button", { name: "Commencer la saisie" }).click();
    await expect(page.getByTestId("score")).toBeVisible();

    const quarter = page.getByRole("tab", { name: "1" });
    const box = await quarter.boundingBox();

    // Le sélecteur de période est le seul élément du header réellement pressé en
    // match : passer de Q1 à Q2 arrive quelques fois par rencontre, avec un
    // pouce qui glisse. En `w-8` il mesurait 32 px de large.
    expect(box?.width).toBeGreaterThanOrEqual(MIN_TARGET);
    expect(box?.height).toBeGreaterThanOrEqual(MIN_TARGET);
  });

  test("les boutons de retour font au moins 44 px", async ({ page }) => {
    await signIn(page);

    for (const route of ["/history/", "/stats/", "/new-match/"]) {
      await page.goto(route);
      await expect(page.getByRole("heading").first()).toBeVisible();

      const back = page.getByRole("link", { name: /^Retour/ }).first();
      if ((await back.count()) === 0) continue;

      const box = await back.boundingBox();
      expect(
        box?.width,
        `largeur du bouton de retour sur ${route}`,
      ).toBeGreaterThanOrEqual(MIN_TARGET);
    }
  });

  test("la grille d'actions respecte 88 px", async ({ page }) => {
    await signIn(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Nouveau match" }).click();
    await page.getByLabel("Adversaire").fill("BC Nuit");
    await page.getByLabel("Nom du joueur").fill("Ada Lovelace");
    await page.getByLabel("Numéro").fill("4");
    await page.getByRole("button", { name: "Ajouter au roster" }).click();
    await page.getByRole("button", { name: "Commencer la saisie" }).click();
    await expect(page.getByTestId("score")).toBeVisible();

    // 2 pts, 3 pts, faute, lancer : les quatre cibles de la thumb zone. Ce sont
    // les gestes les plus fréquents du projet — si un seul d'entre eux est trop
    // petit, c'est celui-là qui se rate en match.
    for (const name of [
      /2 points — tap réussi/,
      /3 points — tap réussi/,
      /Faute 1 sur 5/,
      /Lancer libre — tap réussi/,
    ]) {
      const box = await page.getByRole("button", { name }).boundingBox();
      expect(box?.width, `largeur de « ${name} »`).toBeGreaterThanOrEqual(88);
      expect(box?.height, `hauteur de « ${name} »`).toBeGreaterThanOrEqual(88);
    }
  });
});

test.describe("contrastes", () => {
  /**
   * Ratio WCAG de chaque texte visible, calculé sur les couleurs rendues.
   *
   * Le fond effectif est cherché en remontant la cascade : `background-color`
   * transparent laisse voir le parent, et s'arrêter au premier parent opaque
   * faux — c'est ce qui se passe sur les cartes, posées sur `--surface-raised`.
   *
   * Seuls les nœuds dont le texte est **directement** contenu sont mesurés :
   * sinon chaque chaîne serait comptée une fois par ancêtre, et le rapport le
   * plus défavorable l'emporterait partout.
   */
  async function auditContrast(page: import("@playwright/test").Page) {
    return page.evaluate((minContrast) => {
      const channels = (color: string) =>
        (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);

      const luminance = (rgb: number[]) => {
        const [r, g, b] = rgb.map((value) => {
          const channel = (value ?? 0) / 255;
          return channel <= 0.03928
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
      };

      const backgroundOf = (element: Element): number[] => {
        let node: Element | null = element;
        while (node !== null) {
          const background = getComputedStyle(node).backgroundColor;
          const alpha = Number((background.match(/[\d.]+/g) ?? [])[3] ?? "1");
          if (channels(background).length === 3 && alpha > 0) {
            return channels(background);
          }
          node = node.parentElement;
        }
        return [0, 0, 0];
      };

      const failures: Array<Record<string, unknown>> = [];

      for (const element of document.querySelectorAll<HTMLElement>("*")) {
        const direct = Array.from(element.childNodes)
          .filter(
            (node) =>
              node.nodeType === 3 && (node.textContent ?? "").trim() !== "",
          )
          .map((node) => (node.textContent ?? "").trim())
          .join(" ");
        if (direct === "") continue;

        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;

        const style = getComputedStyle(element);
        if (style.visibility === "hidden" || style.opacity === "0") {
          continue;
        }

        const foreground = luminance(channels(style.color));
        const background = luminance(backgroundOf(element));
        const ratio =
          (Math.max(foreground, background) + 0.05) /
          (Math.min(foreground, background) + 0.05);

        const size = Number.parseFloat(style.fontSize);
        const bold = Number(style.fontWeight) >= 700;
        // AA : 4,5:1 en corps de texte ; 3:1 au-delà de 24 px, ou en gras à
        // partir de 18,66 px — les gros caractères restent lisibles à luminance
        // plus faible.
        const seuil = size >= 24 || (bold && size >= 18.66) ? 3 : minContrast;

        if (ratio < seuil) {
          failures.push({
            text: direct.slice(0, 40),
            ratio: Math.round(ratio * 100) / 100,
            seuil,
            size,
          });
        }
      }

      return failures;
    }, MIN_CONTRAST);
  }

  for (const route of ["/", "/history/", "/stats/", "/new-match/"]) {
    test(`contrastes AA sur ${route}`, async ({ page }) => {
      await signIn(page);
      await page.goto(route);
      // Le contenu est chargé depuis IndexedDB : sans cette attente, l'audit
      // porterait sur un écran vide et ne prouverait rien.
      await expect(page.getByRole("heading").first()).toBeVisible();
      await page.waitForTimeout(400);

      const failures = await auditContrast(page);

      // Le détail est renvoyé dans le message : sans lui, un échec dit seulement
      // « le contraste de 06/10/2026 est insuffisant », sans dire où le corriger.
      expect(
        failures,
        `contrastes sous le seuil AA : ${JSON.stringify(failures)}`,
      ).toEqual([]);
    });
  }
});
