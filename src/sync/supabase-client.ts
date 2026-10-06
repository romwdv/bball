"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createRemote, type RemoteClient } from "@/sync/remote";

/**
 * Client Supabase — configuration d'authentification (PLAN.md §5).
 *
 * Un seul client pour toute l'application, créé **paresseusement** : le build
 * `output: 'export'` prerend les pages dans un Node sans `window`, et
 * `createClient` touche au stockage pour installer son gestionnaire de session.
 * Créé à l'import, le build échouerait ; créé au premier usage, il n'existe que
 * dans le navigateur.
 *
 * Les trois options d'authentification ne sont pas des réglages de confort :
 *
 * - `persistSession` : la session est écrite dans `localStorage`, donc elle
 *   survit au redémarrage du téléphone et au mode avion. C'est la condition pour
 *   que l'app démarre en gymnase sans réseau.
 * - `autoRefreshToken` : le jeton de rafraîchissement tourne en tâche de fond,
 *   avant son expiration. Sans cela, une session de 30 jours expire en cours de
 *   saison sans que personne ne s'en aperçoive.
 * - `detectSessionInUrl` : requis pour le lien de réinitialisation de mot de
 *   passe, qui revient dans le fragment d'URL. Sans lui, le lien ouvre
 *   l'app sans session et le coach est renvoyé à l'écran de connexion.
 *
 * ⚠️ **Aucune clé `service_role` dans ce fichier, ni nulle part dans `src/`.**
 * Elle contourne les RLS : la poser dans un bundle lisible par tous reviendrait
 * à publier la base. Toute la sécurité repose sur les politiques de
 * `supabase/schema.sql`.
 */

/** Configuration lue dans l'environnement, gelée au build. */
export interface SupabaseEnv {
  url: string;
  publishableKey: string;
}

/**
 * L'environnement est-il exploitable ?
 *
 * Trois cas distincts, et le troisième est le plus probable en développement :
 * la clé absente, la clé de remplacement laissée par `.env.example`
 * (`xxxxxxxxxxxx`), ou la clé vide. Les deux derniers produisent une URL qui
 * répond 404 ou une clé refusée par l'API — des messages incompréhensibles en
 * français, alors qu'un test de forme donne une cause exploitable.
 */
export function readSupabaseEnv(): SupabaseEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

  if (url.length === 0 || publishableKey.length === 0) return null;
  if (!url.startsWith("https://") || url.includes("xxxxxxxxxxxx")) return null;
  if (publishableKey.includes("xxxxxxxxxxxx")) return null;

  return { url, publishableKey };
}

/** Supabase est-il configuré pour ce build ? Conditionne le garde-fou d'accès. */
export function isSupabaseConfigured(): boolean {
  return readSupabaseEnv() !== null;
}

let instance: SupabaseClient | null = null;

/**
 * Client partagé.
 *
 * @throws si l'environnement n'est pas configuré. L'appelant est censé avoir
 * vérifié `isSupabaseConfigured()` : mieux vaut une exception ici, visible dans
 * la console, qu'un client `null` propagé dans tout le moteur de synchronisation.
 */
export function supabase(): SupabaseClient {
  if (instance !== null) return instance;

  const env = readSupabaseEnv();
  if (env === null) {
    throw new Error(
      "Supabase non configuré — NEXT_PUBLIC_SUPABASE_URL et " +
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY doivent être présents au build.",
    );
  }

  instance = createClient(env.url, env.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  return instance;
}

/** Remplace le client partagé. Réservé aux tests. */
export function setSupabase(next: SupabaseClient | null): void {
  instance = next;
  remoteInstance = null;
}

let remoteInstance: RemoteClient | null = null;

/**
 * Client étroit tel que la synchronisation le consomme.
 *
 * Passé par ici plutôt que construit dans le moteur, pour qu'un test puisse
 * injecter un faux client sans remplacer le module : le moteur ne connaît que
 * l'interface `RemoteClient` (voir `remote.ts`).
 */
export function remote(): RemoteClient {
  if (remoteInstance === null) {
    remoteInstance = createRemote(supabase());
  }
  return remoteInstance;
}

/** Remplace le client étroit. Réservé aux tests. */
export function setRemote(next: RemoteClient | null): void {
  remoteInstance = next;
}
