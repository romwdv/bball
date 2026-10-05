import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Générés par les tests et le build PWA.
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    // Le service worker est écrit en JS vanilla dans `public/` (Phase 7),
    // volontairement hors du périmètre TypeScript.
    "public/sw.js",
  ]),
  {
    rules: {
      // Le modèle d'action du domaine utilise des unions discriminées ; le tri
      // exhaustif des `kind` est la principale défense contre une règle oubliée.
      "no-fallthrough": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // Les composants de saisie sont des surfaces tactiles : `button` plutôt que
      // `div onClick`. Cette règle empêche d'en réintroduire.
      "jsx-a11y/no-static-element-interactions": "error",
      "jsx-a11y/click-events-have-key-events": "error",
    },
  },
  {
    // Les fichiers de test concentrent volontairement des `any` via les fixtures.
    files: ["tests/**/*.ts", "tests/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
]);

export default eslintConfig;
