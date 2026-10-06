import type { AuthSession, RemoteClient, RemoteResult } from "@/sync/remote";

/**
 * Faux client Supabase pour les tests.
 *
 * Le moteur de synchronisation a une propriété irritante pour les tests : son
 * environnement normal est *l'absence de réseau*. Un test qui devrait dépendre
 * d'un vrai projet Supabase serait à la fois lent, non déterministe, et
 * impossible à faire échouer volontairement — or « que se passe-t-il quand
 * l'upsert échoue ? » est précisément la question la plus importante du module.
 *
 * Ce faux implémente donc les trois seules opérations utilisées (upsert, select
 * filtré, lecture de session), avec deux crochets : `failOn` pour injecter une
 * erreur et `calls` pour observer l'ordre des requêtes — l'ordre de poussée
 * (`teams` → `players` → `matches` → `actions`) est une garantie de l'engine, et
 * elle ne se vérifie qu'en enregistrant les appels.
 */

export interface FakeRemote {
  client: RemoteClient;
  /** Contenu courant des tables, indexé par nom de table. */
  tables: Map<string, Record<string, unknown>[]>;
  /** Appels dans l'ordre : `{ op, table, rows }`. */
  calls: Array<{ op: "upsert" | "select"; table: string; rows?: number }>;
  /** Session courante simulée. */
  session: AuthSession | null;
  /** Erreur à renvoyer pour `upsert`, par nom de table. */
  failOn: Map<string, string>;
  /** Erreur à renvoyer pour `select`, par nom de table. */
  failSelectOn: Map<string, string>;
}

export function createFakeRemote(
  seed: Record<string, Record<string, unknown>[]> = {},
): FakeRemote {
  const tables = new Map<string, Record<string, unknown>[]>();
  for (const [name, rows] of Object.entries(seed)) {
    tables.set(
      name,
      rows.map((row) => ({ ...row })),
    );
  }

  const fake: FakeRemote = {
    client: null as unknown as RemoteClient,
    tables,
    calls: [],
    session: null,
    failOn: new Map(),
    failSelectOn: new Map(),
  };

  fake.client = {
    from(table: string) {
      return {
        async upsert(
          rows: readonly Record<string, unknown>[],
          options: { onConflict: string },
        ): Promise<RemoteResult<unknown>> {
          fake.calls.push({ op: "upsert", table, rows: rows.length });

          const failure = fake.failOn.get(table);
          if (failure !== undefined) {
            return { data: null, error: { message: failure } };
          }

          const existing = tables.get(table) ?? [];
          for (const row of rows) {
            const key = String(row[options.onConflict]);
            const index = existing.findIndex(
              (candidate) => String(candidate[options.onConflict]) === key,
            );
            // Un upsert écrit l'état **entier** de la ligne : pas de fusion
            // champ par champ, comme le fait PostgREST.
            if (index === -1) {
              existing.push({ ...row });
            } else {
              existing[index] = { ...row };
            }
          }
          tables.set(table, existing);

          return { data: rows, error: null };
        },

        select(columns: string) {
          let filter: { column: string; value: number } | null = null;
          let max: number | null = null;

          const query = {
            gt(column: string, value: number) {
              filter = { column, value };
              return query;
            },
            order(column: string) {
              max = column === "updated_at" ? 1 : null;
              return query;
            },
            limit() {
              return query;
            },
            async execute(): Promise<RemoteResult<unknown[]>> {
              fake.calls.push({ op: "select", table, rows: 0 });

              const failure = fake.failSelectOn.get(table);
              if (failure !== undefined) {
                return { data: null, error: { message: failure } };
              }

              let rows = [...(tables.get(table) ?? [])];
              if (filter !== null) {
                const { column, value } = filter;
                rows = rows.filter((row) => Number(row[column]) > value);
              }
              if (max !== null) {
                rows.sort(
                  (a, b) => Number(a.updated_at) - Number(b.updated_at),
                );
              }
              return { data: rows, error: null };
            },
          };

          void columns;
          return query;
        },
      };
    },

    auth: {
      async getSession() {
        return fake.session;
      },
      onAuthStateChange() {
        return () => {
          /* pas d'émission dans le faux : les tests déclenchent à la main */
        };
      },
      async signInWithPassword({ email }) {
        const session = { userId: `user-${email}`, email };
        fake.session = session;
        return { data: session, error: null };
      },
      async signUp({ email }) {
        const session = { userId: `user-${email}`, email };
        fake.session = session;
        return { data: session, error: null };
      },
      async signOut() {
        fake.session = null;
        return { data: null, error: null };
      },
      async resetPasswordForEmail() {
        return { data: null, error: null };
      },
      async updatePassword() {
        return { data: fake.session, error: null };
      },
    },
  };

  return fake;
}
