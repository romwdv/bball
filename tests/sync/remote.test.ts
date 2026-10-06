import { afterEach, describe, expect, it, vi } from "vitest";
import { createRemote, type RemoteClient } from "@/sync/remote";
import {
  isSupabaseConfigured,
  readSupabaseEnv,
  remote,
  setRemote,
  setSupabase,
  supabase,
} from "@/sync/supabase-client";

/**
 * Tests de l'adaptateur Supabase.
 *
 * Cette couche n'est pas métier : elle traduit `supabase-js` vers l'interface
 * étroite du moteur. Les tests la couvrent avec un client **faux**, ce qui est
 * possible précisément parce qu'elle est mince — et c'est ce qui permet au reste
 * de la suite de tourner sans réseau.
 *
 * Deux détails méritent un test chacun, parce que ce sont les seules occasions
 * d'une erreur silencieuse dans tout le projet :
 *   - `getSession` distingue `null` de `{ user: null }`, deux formes de « pas de
 *     session » que `supabase-js` utilise indifféremment ;
 *   - `updateUser` ne renvoie pas de session, il faut la relire.
 */

const ENV_URL = "https://projet.supabase.co";
const ENV_KEY = "sb_publishable_test";

afterEach(() => {
  vi.unstubAllEnvs();
  setSupabase(null);
});

/** Client `supabase-js` minimal, enregistrant les requêtes reçues. */
function stubSupabase() {
  const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
  let session: { user: { id: string; email?: string } | null } | null = null;
  let authListener: ((event: string, session: unknown) => void) | null = null;

  const client = {
    from(table: string) {
      return {
        select: (...args: unknown[]) => {
          calls.push({ table, op: "select", args });
          const builder: Record<string, unknown> = {};
          for (const method of ["gt", "order", "limit"]) {
            builder[method] = (...chainArgs: unknown[]) => {
              calls.push({ table, op: method, args: chainArgs });
              return builder;
            };
          }
          // Thenable : `supabase-js` rend la requête exécutable directement.
          (builder as { then: unknown }).then = (
            onOk: (result: { data: unknown; error: null }) => void,
          ) => {
            calls.push({ table, op: "execute", args: [] });
            onOk({ data: [], error: null });
          };
          void args;
          return builder;
        },
        upsert: async (...args: unknown[]) => {
          calls.push({ table, op: "upsert", args });
          return { data: null, error: { message: "échec RLS" } };
        },
      };
    },
    auth: {
      // `getSession` répond `{ data: { session } }`, pas `{ session }` : l'erreur
      // serait ici un `undefined` déréférencé, très loin de sa cause.
      getSession: async () => ({
        data: { session: session as { user: { id: string } } | null },
      }),
      onAuthStateChange: (listener: (event: string, s: unknown) => void) => {
        authListener = listener;
        return {
          data: {
            subscription: {
              // L'image est réelle, pas un spy : un désabonnement qui n'enlève
              // pas le listener laisserait le faux se comporter comme un client
              // qui ignore `unsubscribe()`, et le test passerait pour rien.
              unsubscribe: () => {
                authListener = null;
              },
            },
          },
        };
      },
      signInWithPassword: async () => ({
        data: { session: { user: { id: "u1", email: "a@b.fr" } } },
        error: null,
      }),
      signUp: async () => ({ data: { session: null }, error: null }),
      signOut: async () => ({ error: null }),
      resetPasswordForEmail: async (_email: string, options?: unknown) => {
        calls.push({ table: "auth", op: "reset", args: [options] });
        return { error: null };
      },
      updateUser: async () => ({
        data: { user: { id: "u1" } },
        error: null,
      }),
    },
  };

  return {
    client: client as unknown as Parameters<typeof createRemote>[0],
    calls,
    setSession: (next: typeof session) => {
      session = next;
    },
    emit: (event: string, value: unknown) => authListener?.(event, value),
  };
}

// ---------------------------------------------------------------------------

describe("lecture de l'environnement", () => {
  it("refuse une configuration absente", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    expect(readSupabaseEnv()).toBeNull();
    expect(isSupabaseConfigured()).toBe(false);
  });

  it("refuse les valeurs de remplacement de .env.example", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://xxxxxxxxxxxx.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_xxx");
    // Un `select` sur une URL de remplacement échoue en 404, et une clé fausse
    // est refusée par l'API : deux messages incompréhensibles là où un test de
    // forme donne une cause.
    expect(readSupabaseEnv()).toBeNull();
  });

  it("refuse une URL non https", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://projet.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", ENV_KEY);
    expect(readSupabaseEnv()).toBeNull();
  });

  it("accepte une configuration complète", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", ENV_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", ENV_KEY);
    expect(readSupabaseEnv()).toEqual({
      url: ENV_URL,
      publishableKey: ENV_KEY,
    });
    expect(isSupabaseConfigured()).toBe(true);
  });

  it("ignore les espaces parasites", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `  ${ENV_URL}  `);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", ` ${ENV_KEY} `);
    expect(readSupabaseEnv()?.url).toBe(ENV_URL);
  });

  it("lance une exception explicite si le client est demandé sans config", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    // Mieux vaut une exception visible en console qu'un `null` propagé dans tout
    // le moteur de synchronisation.
    expect(() => supabase()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("mémorise le client plutôt que de le recréer", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", ENV_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", ENV_KEY);
    const first = supabase();
    expect(supabase()).toBe(first);

    // `setSupabase` invalide aussi l'adaptateur, sinon il garderait un client
    // construit sur l'ancienne configuration.
    setSupabase(null);
    expect(supabase()).not.toBe(first);
  });

  it("l'adaptateur est construit une fois et injectable", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", ENV_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", ENV_KEY);

    const first = remote();
    expect(remote()).toBe(first);

    // Injection par les tests : le moteur ne connaît que l'interface.
    const injected = createRemote(stubSupabase().client);
    setRemote(injected);
    expect(remote()).toBe(injected);

    setRemote(null);
    expect(remote()).not.toBe(injected);
  });
});

// ---------------------------------------------------------------------------

describe("adaptateur : lecture", () => {
  it("enchaîne gt, order et limit sans perdre de filtre", async () => {
    const stub = stubSupabase();
    const remote: RemoteClient = createRemote(stub.client);

    await remote.from("actions").select("*").gt("updated_at", 42).limit(500);

    // L'adaptateur pose le tri à la construction et enchaîne ensuite les filtres :
    // l'ordre des appels sur le client n'a pas d'importance, seule la présence du
    // `gt` et de la limite compte.
    const ops = stub.calls
      .filter((c) => c.table === "actions")
      .map((c) => c.op);
    expect(ops).toEqual(["select", "order", "gt", "limit"]);
    expect(stub.calls.find((c) => c.op === "gt")?.args).toEqual([
      "updated_at",
      42,
    ]);
    expect(stub.calls.find((c) => c.op === "limit")?.args).toEqual([500]);
  });

  it("remonte l'erreur d'un upsert", async () => {
    const remote = createRemote(stubSupabase().client);
    const result = await remote.from("teams").upsert([{ id: "x" }], {
      onConflict: "id",
    });
    expect(result.error?.message).toBe("échec RLS");
    expect(result.data).toBeNull();
  });

  it("remonte l'erreur d'un select", async () => {
    const remote = createRemote(stubSupabase().client);
    const result = await remote.from("teams").select("*").limit(1).execute();
    expect(result.data).toEqual([]);
    expect(result.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("adaptateur : session", () => {
  it("renseigne l'uid et l'email", async () => {
    const stub = stubSupabase();
    const remote = createRemote(stub.client);

    expect(await remote.auth.getSession()).toBeNull();
    stub.setSession({ user: { id: "u1", email: "coach@gymnase.fr" } });
    expect(await remote.auth.getSession()).toEqual({
      userId: "u1",
      email: "coach@gymnase.fr",
    });
  });

  it("traite `{ user: null }` comme l'absence de session", async () => {
    const stub = stubSupabase();
    stub.setSession({ user: null });
    // `supabase-js` emploie les deux formes selon le chemin ; les confondre
    // renverrait l'écran de connexion pour une session valide, ou l'inverse.
    expect(await createRemote(stub.client).auth.getSession()).toBeNull();
  });

  it("distingue une récupération d'une connexion", () => {
    const stub = stubSupabase();
    const remote = createRemote(stub.client);
    const seen: string[] = [];

    remote.auth.onAuthStateChange((event, session) => {
      seen.push(`${event}:${session?.userId ?? "null"}`);
    });

    stub.emit("PASSWORD_RECOVERY", { user: { id: "u1" } });
    stub.emit("SIGNED_IN", { user: { id: "u1" } });
    stub.emit("SIGNED_OUT", null);

    expect(seen).toEqual(["recovery:u1", "signed-in:u1", "signed-out:null"]);
  });

  it("connexion : renvoie la session", async () => {
    const remote = createRemote(stubSupabase().client);
    const result = await remote.auth.signInWithPassword({
      email: "a@b.fr",
      password: "x",
    });
    expect(result.error).toBeNull();
    expect(result.data?.userId).toBe("u1");
  });

  it("inscription sans session : le signal est transmis tel quel", async () => {
    // `null` signifie « aucun email ne partira », ce que l'écran doit traduire.
    const remote = createRemote(stubSupabase().client);
    expect(
      (await remote.auth.signUp({ email: "a@b.fr", password: "x" })).data,
    ).toBeNull();
  });

  it("relit la session après un changement de mot de passe", async () => {
    const stub = stubSupabase();
    stub.setSession({ user: { id: "u1" } });
    const remote = createRemote(stub.client);

    // `updateUser` ne renvoie que l'utilisateur ; c'est à l'appelant de relire la
    // session, qui a changé de jeton.
    const result = await remote.auth.updatePassword("nouveau");
    expect(result.error).toBeNull();
    expect(result.data?.userId).toBe("u1");
  });

  it("connexion refusée : l'erreur remonte, la session reste nulle", async () => {
    const stub = stubSupabase();
    (
      stub.client.auth as unknown as { signInWithPassword: unknown }
    ).signInWithPassword = async () => ({
      data: { session: null },
      error: { message: "refusé" },
    });
    const result = await createRemote(stub.client).auth.signInWithPassword({
      email: "a@b.fr",
      password: "x",
    });
    expect(result.error?.message).toBe("refusé");
    expect(result.data).toBeNull();
  });

  it("inscription refusée : le motif est transmis", async () => {
    const stub = stubSupabase();
    (stub.client.auth as unknown as { signUp: unknown }).signUp = async () => ({
      data: { session: null },
      error: { message: "User already registered" },
    });
    const result = await createRemote(stub.client).auth.signUp({
      email: "a@b.fr",
      password: "x",
    });
    expect(result.error?.message).toBe("User already registered");
  });

  it("le lien de réinitialisation revient sur l'origine de l'app", async () => {
    const stub = stubSupabase();
    await createRemote(stub.client).auth.resetPasswordForEmail("a@b.fr");

    // Le lien doit rouvrir l'application, pas une page Supabase : c'est ce qui
    // permet à `detectSessionInUrl` de convertir le fragment en session.
    const options = stub.calls.find((c) => c.op === "reset")?.args[0] as {
      redirectTo: string;
    };
    expect(options.redirectTo).toBe(window.location.origin);
  });

  it("changement de mot de passe refusé : la session n'est pas relue", async () => {
    const stub = stubSupabase();
    (stub.client.auth as unknown as { updateUser: unknown }).updateUser =
      async () => ({ data: { user: null }, error: { message: "trop court" } });

    const result = await createRemote(stub.client).auth.updatePassword("123");
    expect(result.error?.message).toBe("trop court");
    expect(result.data).toBeNull();
  });

  it("l'abonnement se désabonne", () => {
    const stub = stubSupabase();
    const remoteClient = createRemote(stub.client);
    const seen: string[] = [];

    const unsubscribe = remoteClient.auth.onAuthStateChange((event) =>
      seen.push(event),
    );
    stub.emit("SIGNED_IN", { user: { id: "u1" } });
    unsubscribe();
    stub.emit("SIGNED_OUT", null);

    expect(seen).toEqual(["signed-in"]);
  });

  it("une session sans email reste exploitable", async () => {
    const stub = stubSupabase();
    stub.setSession({ user: { id: "u1" } });
    // Twitter ou un fournisseur sans email : le coach est identifié par son uid,
    // l'email n'est qu'un affichage.
    expect(await createRemote(stub.client).auth.getSession()).toEqual({
      userId: "u1",
      email: null,
    });
  });

  it("déconnexion : aucune donnée, aucune erreur", async () => {
    const remote = createRemote(stubSupabase().client);
    expect(await remote.auth.signOut()).toEqual({ data: null, error: null });
  });
});
