import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      // `src/domain` est le cœur métier (règles de projection, agrégation, undo) et doit
      // être couvert. `src/app` et `src/ui` sont des couches de présentation, testées
      // indirectement via Playwright.
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/app/**",
        "src/ui/**",
        "**/*.d.ts",
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
