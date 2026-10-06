import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setDb, setRepos, SpaceBunnyDB } from "@/data";
import { createRepositories } from "@/data/repositories";
import { useAuthStore } from "@/features/auth/store";
import { AuthScreen } from "@/features/auth/AuthScreen";
import { AuthGate } from "@/features/auth/AuthGate";
import { SyncIndicator } from "@/features/sync/SyncIndicator";
import { claimTeam } from "@/sync/claim";
import { setRemote } from "@/sync/supabase-client";
import { resetSyncState, stopSync, syncNow } from "@/sync/engine";
import { createFakeRemote, type FakeRemote } from "../sync/fakeRemote";
import type { AuthSession } from "@/sync/remote";

/**
 * Tests de l'authentification et du garde-fou.
 *
 * Ce qui est vérifié ici, dans l'ordre où l'app les rencontre :
 *   1. sans session, **aucun** écran de saisie n'est rendu ;
 *   2. une session ouvre l'app, mais seulement après le rattachement de l'équipe ;
 *   3. les erreurs sont en français et le message survit au mode affiché ;
 *   4. le lien de réinitialisation mène au formulaire, pas à l'accueil.
 *
 * Le faux client remplace le réseau, donc ces tests sont déterministes — ce qui
 * n'aurait pas de sens avec un vrai projet Supabase.
 */

let counter = 0;
let database: SpaceBunnyDB;
let remote: FakeRemote;

const USER = "coach-1";

/**
 * Repart d'un store d'auth neutre avant chaque test.
 *
 * `init` est restauré explicitement : un test qui le neutralise (pour tester
 * l'affichage pendant la résolution de la session) le laisserait sinon en place
 * pour toute la suite, et les tests suivants ne trouveraient plus de session.
 */
const realInit = useAuthStore.getState().init;

function resetAuth() {
  useAuthStore.setState({
    status: "loading",
    session: null,
    error: null,
    notice: null,
    busy: false,
    recovering: false,
    init: realInit,
  });
}

beforeEach(async () => {
  counter += 1;
  database = new SpaceBunnyDB(`space-bunny-auth-${counter}`);
  await database.open();
  setDb(database);
  setRepos(createRepositories(database));
  remote = createFakeRemote();
  setRemote(remote.client);
  resetSyncState();
  resetAuth();
});

afterEach(async () => {
  // `cleanup()` d'abord : sans lui, la réinitialisation du store écrit dans un
  // composant encore monté et React signale une mise à jour hors `act`.
  cleanup();
  vi.restoreAllMocks();
  stopSync();
  resetSyncState();
  setRemote(null);
  setRepos(null);
  setDb(null);
  resetAuth();
  database.close();
  await Dexie.delete(database.name);
});

function signedIn(userId = USER) {
  useAuthStore.setState({
    status: "signed-in",
    session: { userId, email: "coach@gymnase.fr" },
  });
}

// ---------------------------------------------------------------------------

describe("écran d'authentification", () => {
  it("demande email et mot de passe", () => {
    useAuthStore.setState({ status: "signed-out" });
    render(<AuthScreen />);

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Mot de passe")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Se connecter" }),
    ).toBeInTheDocument();
  });

  it("bascule vers l'inscription et demande un mot de passe plus long", async () => {
    useAuthStore.setState({ status: "signed-out" });
    render(<AuthScreen />);

    await userEvent.click(
      screen.getByRole("button", { name: "Créer un compte" }),
    );

    expect(
      screen.getByRole("heading", { name: "Créer un compte" }),
    ).toBeVisible();
    // Aucun email à confirmer : le bouton d'envoi reste le seul geste.
    expect(screen.getByText(/6 caractères minimum/)).toBeVisible();
  });

  it("n'affiche qu'un seul champ en mode mot de passe oublié", async () => {
    useAuthStore.setState({ status: "signed-out" });
    render(<AuthScreen />);

    await userEvent.click(
      screen.getByRole("button", { name: "Mot de passe oublié" }),
    );

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.queryByLabelText("Mot de passe")).not.toBeInTheDocument();
  });

  it("connexion réussie : plus d'erreur, session établie", async () => {
    useAuthStore.setState({ status: "signed-out" });
    render(<AuthScreen />);

    await userEvent.type(screen.getByLabelText("Email"), "coach@gymnase.fr");
    await userEvent.type(screen.getByLabelText("Mot de passe"), "azerty123");
    await userEvent.click(screen.getByRole("button", { name: "Se connecter" }));

    await waitFor(() => {
      expect(useAuthStore.getState().error).toBeNull();
    });
    expect(remote.session?.userId).toBe("user-coach@gymnase.fr");
  });

  it("traduit une erreur d'identifiants", async () => {
    remote.client.auth.signInWithPassword = async () => ({
      data: null,
      error: { message: "Invalid login credentials" },
    });
    useAuthStore.setState({ status: "signed-out" });
    render(<AuthScreen />);

    await userEvent.type(screen.getByLabelText("Email"), "coach@gymnase.fr");
    await userEvent.type(screen.getByLabelText("Mot de passe"), "faux");
    await userEvent.click(screen.getByRole("button", { name: "Se connecter" }));

    // Le message d'API est en anglais technique ; l'écran doit parler français,
    // sans révéler si l'email existe.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Email ou mot de passe incorrect.",
    );
  });

  it("inscription : signale l'échec quand la confirmation d'email est active", async () => {
    remote.client.auth.signUp = async () => ({ data: null, error: null });
    useAuthStore.setState({ status: "signed-out" });
    render(<AuthScreen />);

    await userEvent.click(
      screen.getByRole("button", { name: "Créer un compte" }),
    );
    await userEvent.type(screen.getByLabelText("Email"), "coach@gymnase.fr");
    // Le libellé du champ d'inscription porte aussi l'indication de longueur :
    // d'où l'expression régulière, pour ne pas dépendre de ce texte d'aide.
    await userEvent.type(screen.getByLabelText(/Mot de passe/), "azerty123");
    await userEvent.click(
      screen.getByRole("button", { name: "Créer mon compte" }),
    );

    // Sans session renvoyée, aucun email ne part : rester sur cet écran ferait
    // croire à un compte créé.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /confirmation d'email est activée/,
    );
  });

  it("demande un lien, sans promettre un email", async () => {
    useAuthStore.setState({ status: "signed-out" });
    render(<AuthScreen />);

    await userEvent.click(
      screen.getByRole("button", { name: "Mot de passe oublié" }),
    );
    await userEvent.type(screen.getByLabelText("Email"), "coach@gymnase.fr");
    await userEvent.click(
      screen.getByRole("button", { name: "Envoyer le lien" }),
    );

    // Formulation conditionnelle : dire « un email a été envoyé » révélerait
    // quels comptes existent.
    expect(await screen.findByText(/Si un compte existe/)).toBeVisible();
  });

  it("un lien de récupération mène au nouveau mot de passe", () => {
    useAuthStore.setState({ status: "signed-in", recovering: true });
    render(<AuthScreen />);

    expect(
      screen.getByRole("heading", { name: "Nouveau mot de passe" }),
    ).toBeVisible();
    // Et non l'écran d'accueil : le jeton de récupération ne sert qu'à cela.
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it("un build sans configuration explique quoi faire", () => {
    useAuthStore.setState({ status: "unconfigured" });
    render(<AuthScreen />);

    expect(
      screen.getByRole("heading", { name: "Synchronisation non configurée" }),
    ).toBeVisible();
    expect(screen.getByText(/NEXT_PUBLIC_SUPABASE_URL/)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------

describe("garde-fou d'accès", () => {
  it("bloque les écrans de saisie sans session", () => {
    useAuthStore.setState({ status: "signed-out" });
    render(
      <AuthGate>
        <p>Grille de saisie</p>
      </AuthGate>,
    );

    expect(screen.queryByText("Grille de saisie")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("attend la session avant de décider", () => {
    // `init` neutralisé : ici on teste l'affichage pendant la résolution de la
    // session, pas la résolution elle-même (qui dépend de l'environnement).
    // `resetAuth()` le remet après ce test.
    useAuthStore.setState({ status: "loading", init: async () => {} });
    render(
      <AuthGate>
        <p>Grille de saisie</p>
      </AuthGate>,
    );

    expect(screen.queryByText("Grille de saisie")).not.toBeInTheDocument();
    expect(screen.getByText("Ouverture…")).toBeVisible();
  });

  it("ouvre les écrans une fois la session établie", async () => {
    signedIn();
    render(
      <AuthGate>
        <p>Grille de saisie</p>
      </AuthGate>,
    );

    expect(await screen.findByText("Grille de saisie")).toBeVisible();
  });

  it("rattache l'équipe avant d'ouvrir les écrans", async () => {
    signedIn();
    render(
      <AuthGate>
        <p>Grille de saisie</p>
      </AuthGate>,
    );

    await screen.findByText("Grille de saisie");

    // L'équipe existe déjà avec un `uuid` et un propriétaire : sans cela, le
    // moteur pousserait un `id` non-uuid et Postgres refuserait tout.
    const teams = await database.teams.toArray();
    expect(teams).toHaveLength(1);
    expect(teams[0]?.ownerId).toBe(USER);
    expect(teams[0]?.id).not.toBe("local");
  });

  it("refuse un appareil appartenant à un autre compte", async () => {
    // L'appareil contient déjà l'équipe du premier coach.
    const store = createRepositories(database);
    await store.teams.ensureLocal();
    await claimTeam(USER);

    signedIn("autre-coach");
    render(
      <AuthGate>
        <p>Grille de saisie</p>
      </AuthGate>,
    );

    // Sans ce refus, le second compte verrait les matchs du premier et les RLS
    // retireraient au premier l'accès aux siens.
    expect(
      await screen.findByRole("heading", { name: /autre compte/ }),
    ).toBeVisible();
    expect(screen.queryByText("Grille de saisie")).not.toBeInTheDocument();
  });

  it("affiche le formulaire de récupération plutôt que l'app", () => {
    useAuthStore.setState({
      status: "signed-in",
      session: { userId: USER, email: "coach@gymnase.fr" },
      recovering: true,
    });
    render(
      <AuthGate>
        <p>Grille de saisie</p>
      </AuthGate>,
    );

    expect(
      screen.getByRole("heading", { name: "Nouveau mot de passe" }),
    ).toBeVisible();
    expect(screen.queryByText("Grille de saisie")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------

describe("store d'authentification", () => {
  it("déclare l'environnement non configuré plutôt que d'échouer", async () => {
    // Sans cette branche, `init()` lèverait en accessing un client inexistant et
    // l'app resterait sur un écran vide, sans explication.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");

    await useAuthStore.getState().init();

    expect(useAuthStore.getState().status).toBe("unconfigured");
  });

  it("récupère une session déjà persistée au démarrage", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://projet.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x");
    remote.session = { userId: USER, email: "coach@gymnase.fr" };

    await useAuthStore.getState().init();

    expect(useAuthStore.getState().status).toBe("signed-in");
    expect(useAuthStore.getState().session?.userId).toBe(USER);
  });

  it("reste déconnecté si aucune session n'existe", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://projet.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x");

    await useAuthStore.getState().init();

    expect(useAuthStore.getState().status).toBe("signed-out");
    expect(useAuthStore.getState().session).toBeNull();
  });

  it("n'initialise qu'une fois", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://projet.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x");

    await useAuthStore.getState().init();
    const session = useAuthStore.getState().session;
    // Un second appel est ignoré : deux abonnements se cumulerient et chaque
    // événement de session serait traité deux fois.
    await useAuthStore.getState().init();

    expect(useAuthStore.getState().session).toBe(session);
  });

  it("traduit une panne réseau de l'initialisation", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://projet.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x");
    remote.client.auth.getSession = async () => {
      throw new Error("fetch failed");
    };

    await useAuthStore.getState().init();

    // Un rejet non traité laisserait l'app sur « Ouverture… » indéfiniment.
    expect(useAuthStore.getState().status).toBe("signed-out");
    expect(useAuthStore.getState().error).toMatch(/Réseau indisponible/);
  });

  it("déconnexion : libère la session", async () => {
    signedIn();
    await useAuthStore.getState().signOut();

    expect(useAuthStore.getState().status).toBe("signed-out");
    expect(useAuthStore.getState().session).toBeNull();
    expect(useAuthStore.getState().busy).toBe(false);
  });

  it("changement de mot de passe : confirme et quitte la récupération", async () => {
    useAuthStore.setState({ status: "signed-in", recovering: true });

    expect(await useAuthStore.getState().updatePassword("nouveau123")).toBe(
      true,
    );
    expect(useAuthStore.getState().recovering).toBe(false);
    expect(useAuthStore.getState().notice).toMatch(/Mot de passe mis à jour/);
  });

  it("changement de mot de passe refusé : l'erreur reste à l'écran", async () => {
    remote.client.auth.updatePassword = async () => ({
      data: null,
      error: { message: "Password should be at least 6 characters" },
    });

    expect(await useAuthStore.getState().updatePassword("123")).toBe(false);
    expect(useAuthStore.getState().error).toMatch(/6 caractères/);
  });

  it("inscription réussie : aucune erreur, session immédiate", async () => {
    expect(
      await useAuthStore.getState().signUp("coach@gymnase.fr", "azerty123"),
    ).toBe(true);
    expect(useAuthStore.getState().error).toBeNull();
    expect(useAuthStore.getState().busy).toBe(false);
  });

  it("inscription refusée : le motif est connu de l'utilisateur", async () => {
    remote.client.auth.signUp = async () => ({
      data: null,
      error: { message: "User already registered" },
    });

    expect(
      await useAuthStore.getState().signUp("coach@gymnase.fr", "azerty123"),
    ).toBe(false);
    expect(useAuthStore.getState().error).toMatch(/existe déjà/);
  });

  it("demande de lien : la formulation reste conditionnelle", async () => {
    expect(await useAuthStore.getState().requestReset("coach@gymnase.fr")).toBe(
      true,
    );
    expect(useAuthStore.getState().notice).toMatch(/Si un compte existe/);
  });

  it("demande de lien refusée : l'erreur est affichée", async () => {
    remote.client.auth.resetPasswordForEmail = async () => ({
      data: null,
      error: { message: "SMTP non configuré" },
    });

    expect(await useAuthStore.getState().requestReset("coach@gymnase.fr")).toBe(
      false,
    );
    expect(useAuthStore.getState().error).toMatch(/SMTP/);
  });

  it("suit les événements de session reçus pendant l'initialisation", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://projet.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x");

    // Un faux qui émet, pour exercer le listener que le store enregistre avant
    // `getSession()` : une session rafraîchie entre les deux ne doit pas être
    // ratée.
    const listeners: Array<(event: string, session: unknown) => void> = [];
    let resolveSession: (value: AuthSession) => void = () => {};
    remote.client.auth.onAuthStateChange = (listener) => {
      listeners.push(listener as (event: string, session: unknown) => void);
      return () => {
        listeners.length = 0;
      };
    };
    remote.client.auth.getSession = () =>
      new Promise((resolve) => {
        resolveSession = resolve;
      });

    const pending = useAuthStore.getState().init();

    // L'événement précède la réponse de `getSession()` : c'est exactement la
    // course que l'abonnement tardif perdrait.
    listeners[0]?.("recovery", { userId: USER, email: "coach@gymnase.fr" });
    expect(useAuthStore.getState().recovering).toBe(true);
    expect(useAuthStore.getState().status).toBe("signed-in");

    listeners[0]?.("signed-out", null);
    expect(useAuthStore.getState().status).toBe("signed-out");
    expect(useAuthStore.getState().recovering).toBe(false);

    listeners[0]?.("signed-in", { userId: USER, email: "coach@gymnase.fr" });
    resolveSession({ userId: USER, email: "coach@gymnase.fr" });
    await pending;

    expect(useAuthStore.getState().status).toBe("signed-in");
    expect(useAuthStore.getState().recovering).toBe(false);
  });

  it("efface l'erreur à la demande", async () => {
    useAuthStore.setState({ error: "une erreur" });
    useAuthStore.getState().clearError();
    expect(useAuthStore.getState().error).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("voyant de synchronisation", () => {
  it("annonce un état lisible plutôt qu'une icône", async () => {
    render(<SyncIndicator />);
    await waitFor(() => {
      expect(screen.getByTestId("sync-indicator")).toHaveTextContent(
        "synchronisé",
      );
    });
  });

  it("donne le compte des mutations en attente", async () => {
    // Une entrée d'outbox signifie une attente, même quand rien n'a encore été
    // envoyé : c'est le cas ordinaire en gymnase, et c'est ce que « 3 en attente »
    // dit sans dramatiser.
    const store = createRepositories(database);
    const team = await store.teams.ensureLocal();
    await store.players.create(team.id, {
      firstName: "Karim",
      lastName: "Bernard",
      number: 4,
    });
    resetSyncState();

    render(<SyncIndicator />);
    // `syncNow` publie l'état depuis une promesse : hors `act`, React ne peut pas
    // rattacher la mise à jour au rendu et le signale.
    await act(async () => {
      await syncNow();
    });

    // Une fois le cycle passé, la file est vidée : le voyant redevient discret.
    await waitFor(() => {
      expect(screen.getByTestId("sync-indicator")).toHaveTextContent(
        "synchronisé",
      );
    });
  });

  it("relance la synchronisation au tap, en ignorant le backoff", async () => {
    render(<SyncIndicator />);

    await userEvent.click(screen.getByTestId("sync-indicator"));

    // Le tap déclenche un cycle malgré le backoff : sans `force`, le coach
    // devrait attendre — jusqu'à 5 minutes — que le moteur réessaie seul.
    expect(remote.calls.some((call) => call.op === "select")).toBe(true);
    expect(screen.getByTestId("sync-indicator")).toBeInTheDocument();
  });

  it("affiche hors-ligne quand le navigateur n'a pas de réseau", async () => {
    // `navigator.onLine` à faux est exactement le mode avion en gymnase.
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);

    render(<SyncIndicator />);
    // `syncNow` publie l'état depuis une promesse : hors `act`, React ne peut pas
    // rattacher la mise à jour au rendu et le signale.
    await act(async () => {
      await syncNow();
    });

    await waitFor(() => {
      expect(screen.getByTestId("sync-indicator")).toHaveTextContent(
        "hors-ligne",
      );
    });
    expect(screen.getByTestId("sync-indicator")).toHaveAttribute(
      "data-state",
      "offline",
    );
  });

  it("distingue les quatre états et leurs couleurs", async () => {
    render(<SyncIndicator />);

    // Un cycle réussi : « synchronisé », gris, et rien qui attire l'œil.
    expect(screen.getByTestId("sync-indicator")).toHaveTextContent(
      "synchronisé",
    );

    await act(async () => {
      await syncNow();
    });
    expect(screen.getByTestId("sync-indicator")).toHaveAttribute(
      "data-state",
      "idle",
    );
  });

  it("affiche un compte d'attente plutôt qu'un mot", async () => {
    render(<SyncIndicator />);

    // Trois mutations en file, réseau coupé : le coach doit savoir que des
    // actions attendent, sans qu'il ait à deviner ce que « 3 » veut dire.
    const store = createRepositories(database);
    const team = await store.teams.ensureLocal();
    await store.players.createMany(team.id, [
      { firstName: "Karim", lastName: "Bernard", number: 4 },
      { firstName: "Yanis", lastName: "Petit", number: 5 },
      { firstName: "Nora", lastName: "Blanc", number: 6 },
    ]);

    // Push refusé : les entrées restent en file, et c'est ce que le voyant doit
    // dire — pas « erreur », puisque l'échec vient du réseau simulé plus bas.
    remote.failOn.set("players", "fetch failed");

    await act(async () => {
      await syncNow({ force: true });
    });

    expect(screen.getByTestId("sync-indicator")).toHaveTextContent(
      /en attente/,
    );
    // Hors-ligne : une attente est normale en gymnase, ce n'est pas une alerte.
    expect(screen.getByTestId("sync-indicator")).toHaveAttribute(
      "data-state",
      "offline",
    );
  });

  it("nomme la cause en cas d'erreur", async () => {
    remote.failOn.set("players", "violation de politique RLS");
    const store = createRepositories(database);
    const team = await store.teams.ensureLocal();
    await store.players.create(team.id, {
      firstName: "Karim",
      lastName: "Bernard",
      number: 4,
    });

    render(<SyncIndicator />);
    // `syncNow` publie l'état depuis une promesse : hors `act`, React ne peut pas
    // rattacher la mise à jour au rendu et le signale.
    await act(async () => {
      await syncNow();
    });

    await waitFor(() => {
      const indicator = screen.getByTestId("sync-indicator");
      expect(indicator).toHaveTextContent("erreur");
      expect(indicator).toHaveAttribute("title", "violation de politique RLS");
    });
  });
});
