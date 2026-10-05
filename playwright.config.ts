import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke tests E2E. Ciblent un viewport de téléphone car l'app est conçue pour
 * être utilisée debout, sur le bord du terrain, à une main.
 *
 * L'app est un build statique : on sert `out/` plutôt que de lancer `next dev`,
 * ce qui vérifie réellement le comportement en production (et plus tard l'offline).
 */
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
        // `npx serve` refuse le dossier vide ; `out/` existe après `pnpm build`.
        command: "npx --yes serve out -l 3100",
        url: "http://127.0.0.1:3100",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
