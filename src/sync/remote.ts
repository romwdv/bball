import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Adaptateur Supabase — l'interface étroite dont la synchronisation a besoin.
 *
 * Pourquoi ne pas utiliser `SupabaseClient` directement dans le moteur ?
 * `supabase-js` expose une API de requêtage très_large et typée à travers des
 * génériques liés à un type `Database` généré, que ce projet n'a pas (le schéma
 * est maintenu à la main dans `supabase/schema.sql`). Sans ce type, les réponses
 * remontent en `any` et le `any` se propage jusqu'aux repositories.
 *
 * Cette interface apporte trois choses :
 *   1. des réponses `unknown` — donc aucune illusion de typage sur des données
 *      que seule la validation Zod de `mapping.ts` peut garantir ;
 *   2. une frontière de test : un faux client de vingt lignes remplace un réseau,
 *      ce qui rend le moteur de synchronisation testable hors ligne, ce qui est
 *      précisément son environnement normal ;
 *   3. un seul point d'adaptation — le jour où le projet génère ses types
 *      (`supabase gen types`), seule cette fonction change.
 *
 * `execute()` est explicite plutôt qu'un objet *thenable* : un thenable est plus
 * court, mais sa lecture dans une trace d'erreur ne dit pas d'où vient l'appel.
 */

/** Erreur renvoyée par Supabase, réduite à ce que l'app affiche. */
export interface RemoteError {
  message: string;
}

export interface RemoteResult<T> {
  data: T | null;
  error: RemoteError | null;
}

/** Sélecteur chaînable, volontairement sans `await` implicite. */
export interface RemoteQuery {
  /** Filtre strict : `column > value`. Le curseur de tirage s'appuie dessus. */
  gt(column: string, value: number): RemoteQuery;
  order(column: string, options: { ascending: boolean }): RemoteQuery;
  limit(count: number): RemoteQuery;
  execute(): Promise<RemoteResult<unknown[]>>;
}

export interface RemoteTable {
  /**
   * Upsert sur le conflit de la clé primaire.
   *
   * L'`onConflict` explicite est indispensable : PostgREST déduirait déjà sur la
   * clé primaire, mais l'intention resterait non écrite, et un index unique
   * `(match_id, seq)` côté base pourrait un jour changer la dédupe sans qu'on le
   * voie dans le code client.
   */
  upsert(
    rows: readonly Record<string, unknown>[],
    options: { onConflict: string },
  ): Promise<RemoteResult<unknown>>;
  select(columns: string): RemoteQuery;
  /**
   * Suppression par identifiant.
   *
   * `ids` plutôt qu'un `id` : une suppression porte toujours sur un match **et**
   * ses actions, donc sur plusieurs lignes d'une même table.
   */
  deleteByIds(ids: readonly string[]): Promise<RemoteResult<unknown>>;
}

/** Session telle que l'app en a besoin — pas le JWT, pas les quotas. */
export interface AuthSession {
  userId: string;
  email: string | null;
}

export interface Credentials {
  email: string;
  password: string;
}

/**
 * Événement d'authentification, réduit aux trois états qui changent l'écran.
 *
 * `recovery` est distinct de `signed-in` parce que l'UI ne fait pas la même
 * chose : une session ordinaire ouvre l'app, une session de récupération ouvre
 * le formulaire de nouveau mot de passe. Le confondre ferait repartir le coach
 * vers l'écran de connexion alors que son jeton est valide et frais.
 */
export type AuthEvent = "signed-in" | "signed-out" | "recovery";

export interface RemoteAuth {
  getSession(): Promise<AuthSession | null>;
  onAuthStateChange(
    listener: (event: AuthEvent, session: AuthSession | null) => void,
  ): () => void;
  signInWithPassword(
    credentials: Credentials,
  ): Promise<RemoteResult<AuthSession>>;
  signUp(credentials: Credentials): Promise<RemoteResult<AuthSession | null>>;
  signOut(): Promise<RemoteResult<null>>;
  resetPasswordForEmail(email: string): Promise<RemoteResult<null>>;
  updatePassword(password: string): Promise<RemoteResult<AuthSession | null>>;
}

export interface RemoteClient {
  from(table: string): RemoteTable;
  auth: RemoteAuth;
}

/** Réduit une session `supabase-js` à ce que l'app consomme. */
function toSession(
  session: { user: { id: string; email?: string } | null } | null,
): AuthSession | null {
  // Deux formes de « pas de session » coexistent dans `supabase-js` : `null`
  // quand la clé n'existe pas, `{ user: null }` quand le jeton est expiré. Les
  // deux doivent finir dans le même état « déconnecté », sinon un refresh
  // raté renverrait l'écran de connexion sans raison.
  if (session === null || session.user === null) return null;
  return { userId: session.user.id, email: session.user.email ?? null };
}

/** Traduit une erreur `supabase-js` — souvent `null`, donc l'adaptation est réelle. */
function toError(error: { message: string } | null): RemoteError | null {
  return error === null ? null : { message: error.message };
}

/** Enveloppe un vrai client Supabase dans l'interface étroite. */
export function createRemote(client: SupabaseClient): RemoteClient {
  return {
    from(table: string): RemoteTable {
      const builder = client.from(table);
      return {
        upsert: async (rows, options) => {
          const result = await builder.upsert(
            rows as Record<string, unknown>[],
            { onConflict: options.onConflict },
          );
          return { data: result.data, error: toError(result.error) };
        },
        deleteByIds: async (ids: readonly string[]) => {
          // `.in()` plutôt qu'un `eq` par ligne : une seule requête, donc un seul
          // aller-retour réseau par cycle. Les tables concernées sont indexées sur
          // `match_id` — voir `supabase/schema.sql`.
          const result = await builder.delete().in("id", ids as string[]);
          return { data: result.data, error: toError(result.error) };
        },
        select: (columns: string): RemoteQuery => {
          // Chaque appel repart de la requête complète : une chaîne de filtres
          // mutable partagée entre deux tirages parallèles finirait par
          // transporter le `gt` du premier sur le second.
          let query = builder.select(columns).order("updated_at", {
            ascending: true,
          });

          const wrapper: RemoteQuery = {
            gt(column, value) {
              query = query.gt(column, value);
              return wrapper;
            },
            order(column, options) {
              query = query.order(column, options);
              return wrapper;
            },
            limit(count) {
              query = query.limit(count);
              return wrapper;
            },
            execute: async () => {
              const result = await query;
              return { data: result.data, error: toError(result.error) };
            },
          };
          return wrapper;
        },
      };
    },

    auth: {
      getSession: async () => {
        const { data } = await client.auth.getSession();
        return toSession(data.session);
      },
      onAuthStateChange: (listener) => {
        const {
          data: { subscription },
        } = client.auth.onAuthStateChange((event, session) => {
          const reduced = toSession(session);
          if (event === "PASSWORD_RECOVERY") {
            listener("recovery", reduced);
            return;
          }
          listener(reduced === null ? "signed-out" : "signed-in", reduced);
        });
        return () => {
          subscription.unsubscribe();
        };
      },
      signInWithPassword: async ({ email, password }) => {
        const { data, error } = await client.auth.signInWithPassword({
          email,
          password,
        });
        return { data: toSession(data.session), error: toError(error) };
      },
      signUp: async ({ email, password }) => {
        const { data, error } = await client.auth.signUp({ email, password });
        // `session` est `null` quand la confirmation d'email est activée. Le
        // projet la désactive (PLAN.md §5), donc `null` signifie ici « aucun
        // email ne partira » : l'appelant doit le dire plutôt que de boucler.
        return { data: toSession(data.session), error: toError(error) };
      },
      signOut: async () => {
        const { error } = await client.auth.signOut();
        return { data: null, error: toError(error) };
      },
      resetPasswordForEmail: async (email) => {
        const { error } = await client.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        });
        return { data: null, error: toError(error) };
      },
      updatePassword: async (password) => {
        const { error } = await client.auth.updateUser({ password });
        const translated = toError(error);
        if (translated !== null) {
          return { data: null, error: translated };
        }
        // `updateUser` ne renvoie que l'utilisateur, pas la session. Le
        // changement de mot de passe **invalide** les sessions précédentes et en
        // émet une nouvelle : la relire est donc la seule façon de dire à
        // l'appelant que l'app tient une session valide, plutôt que de le laisser
        // croire sur la seule foi d'un succès d'écriture.
        const session = await client.auth.getSession();
        return { data: toSession(session.data.session), error: null };
      },
    },
  };
}
