import { createRepositories, type Repositories } from "@/data/repositories";
import { db, type SpaceBunnyDB } from "@/data/schema";

/**
 * Point d'entrée unique de la couche de données.
 *
 * Les composants n'importent que d'ici : ils obtiennent des repositories, jamais
 * une base. Ce détour évite qu'un composant IndexedDB s'installe par erreur,
 * ce qui le rendrait impossible à tester et à remplacer par Supabase en phase 6.
 */

let repositories: Repositories | null = null;

/** Base partagée. Exposée pour les transactions multi-tables et les tests. */
export function dataDb(): SpaceBunnyDB {
  return db();
}

/** Repositories partagés, créés à la première utilisation. */
export function repos(): Repositories {
  if (repositories === null) {
    repositories = createRepositories(db());
  }
  return repositories;
}

/** Remplace l'instance partagée. Réservé aux tests. */
export function setRepos(next: Repositories | null): void {
  repositories = next;
}

export {
  LOCAL_TEAM_ID,
  quartersOf,
  toAction,
  toMatch,
  toPlayer,
  toTeam,
  type ActionRepository,
  type AppendResult,
  type MatchRepository,
  type NewMatch,
  type NewPlayer,
  type PlayerRepository,
  type Repositories,
  type TeamRepository,
} from "@/data/repositories";

export {
  ack,
  clear as clearOutbox,
  enqueue,
  entryFor,
  fail,
  outboxKey,
  peek,
  pendingCount,
} from "@/data/outbox";

export {
  DB_NAME,
  migrateV1ToV2,
  setDb,
  SYNC_KEY,
  SpaceBunnyDB,
  V1_SCHEMA,
  V2_SCHEMA,
  type ActionRow,
  type MatchRow,
  type OutboxEntry,
  type PlayerRow,
  type SyncEntity,
  type SyncStateRow,
  type TeamRow,
} from "@/data/schema";

export { isUuid, newId } from "@/data/ids";
