import type { Page } from "@playwright/test";

/**
 * Session de test pour les parcours E2E.
 *
 * Le garde-fou d'accès de la phase 6 rend l'app inutilisable sans compte, ce qui
 * est exactement le but. Mais un parcours E2E ne peut pas dépendre d'un vrai
 * compte Supabase : le test créerait un compte à chaque exécution, enverrait des
 * données de test dans la base de production, et échouerait dès que le réseau
 * manque — c'est-à-dire dans son environnement normal.
 *
 * La solution retenue : **amorcer la session dans `localStorage`** avec le même
 * format que `supabase-js`, et **couper les requêtes réseau** par
 * `page.route`. Résultat :
 *
 * - aucun compte réel, aucune donnée réelle, aucun appel sortant ;
 * - l'app démarre **exactement** comme en production : elle relit la session,
 *   rattache son équipe, ouvre le cycle de synchronisation ;
 * - les écritures réseau échouent et restent en file, ce qui est le mode de
 *   fonctionnement attendu — les tests E2E vérifient la saisie, pas le cloud.
 *
 * Le jeton est un JWT factice à l'expiration lointaine : `supabase-js` ne le
 * valide pas, il ne fait que le décoder pour en lire l'`exp`. C'est un défaut
 * assumé du harnais, isolé dans ce fichier.
 */

const PROJECT_REF =
  process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/\/\/([^.]+)\.supabase\./)?.[1] ??
  "test";

/** Expiration à un an : le test ne doit jamais le voir expirer en cours d'exécution. */
const EXPIRES_IN_SECONDS = 365 * 24 * 3600;

/** `userId` factice mais bien formé en uuid, pour les colonnes `uuid` de Postgres. */
export const TEST_USER_ID = "00000000-0000-4000-8000-000000000001";

function fakeJwt(): string {
  const header = base64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64(
    JSON.stringify({
      sub: TEST_USER_ID,
      exp: Math.floor(Date.now() / 1000) + EXPIRES_IN_SECONDS,
      aud: "authenticated",
      role: "authenticated",
      session_id: "e2e-session",
    }),
  );
  const signature = base64("signature-factice");
  return `${header}.${payload}.${signature}`;
}

function base64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

/**
 * Amorce une session et neutralise le réseau Supabase.
 *
 * À appeler **avant** le premier `goto` : la session doit être en place au
 * chargement, sinon le garde-fou affiche l'écran de connexion.
 */
export async function signIn(page: Page): Promise<void> {
  await page.addInitScript(
    ([key, token]) => {
      window.localStorage.setItem(key, token);
    },
    [
      `sb-${PROJECT_REF}-auth-token`,
      JSON.stringify({
        access_token: fakeJwt(),
        token_type: "bearer",
        expires_in: EXPIRES_IN_SECONDS,
        expires_at: Math.floor(Date.now() / 1000) + EXPIRES_IN_SECONDS,
        refresh_token: "jeton-de-refresh-factice",
        user: {
          id: TEST_USER_ID,
          aud: "authenticated",
          role: "authenticated",
          email: "e2e@gymnase.test",
          email_confirmed_at: new Date().toISOString(),
          app_metadata: {},
          user_metadata: {},
          created_at: new Date().toISOString(),
        },
      }),
    ] as const,
  );

  // Aucun appel sortant : ni REST, ni auth. Un parcours E2E ne doit jamais
  // écrire dans la base du projet, et ne doit pas dépendre du réseau.
  await page.route(/supabase\.co\/(rest|auth)\//, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    }),
  );
}

/**
 * Supprime toute session avant un parcours.
 *
 * Utilisé par le test qui vérifie le garde-fou : sans cette étape, la session
 * amorcée par un autre test resterait dans le profil du navigateur.
 */
export async function signOut(page: Page): Promise<void> {
  await page.addInitScript(() => {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("sb-")) window.localStorage.removeItem(key);
    }
  });
}
