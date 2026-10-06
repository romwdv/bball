import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke tests E2E. Ciblent un viewport de téléphone car l'app est conçue pour
 * être utilisée debout, sur le bord du terrain, à une main.
 *
 * L'app est un build statique : on sert `out/` plutôt que de lancer `next dev`,
 * ce qui vérifie réellement le comportement en production (et plus tard l'offline).
 */
/*
 * `.env.local` est chargé ici, et nowhere else dans la configuration de test.
 *
 * `NEXT_PUBLIC_SUPABASE_URL` est figée au **build** par Next, donc le bundle
 * servi par `out/` connaît le vrai nom de projet — et `supabase-js` en déduit sa
 * clé de stockage, `sb-<projet>-auth-token`. Sans la même valeur côté test, la
 * session amorcée arriverait sous une autre clé et l'app resterait à l'écran de
 * connexion. Un seul endroit à mettre à jour, donc pas de divergence possible.
 */
if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // Notre serveur statique plutôt que `npx serve` : mêmes en-têtes de
        // cache que la production (phase 7), et aucun téléchargement de paquet
        // au premier lancement du test.
        command: "node scripts/serve.mjs --port 3100",
        url: "http://127.0.0.1:3100",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
