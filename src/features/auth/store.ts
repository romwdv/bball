"use client";

import { create } from "zustand";
import { isSupabaseConfigured, remote } from "@/sync/supabase-client";
import type { AuthSession } from "@/sync/remote";

/**
 * Session et authentification (PLAN.md §5).
 *
 * Le compte est **obligatoire** : c'est une décision produit, pas une commodité.
 * Raison assumée — sans verrouillage, un coach pourrait saisir un match entier
 * hors-ligne, constatera trois heures plus tard qu'il n'a pas de compte, et le
 * match resterait orphelin, jamais synchronisé. Verrouiller dès l'entrée évite
 * ce scénario ; la phase 6b garantit que les données déjà saisies le suivent.
 *
 * Le store ne manipule aucun champ : il délègue à l'adaptateur `RemoteAuth` et
 * traduit les messages d'erreur. Les écrans ne connaissent que `status` et les
 * cinq actions, ce qui les rend testables avec un faux client.
 */

export type AuthStatus =
  /** Session pas encore connue — `getSession()` n'a pas répondu. */
  | "loading"
  /** Aucune session : l'app est verrouillée, seul l'écran de connexion s'affiche. */
  | "signed-out"
  /** Session valide. */
  | "signed-in"
  /**
   * Variables d'environnement absentes ou de remplacement.
   *
   * Un état distinct de `signed-out`, et non une exception : l'app reste
   * utilisable en local (saisie, export) au lieu d'afficher une page blanche,
   * et l'écran explique ce qu'il faut faire. C'est le cas attendu d'un
   * `pnpm dev` sans `.env.local`.
   */
  | "unconfigured";

export interface AuthState {
  status: AuthStatus;
  session: AuthSession | null;
  /** Message d'erreur, en français, prêt à afficher. */
  error: string | null;
  /** Message de confirmation, ex. « lien envoyé ». */
  notice: string | null;
  /** Une requête est en cours : les boutons se désactivent, sinon double envoi. */
  busy: boolean;
  /**
   * Lien de réinitialisation cliqué : la session existe mais l'app doit demander
   * un nouveau mot de passe au lieu d'ouvrir l'accueil.
   */
  recovering: boolean;

  init: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<boolean>;
  signUp: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  requestReset: (email: string) => Promise<boolean>;
  updatePassword: (password: string) => Promise<boolean>;
  /** Efface le message d'erreur — appelé à la frappe. */
  clearError: () => void;
}

/**
 * Traduction des messages Supabase.
 *
 * Les messages d'API sont en anglais technique (« Invalid login credentials »).
 * Les laisser tels quels sur un écran français donne au coach l'impression que
 * l'application est cassée, et « invalid login credentials » ne distingue pas
 * « email inconnu » de « mot de passe faux » —volontairement, pour ne pas
 * révéler quels comptes existent.
 *
 * Repli sur le message brut quand il n'est pas connu : afficher « Failed to
 * fetch » est au moins un indice exploitable, alors qu'un texte générique
 * (« Une erreur est survenue ») serait un impasse.
 */
const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  "Invalid login credentials": "Email ou mot de passe incorrect.",
  "User already registered": "Un compte existe déjà avec cet email.",
  "Password should be at least 6 characters":
    "Le mot de passe doit faire au moins 6 caractères.",
  "Email not confirmed":
    "Email non confirmé — vérifiez votre boîte de réception.",
  "Unable to validate email address": "Adresse email invalide.",
  "Failed to fetch":
    "Réseau indisponible — réessayez une fois le signal revenu.",
  "NetworkError when attempting to fetch resource":
    "Réseau indisponible — réessayez une fois le signal revenu.",
  "fetch failed": "Réseau indisponible — réessayez une fois le signal revenu.",
  "Password recovery requires you to be authenticated":
    "Session expirée — redemandez un lien de réinitialisation.",
  "New password should be different from the old password.":
    "Le nouveau mot de passe doit différer de l'ancien.",
};

function translate(message: string): string {
  return ERROR_MESSAGES[message] ?? message;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: "loading",
  session: null,
  error: null,
  notice: null,
  busy: false,
  recovering: false,

  async init() {
    // `init()` est appelé par un effet React, donc potentiellement deux fois sous
    // `StrictMode`. Sans ce verrou, deux abonnements `onAuthStateChange` se
    // cumuleront et chaque événement de session sera traité deux fois.
    if (get().status !== "loading") return;

    if (!isSupabaseConfigured()) {
      set({ status: "unconfigured" });
      return;
    }

    const client = remote();

    // Abonné **avant** `getSession()` : une session peut être rafraîchie entre
    // les deux appels, et un abonnement posé après l'aurait manquée.
    client.auth.onAuthStateChange((event, session) => {
      if (event === "recovery") {
        set({ session, status: "signed-in", recovering: true });
        return;
      }
      if (session === null) {
        set({ session: null, status: "signed-out", recovering: false });
        return;
      }
      set({ session, status: "signed-in", recovering: false });
    });

    try {
      const session = await client.auth.getSession();
      set(
        session === null
          ? { session: null, status: "signed-out" }
          : { session, status: "signed-in" },
      );
    } catch (error) {
      set({
        status: "signed-out",
        error: translate(
          error instanceof Error ? error.message : String(error),
        ),
      });
    }
  },

  async signIn(email, password) {
    set({ busy: true, error: null, notice: null });
    const { error } = await remote().auth.signInWithPassword({
      email,
      password,
    });
    if (error !== null) {
      set({ busy: false, error: translate(error.message) });
      return false;
    }
    set({ busy: false });
    return true;
  },

  async signUp(email, password) {
    set({ busy: true, error: null, notice: null });
    const { data, error } = await remote().auth.signUp({ email, password });
    if (error !== null) {
      set({ busy: false, error: translate(error.message) });
      return false;
    }

    if (data === null) {
      // La confirmation d'email est activée sur le projet : aucun email ne part
      // et aucune session n'est créée. Le dire est indispensable, sinon l'écran
      // resterait sur « Inscription » et le coach croirait avoir un compte.
      set({
        busy: false,
        error:
          "Inscription incomplète : la confirmation d'email est activée sur le " +
          "projet Supabase. Demandez à l'administrateur de la désactiver " +
          "(Authentication → Sign In / Email).",
      });
      return false;
    }

    set({ busy: false });
    return true;
  },

  async signOut() {
    set({ busy: true });
    await remote().auth.signOut();
    set({ busy: false, session: null, status: "signed-out" });
  },

  async requestReset(email) {
    set({ busy: true, error: null, notice: null });
    const { error } = await remote().auth.resetPasswordForEmail(email);
    if (error !== null) {
      set({ busy: false, error: translate(error.message) });
      return false;
    }
    set({
      busy: false,
      notice:
        "Si un compte existe pour cette adresse, un lien de réinitialisation a " +
        "été envoyé. Il ouvre l'application avec le formulaire de nouveau mot de passe.",
    });
    return true;
  },

  async updatePassword(password) {
    set({ busy: true, error: null, notice: null });
    const { error } = await remote().auth.updatePassword(password);
    if (error !== null) {
      set({ busy: false, error: translate(error.message) });
      return false;
    }
    set({ busy: false, recovering: false, notice: "Mot de passe mis à jour." });
    return true;
  },

  clearError() {
    set({ error: null });
  },
}));

/**
 * Le rattachement des données locales au compte (phase 6b) est **absent** de ce
 * store : il appartient au garde-fou `AuthGate`, qui réagit à toute apparition
 * de session, y compris au rafraîchissement silencieux du jeton. Le faire ici ne
 * vaudrait qu'après une inscription ou une connexion explicite — donc pas après
 * un redémarrage de l'app, qui est précisément le cas où des mutations
 * attendent en file.
 */
