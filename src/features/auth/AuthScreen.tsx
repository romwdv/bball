"use client";

import { useState } from "react";
import { useAuthStore } from "@/features/auth/store";

/**
 * Écrans de connexion, d'inscription et de mot de passe oublié.
 *
 * Les trois partagent un même composant et un même formulaire : en bord de
 * terrain, un écran d'authentification est le moment où l'on abandonne
 * facilement. Un formulaire unique, deux champs, des boutons en bas de fiche et
 * aucun mot de passe à retaper lors d'un aller-retour entre les trois modes.
 *
 * L'écran est affiché par `AuthGate` sur **toutes** les routes, pas seulement sur
 * `/`. La raison est structurelle : `output: 'export'` interdit les middlewares
 * et les redirections côté serveur, donc le verrouillage ne peut pas être une
 * règle de routage — c'est une décision du composant racine.
 *
 * Le mode « nouveau mot de passe » n'a pas d'entrée dans cette liste : il
 * s'impose quand `recovering` est vrai, c'est-à-dire quand le lien de
 * réinitialisation a été suivi. Il est prioritaire sur tout le reste, car le
 * jeton de récupération n'est valable que quelques minutes et disparaît au
 * premier changement de mot de passe.
 */

type Mode = "sign-in" | "sign-up" | "forgot";

const TITLES: Record<Mode, { title: string; submit: string; hint: string }> = {
  "sign-in": {
    title: "Connexion",
    submit: "Se connecter",
    hint: "Vos matchs se ouvrent là où vous les avez laissés.",
  },
  "sign-up": {
    title: "Créer un compte",
    submit: "Créer mon compte",
    hint: "L'inscription est immédiate, aucun email à confirmer.",
  },
  forgot: {
    title: "Mot de passe oublié",
    submit: "Envoyer le lien",
    hint: "Le lien ouvre l'application avec un formulaire de nouveau mot de passe.",
  },
};

const INPUT_CLASS =
  "min-h-tap-min rounded-xl border border-edge bg-raised text-base text-primary outline-none placeholder:text-muted focus:border-accent";

export function AuthScreen() {
  const status = useAuthStore((state) => state.status);
  const error = useAuthStore((state) => state.error);
  const notice = useAuthStore((state) => state.notice);
  const busy = useAuthStore((state) => state.busy);
  const recovering = useAuthStore((state) => state.recovering);
  const signIn = useAuthStore((state) => state.signIn);
  const signUp = useAuthStore((state) => state.signUp);
  const requestReset = useAuthStore((state) => state.requestReset);
  const clearError = useAuthStore((state) => state.clearError);

  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  /**
   * Le message d'erreur ne survit pas à un changement de mode : il porte sur la
   * tentative qui vient d'échouer, pas sur l'écran suivant. Effacé ici, au
   * moment du changement, plutôt que dans un effet : un effet ajouterait un
   * rendu par bascule, et une mise à jour d'état dans un effet React est
   * précisément le motif que la règle `set-state-in-effect` interdit.
   */
  function switchMode(next: Mode) {
    clearError();
    setMode(next);
  }

  if (status === "unconfigured") return <Unconfigured />;
  if (recovering) return <RecoveryForm busy={busy} error={error} />;

  const copy = TITLES[mode];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    if (mode === "sign-in") {
      await signIn(email, password);
      return;
    }
    if (mode === "sign-up") {
      await signUp(email, password);
      return;
    }
    await requestReset(email);
  }

  return (
    <main className="flex flex-1 flex-col justify-center gap-6 overflow-y-auto px-6 pt-(--padding-safe-t) pb-(--padding-safe-b)">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{copy.title}</h1>
        <p className="text-sm text-secondary">{copy.hint}</p>
      </header>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-secondary">Email</span>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              clearError();
            }}
            className={INPUT_CLASS}
          />
        </label>

        {mode !== "forgot" && (
          <label className="flex flex-col gap-1">
            <span className="text-sm text-secondary">Mot de passe</span>
            <input
              type="password"
              autoComplete={
                mode === "sign-up" ? "new-password" : "current-password"
              }
              required
              minLength={6}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                clearError();
              }}
              className={INPUT_CLASS}
            />
            {mode === "sign-up" && (
              <span className="text-xs text-muted">6 caractères minimum.</span>
            )}
          </label>
        )}

        {error !== null && (
          <p
            role="alert"
            className="rounded-xl border border-foul/40 bg-foul-subtle px-4 py-3 text-sm text-foul"
          >
            {error}
          </p>
        )}

        {notice !== null && (
          <p className="rounded-xl border border-edge bg-raised px-4 py-3 text-sm text-secondary">
            {notice}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="min-h-tap-action w-full rounded-xl bg-accent text-lg font-semibold text-inverse disabled:opacity-50"
        >
          {busy ? "Un instant…" : copy.submit}
        </button>
      </form>

      <nav className="flex flex-col gap-2">
        {mode !== "sign-in" && (
          <ModeButton onClick={() => switchMode("sign-in")}>
            J&rsquo;ai déjà un compte
          </ModeButton>
        )}
        {mode !== "sign-up" && (
          <ModeButton onClick={() => switchMode("sign-up")}>
            Créer un compte
          </ModeButton>
        )}
        {mode !== "forgot" && (
          <ModeButton onClick={() => switchMode("forgot")}>
            Mot de passe oublié
          </ModeButton>
        )}
      </nav>
    </main>
  );
}

function ModeButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-tap-min rounded-xl border border-edge px-4 py-3 text-sm text-secondary"
    >
      {children}
    </button>
  );
}

/**
 * Formulaire de nouveau mot de passe.
 *
 * Aucune demande de confirmation du nouveau mot de passe : le lien de
 * réinitialisation est déjà la preuve. Un second champ « confirmer » ferait
 * perdre le coach sur un clavier en deux fois plus de fautes, pour rien.
 */
function RecoveryForm({
  busy,
  error,
}: {
  busy: boolean;
  error: string | null;
}) {
  const updatePassword = useAuthStore((state) => state.updatePassword);
  const [password, setPassword] = useState("");

  return (
    <main className="flex flex-1 flex-col justify-center gap-6 px-6 pt-(--padding-safe-t) pb-(--padding-safe-b)">
      <h1 className="text-2xl font-semibold">Nouveau mot de passe</h1>

      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void updatePassword(password);
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-sm text-secondary">Mot de passe</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={INPUT_CLASS}
          />
        </label>

        {error !== null && (
          <p
            role="alert"
            className="rounded-xl border border-foul/40 bg-foul-subtle px-4 py-3 text-sm text-foul"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="min-h-tap-action w-full rounded-xl bg-accent text-lg font-semibold text-inverse disabled:opacity-50"
        >
          {busy ? "Enregistrement…" : "Enregistrer"}
        </button>
      </form>
    </main>
  );
}

/**
 * Build sans configuration.
 *
 * L'app reste utilisable en local — c'est un filet de sécurité pour le
 * développement, pas une fin. Le message dit quoi poser et où, parce que
 * « variables manquantes » ne fait deviner à personne qu'il faut un `.env.local`
 * **et** rebuilding l'application : les `NEXT_PUBLIC_*` sont figées au build.
 */
function Unconfigured() {
  return (
    <main className="flex flex-1 flex-col justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-semibold">Synchronisation non configurée</h1>
      <p className="text-sm text-secondary">
        Renseignez <code>NEXT_PUBLIC_SUPABASE_URL</code> et{" "}
        <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> dans{" "}
        <code>.env.local</code>, puis relancez le build. L&rsquo;app reste
        utilisable en local, les données attendront la synchronisation.
      </p>
    </main>
  );
}
