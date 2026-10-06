import Dexie, { type Table, type Transaction } from "dexie";
import type { Action, Match, Player, Team } from "@/domain/types";

/**
 * Schéma IndexedDB et lignes persistées.
 *
 * Ce fichier ne décrit que **ce qui est stocké**. La logique métier reste dans
 * `src/domain`, qui ignore complètement IndexedDB. Les repositories de
 * `src/data` sont le seul endroit où les deux se rencontrent.
 */

// ---------------------------------------------------------------------------
// Lignes persistées
// ---------------------------------------------------------------------------

/**
 * Horodatage de dernière écriture locale.
 *
 * Ajouté par la migration v1 → v2, il est ce qui rend le *tirage descendant* de la
 * synchronisation possible (`updated_at > lastPulledAt`, voir PLAN.md §5). Les
 * actions étant immuables sauf soft-delete, `updatedAt` couvre les deux cas : la
 * création et l'annulation.
 */
export interface Timestamped {
  updatedAt: number;
}

export type TeamRow = Team & Timestamped;
export type PlayerRow = Player & Timestamped;
export type MatchRow = Match & Timestamped;
export type ActionRow = Action & Timestamped;

/**
 * Curseur de synchronisation.
 *
 * `key` est toujours la constante `SYNC_KEY` : une seule équipe, donc un seul
 * curseur. La clé reste une clé primaire plutôt qu'un singleton en module pour
 * que l'état survive à un rechargement et soit vidable avec `clear()`.
 */
export interface SyncStateRow {
  key: string;
  /** Dernier `updated_at` observé côté distant. `0` = jamais synchronisé. */
  lastPulledAt: number;
  updatedAt: number;
}

/** Tables dont les lignes sont répliquées vers Supabase. */
export type SyncEntity = "teams" | "players" | "matches" | "actions";

/**
 * Une mutation locale en attente d'envoi.
 *
 * Modèle *outbox* (PLAN.md §5) : l'écriture locale est immédiate et ne bloque
 * jamais l'UI, l'envoi est différé. `payload` est l'instantané de la ligne au
 * moment de la mutation.
 *
 * Il n'existe **pas** d'opération `delete` : le domaine est append-only et les
 * annulations sont des upserts (`voidedAt`). Une entrée suffit donc à décrire
 * n'importe quelle mutation.
 */
export interface OutboxEntry {
  /** UUID client — la clé primaire de l'entrée. */
  id: string;
  entity: SyncEntity;
  /** `id` de la ligne concernée dans sa table. */
  entityId: string;
  /**
   * Nature de la mutation.
   *
   * `upsert` est le cas général, et le seul jusqu'à la phase 8 : le domaine est
   * append-only et une annulation est un upsert de `voidedAt`. `delete` existe
   * pour une seule chose — la suppression explicite d'un match par le coach, qui
   * n'est pas une correction mais une décision.
   *
   * L'entrée qui remplace une autre garde la même clé `entity:entityId` : une
   * ligne ne porte donc jamais deux opérations concurrentes, et une suppression
   * remplace le dernier upsert en attente. C'est ce qui rend l'ordre déterministe
   * sans file d'attente par opération.
   */
  operation: "upsert" | "delete";
  /**
   * Instantané de la ligne au moment de la mutation.
   *
   * `null` pour une suppression : il n'y a rien à réécrire, seulement une ligne
   * à retirer. Le champ reste présent pour que le moteur n'ait pas à le tester.
   */
  payload: unknown | null;
  createdAt: number;
  /** Nombre d'échecs d'envoi consécutifs. Pilote le backoff. */
  attempts: number;
  /** Message du dernier échec, `null` si jamais tenté. */
  lastError: string | null;
}

// ---------------------------------------------------------------------------
// Clés et versions
// ---------------------------------------------------------------------------

/** Nom de la base. Un seul espace de données : l'app ne gère qu'une équipe. */
export const DB_NAME = "space-bunny";

/** Clé primaire de la ligne `syncState` unique. */
export const SYNC_KEY = "default";

/**
 * Schéma v1 — première version ayant existé.
 *
 * Conservé tel quel, sans `updatedAt` ni index sur `voidedAt` : c'est
 * l'état d'avant la migration, et le modifier ferait échouer la vérification du
 * upgrade. `V2_SCHEMA` porte les ajouts.
 */
export const V1_SCHEMA = {
  teams: "id, ownerId",
  players: "id, teamId, [teamId+number]",
  matches: "id, teamId, status, date",
  actions: "id, matchId, playerId, [matchId+seq], [matchId+quarter]",
  syncState: "key",
  outbox: "id, createdAt",
} as const;

/**
 * Schéma v2 — version courante.
 *
 * Cinq ajouts, tous motivés par un usage identifié :
 * - `updatedAt` indexé sur chaque table répliquée, pour le curseur de tirage ;
 * - `voidedAt` indexé sur `actions`, car le tirage descendant filtre la plupart
 *   du temps sur « les actions non annulées depuis le curseur » ;
 * - `groupId` indexé sur `actions`, sans quoi `voidGroup()` — donc l'annulation
 *   d'un combo `2P+F` et de ses lancers — imposerait un parcours complet de la
 *   table ;
 * - `entity`/`entityId` sur l'outbox, pour regrouper les entrées d'une même
 *   ligne et n'envoyer que le dernier état ;
 * - `updatedAt` sur `syncState`, pour dater la mise à jour du curseur.
 */
export const V2_SCHEMA = {
  teams: "id, ownerId, updatedAt",
  players: "id, teamId, [teamId+number], updatedAt",
  matches: "id, teamId, status, date, updatedAt",
  actions:
    "id, matchId, playerId, groupId, voidedAt, updatedAt, [matchId+seq], [matchId+quarter]",
  syncState: "key, updatedAt",
  outbox: "id, entity, entityId, createdAt, [entity+entityId]",
} as const;

/**
 * Migration v1 → v2.
 *
 * Rétrogradation : Dexie ignore les clés absentes d'un objet, donc une ligne qui
 * n'a pas encore de `updatedAt` est stockée telle quelle. Ce que la migration
 * apporte, c'est l'index (déclaratif, appliqué par Dexie) et la valeur.
 *
 * La valeur de repli est 0 plutôt que `Date.now()`. Raison : `0` est plus petit
 * que n'importe quel `updated_at` déjà distribué par le cloud, donc le premier
 * tirage descendant après upgrade **rattrapera** les lignes préexistantes au lieu
 * de les considérer comme déjà synchronisées. Avec `Date.now()`, des matchs
 * saisis avant la mise à jour resteraient invisibles côté serveur, définitivement.
 */
export async function migrateV1ToV2(tx: Transaction): Promise<void> {
  const tables: (keyof typeof V2_SCHEMA)[] = [
    "teams",
    "players",
    "matches",
    "actions",
    "syncState",
  ];

  for (const name of tables) {
    await tx
      .table(name)
      .toCollection()
      .modify((row: Record<string, unknown>) => {
        if (row.updatedAt === undefined) {
          row.updatedAt = 0;
        }
      });
  }
}

/**
 * Schéma v3 — version courante.
 *
 * Un seul ajout par rapport à v2 : la colonne `playerIds` sur `matches` (le
 * roster de ce match, voir `MatchSchema`). Pas d'index, le tableau est lu avec la
 * ligne. V2 reste inchangé pour que le upgrade v1→v2 continue de se vérifier
 * isolément.
 */
export const V3_SCHEMA = {
  ...V2_SCHEMA,
} as const;

/**
 * Migration v2 → v3 : roster du match.
 *
 * Les matchs créés avant cette colonne n'ont pas de roster enregistré. On les
 * laisse avec `playerIds: []` — vide, pas « tout le roster de l'équipe ».
 * Raison : un match antidérieur n'a de toute façon aucune action, il faut donc
 * que le coach fixe lui-même son roster à la reprise. Attribuer le roster
 * actuel à un match d'il y a trois mois donnerait l'illusion que les
 * joueurs d'aujourd'hui y ont joué.
 */
export async function migrateV2ToV3(tx: Transaction): Promise<void> {
  await tx
    .table("matches")
    .toCollection()
    .modify((row: Record<string, unknown>) => {
      if (row.playerIds === undefined) {
        row.playerIds = [];
      }
    });
}

// ---------------------------------------------------------------------------
// Base
// ---------------------------------------------------------------------------

/**
 * La base IndexedDB.
 *
 * `Dexie` sérialise les transactions `rw` se recouvrant sur une même
 * connexion : c'est ce qui rend `nextSeq` atomique sans code de verrouillage
 * supplémentaire. Le multi-onglet n'est pas traité — usage mono-appareil assumé
 * dans le plan, et deux onglets sur le même match simultaneousement sont une
 * situation que le coach ne se crée pas.
 */
export class SpaceBunnyDB extends Dexie {
  declare teams: Table<TeamRow, string>;
  declare players: Table<PlayerRow, string>;
  declare matches: Table<MatchRow, string>;
  declare actions: Table<ActionRow, string>;
  declare syncState: Table<SyncStateRow, string>;
  declare outbox: Table<OutboxEntry, string>;

  constructor(name: string = DB_NAME) {
    super(name);

    this.version(1).stores(V1_SCHEMA);
    this.version(2).stores(V2_SCHEMA).upgrade(migrateV1ToV2);
    this.version(3).stores(V3_SCHEMA).upgrade(migrateV2ToV3);
  }
}

// ---------------------------------------------------------------------------
// Accès
// ---------------------------------------------------------------------------

let instance: SpaceBunnyDB | null = null;

/**
 * Base paresseuse, partagée par toute l'application.
 *
 * Créée à la première utilisation et non au chargement du module : le build
 * `output: 'export'` prerend les pages dans un environnement Node sans
 * `indexedDB`, et ouvrir la base à l'import échouerait.
 */
export function db(): SpaceBunnyDB {
  if (instance === null) {
    instance = new SpaceBunnyDB();
  }
  return instance;
}

/** Remplace la base partagée. Réservé aux tests. */
export function setDb(next: SpaceBunnyDB | null): void {
  instance = next;
}
