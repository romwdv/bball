import type {
  ActionRow,
  MatchRow,
  PlayerRow,
  SyncEntity,
  TeamRow,
} from "@/data/schema";
import {
  ActionSchema,
  MatchSchema,
  PlayerSchema,
  TeamSchema,
} from "@/domain/types";

/**
 * Conversion entre les lignes locales (`camelCase`) et les colonnes Supabase
 * (`snake_case`).
 *
 * C'est **le seul** endroit du projet où les deux vocabulaires se touchent, donc
 * le seul endroit où une faute de frappe corrompt des données sans bruit : une
 * colonne mal nommée est soit refusée par Postgres, soit — bien plus grave —
 * acceptée et jamais relue. D'où les mappages explicites, entité par entité,
 * avec les champs optionnels traités un par un plutôt qu'à l'aveugle.
 *
 * Les colonnes absentes d'un `select` reviennent `null` et non `undefined` :
 * d'où `?? null` partout, pour que le JSON envoyé soit déterministe et que
 * l'upsert n'écrase pas un champ par `null` alors qu'il n'a simplement pas été
 * relu. La règle reste : **une colonne ne vaut `null` que si le domaine le
 * permet**.
 *
 * Les horodatages voyagent en `bigint` (ms) — voir l'en-tête de
 * `supabase/schema.sql` pour pourquoi, et `asNumber()` pour le retour de
 * Postgres, qui renvoie les `bigint` sous forme de chaînes JSON.
 */

/** Table Supabase correspondant à une entité locale. Les deux noms sont alignés. */
const TABLE: Record<SyncEntity, string> = {
  teams: "teams",
  players: "players",
  matches: "matches",
  actions: "actions",
};

export function tableOf(entity: SyncEntity): string {
  return TABLE[entity];
}

/** L'ordre d'envoi : une équipe avant ses joueurs, un match avant ses actions. */
export const PUSH_ORDER: readonly SyncEntity[] = [
  "teams",
  "players",
  "matches",
  "actions",
];

// ---------------------------------------------------------------------------
// Vers le cloud
// ---------------------------------------------------------------------------

/**
 * Champs absents → `null`.
 *
 * Un `undefined` ne serait pas sérialisé par `JSON.stringify` et l'upsert
 * laisserait la colonne précédente en place : c'est-à-dire qu'une correction
 * (vider un numéro de maillot) ne se propagerait jamais. `null` est la seule
 * valeur qui dit explicitement « cette colonne n'a rien ».
 */
function orNull<T>(value: T | undefined): T | null {
  return value ?? null;
}

function teamToCloud(row: TeamRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    owner_id: row.ownerId,
    updated_at: row.updatedAt,
  };
}

function playerToCloud(row: PlayerRow): Record<string, unknown> {
  return {
    id: row.id,
    team_id: row.teamId,
    first_name: row.firstName,
    last_name: row.lastName,
    number: orNull(row.number),
    updated_at: row.updatedAt,
  };
}

function matchToCloud(row: MatchRow): Record<string, unknown> {
  return {
    id: row.id,
    team_id: row.teamId,
    opponent_name: row.opponentName,
    date: row.date,
    player_ids: [...row.playerIds],
    status: row.status,
    created_at: row.createdAt,
    finished_at: orNull(row.finishedAt),
    updated_at: row.updatedAt,
  };
}

function actionToCloud(row: ActionRow): Record<string, unknown> {
  return {
    id: row.id,
    match_id: row.matchId,
    player_id: row.playerId,
    seq: row.seq,
    quarter: row.quarter,
    kind: row.kind,
    value: orNull(row.value),
    made: orNull(row.made),
    fouled: orNull(row.fouled),
    side: orNull(row.side),
    group_id: orNull(row.groupId),
    voided_at: orNull(row.voidedAt),
    updated_at: row.updatedAt,
  };
}

/** Ligne locale → colonne cloud, pour la table de l'entité. */
export function toCloudRow(
  entity: SyncEntity,
  row: TeamRow | PlayerRow | MatchRow | ActionRow,
): Record<string, unknown> {
  switch (entity) {
    case "teams":
      return teamToCloud(row as TeamRow);
    case "players":
      return playerToCloud(row as PlayerRow);
    case "matches":
      return matchToCloud(row as MatchRow);
    case "actions":
      return actionToCloud(row as ActionRow);
  }
}

// ---------------------------------------------------------------------------
// Depuis le cloud
// ---------------------------------------------------------------------------

/**
 * Les `bigint` et `numeric` arrivent en **chaîne** dans le JSON de PostgREST.
 *
 * Une conversion trop optimiste (`Number(value)` sur `null` donne 0) fabriquerait
 * un `updatedAt: 0` et ferait resurfacer au tirage descendant des lignes
 * d'ancienneté arbitraire. Le `null` est donc traité avant la conversion, et une
 * valeur non convertible est une erreur explicite plutôt qu'un `NaN` silencieux
 * — un `NaN` passerait `Number.isInteger` à `false` mais donnerait un message
 * de validation incompréhensible.
 */
function asNumber(value: unknown, column: string): number {
  if (value === null || value === undefined) {
    throw new Error(`Colonne absente du tirage : ${column}`);
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Colonne illisible (${column}) : ${String(value)}`);
  }
  return parsed;
}

function asString(value: unknown, column: string): string {
  if (typeof value !== "string") {
    throw new Error(`Colonne illisible (${column}) : ${String(value)}`);
  }
  return value;
}

function asBooleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function teamFromCloud(raw: Record<string, unknown>): TeamRow {
  return {
    ...TeamSchema.parse({
      id: asString(raw.id, "teams.id"),
      name: asString(raw.name, "teams.name"),
      ownerId: typeof raw.owner_id === "string" ? raw.owner_id : null,
    }),
    updatedAt: asNumber(raw.updated_at, "teams.updated_at"),
  };
}

function playerFromCloud(raw: Record<string, unknown>): PlayerRow {
  return {
    ...PlayerSchema.parse({
      id: asString(raw.id, "players.id"),
      teamId: asString(raw.team_id, "players.team_id"),
      firstName: typeof raw.first_name === "string" ? raw.first_name : "",
      lastName: asString(raw.last_name, "players.last_name"),
      number: asNumberOrNull(raw.number),
    }),
    updatedAt: asNumber(raw.updated_at, "players.updated_at"),
  };
}

function matchFromCloud(raw: Record<string, unknown>): MatchRow {
  return {
    ...MatchSchema.parse({
      id: asString(raw.id, "matches.id"),
      teamId: asString(raw.team_id, "matches.team_id"),
      opponentName: asString(raw.opponent_name, "matches.opponent_name"),
      date: asString(raw.date, "matches.date"),
      playerIds: asStringArray(raw.player_ids),
      status: raw.status,
      createdAt: asNumber(raw.created_at, "matches.created_at"),
      finishedAt:
        raw.finished_at === null || raw.finished_at === undefined
          ? null
          : asNumber(raw.finished_at, "matches.finished_at"),
    }),
    updatedAt: asNumber(raw.updated_at, "matches.updated_at"),
  };
}

function actionFromCloud(raw: Record<string, unknown>): ActionRow {
  return {
    ...ActionSchema.parse({
      id: asString(raw.id, "actions.id"),
      matchId: asString(raw.match_id, "actions.match_id"),
      playerId: asString(raw.player_id, "actions.player_id"),
      seq: asNumber(raw.seq, "actions.seq"),
      quarter: raw.quarter,
      kind: raw.kind,
      value: asNumberOrNull(raw.value) ?? undefined,
      made: asBooleanOrNull(raw.made) ?? undefined,
      fouled: asBooleanOrNull(raw.fouled) ?? undefined,
      side: typeof raw.side === "string" ? raw.side : undefined,
      groupId: typeof raw.group_id === "string" ? raw.group_id : undefined,
      voidedAt:
        raw.voided_at === null || raw.voided_at === undefined
          ? null
          : asNumber(raw.voided_at, "actions.voided_at"),
    }),
    updatedAt: asNumber(raw.updated_at, "actions.updated_at"),
  };
}

/**
 * Colonne cloud → ligne locale validée.
 *
 * La validation Zod n'est pas un formalisme : une ligne distante mal formée
 * (contrainte supprimée à la main dans le dashboard, importa manuelle) serait
 * sinon écrite dans IndexedDB et lurait jusqu'à la prochaine lecture des
 * statistiques. Ici elle est refusée à la frontière, où l'erreur est
 * attribuable.
 */
/**
 * Surcharges par entité.
 *
 * Indispensables : sans elles le retour est l'union des quatre lignes, et un
 * appelant devant lire `row.playerIds` devrait la vérifier — donc l'accès serait
 * contesté à chaque usage alors que le `switch` interne a déjà Guaranteed le
 * type. Les surcharges restituent le type quattend `entity`.
 */
export function fromCloudRow(
  entity: "teams",
  raw: Record<string, unknown>,
): TeamRow;
export function fromCloudRow(
  entity: "players",
  raw: Record<string, unknown>,
): PlayerRow;
export function fromCloudRow(
  entity: "matches",
  raw: Record<string, unknown>,
): MatchRow;
export function fromCloudRow(
  entity: "actions",
  raw: Record<string, unknown>,
): ActionRow;
export function fromCloudRow(
  entity: SyncEntity,
  raw: Record<string, unknown>,
): TeamRow | PlayerRow | MatchRow | ActionRow {
  switch (entity) {
    case "teams":
      return teamFromCloud(raw);
    case "players":
      return playerFromCloud(raw);
    case "matches":
      return matchFromCloud(raw);
    case "actions":
      return actionFromCloud(raw);
  }
}

/** Horodatage d'une ligne brute, pour faire avancer le curseur de tirage. */
export function remoteUpdatedAt(raw: Record<string, unknown>): number {
  return asNumber(raw.updated_at, "updated_at");
}

/**
 * Dispatch interne, pour une entité dont le type n'est pas connu à la
 * compilation.
 *
 * `fromCloudRow` est volontairement surchargé par entité — c'est ce qui donne à
 * l'appelant le bon type de ligne sans vérification. Un appel dont l'entité est
 * une simple variable ne peut plus utiliser ces surcharges ; ce wrapper branche
 * sur la même implémentation, sans duplication.
 */
export function fromCloudRowFor(
  entity: SyncEntity,
  raw: Record<string, unknown>,
): TeamRow | PlayerRow | MatchRow | ActionRow {
  switch (entity) {
    case "teams":
      return fromCloudRow("teams", raw);
    case "players":
      return fromCloudRow("players", raw);
    case "matches":
      return fromCloudRow("matches", raw);
    case "actions":
      return fromCloudRow("actions", raw);
  }
}
