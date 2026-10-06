import type { ZodType } from "zod";
import { newId } from "@/data/ids";
import { enqueue } from "@/data/outbox";
import {
  type ActionRow,
  type MatchRow,
  type PlayerRow,
  type SpaceBunnyDB,
  type TeamRow,
} from "@/data/schema";
import {
  ActionSchema,
  MatchSchema,
  PlayerSchema,
  TeamSchema,
  type Action,
  type Match,
  type MatchStatus,
  type Player,
  type Quarter,
  type Team,
} from "@/domain/types";
import type { ActionDraft } from "@/domain/rules";
import { undoScope } from "@/domain/undo";

/**
 * Persistance locale.
 *
 * Chaque table a son interface, implémentée par une classe IndexedDB. Les
 * repositories ont une seule responsabilité : **faire tenir ensemble** dans une
 * transaction unique l'écriture de la ligne et l'entrée d'outbox correspondante.
 * Tout le reste — validation, numérotation, périmètre d'annulation — vient du
 * domaine, jamais d'ici.
 *
 * Pourquoi des interfaces : le plan prévoit de brancher Supabase derrière ces
 * mêmes interfaces en phase 6. Un composant de saisie qui appelle
 * `actions.append(...)` ne saura jamais s'il parle à IndexedDB ou au cloud.
 */

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface TeamRepository {
  /** Crée l'équipe locale et la retourne. Idempotent. */
  ensureLocal(name?: string): Promise<TeamRow>;
  get(id: string): Promise<TeamRow | undefined>;
  list(): Promise<TeamRow[]>;
  rename(id: string, name: string): Promise<TeamRow>;
  /** Rattache l'équipe locale à un compte cloud (phase 6b). */
  attachOwner(id: string, ownerId: string): Promise<TeamRow>;
}

export interface NewPlayer {
  firstName: string;
  lastName: string;
  number?: number | null;
}

export interface PlayerRepository {
  create(teamId: string, player: NewPlayer): Promise<PlayerRow>;
  get(id: string): Promise<PlayerRow | undefined>;
  listByTeam(teamId: string): Promise<PlayerRow[]>;
  /** Retrouve un joueur par son numéro — évite les doublons de roster. */
  findByNumber(teamId: string, number: number): Promise<PlayerRow | undefined>;
  update(id: string, patch: Partial<NewPlayer>): Promise<PlayerRow>;
  /** Remplit le roster à la création d'une équipe ou d'un match. */
  createMany(
    teamId: string,
    players: readonly NewPlayer[],
  ): Promise<PlayerRow[]>;
}

export interface NewMatch {
  opponentName: string;
  date: string;
  status?: MatchStatus;
  /**
   * Roster du match. Par défaut **tout** le roster de l'équipe : c'est le cas
   * habituel (une équipe locale dispute avec ses joueurs habituels) et ça évite
   * au coach de cocher douze cases à chaque match.
   */
  playerIds?: readonly string[];
}

export interface MatchRepository {
  create(teamId: string, match: NewMatch): Promise<MatchRow>;
  get(id: string): Promise<MatchRow | undefined>;
  /** Tri par date décroissante — l'ordre d'affichage de l'écran historique. */
  listByTeam(teamId: string): Promise<MatchRow[]>;
  /** Matchs non terminés, du plus récent au plus ancien. */
  listUnfinished(teamId: string): Promise<MatchRow[]>;
  /** Le match en cours le plus récent, s'il y en a un. Bandeau de reprise. */
  latestUnfinished(teamId: string): Promise<MatchRow | undefined>;
  setStatus(id: string, status: MatchStatus): Promise<MatchRow>;
  update(id: string, patch: Partial<NewMatch>): Promise<MatchRow>;
  /**
   * Remplace le roster du match.
   *
   * Séparé de `update` parce que le cas d'usage est distinct : ajouter un joueur
   * en cours de match quand quelqu'un arrive en retard, ou corriger une omission
   * à la reprise. Les deux font une écriture atomique du tableau.
   */
  setRoster(id: string, playerIds: readonly string[]): Promise<MatchRow>;
  /**
   * Joueurs du match, dans l'ordre du roster (numéro puis nom).
   *
   * L'ordre du roster d'équipe est conservé : c'est lui que le coach connaît, et
   * surtout les joueurs **absents** du match disparaissent de la liste au lieu
   * d'être cochés.
   */
  rosterOf(id: string): Promise<PlayerRow[]>;
}

export interface AppendResult {
  /** Actions écrites, dans l'ordre de `seq`. */
  actions: ActionRow[];
  /** `seq` de la première action écrite — permet d'afficher « action n°12 ». */
  fromSeq: number;
  /** `groupId` partagé par l'écriture, utile à l'annulation groupée. */
  groupId: string;
}

export interface ActionRepository {
  /**
   * Écrit un combo entier, atomiquement.
   *
   * `seq` est attribué ici et pas par l'appelant : c'est la seule façon
   * d'éviter deux actions de même `seq` en cas d'appui rapide ou de double
   * rendu React.
   */
  append(
    matchId: string,
    drafts: readonly ActionDraft[],
    options?: { now?: number; groupId?: string },
  ): Promise<AppendResult>;
  /** Prochain `seq` libre du match. Atomique avec l'écriture qui l'utilise. */
  nextSeq(matchId: string): Promise<number>;
  get(id: string): Promise<ActionRow | undefined>;
  /**
   * Actions d'un match triées par `seq`.
   *
   * `includeVoided` vaut `true` par défaut : le fil du match doit montrer ce qui
   * a été défait, sinon le coach perd la trace de ses corrections.
   */
  listByMatch(
    matchId: string,
    options?: { includeVoided?: boolean },
  ): Promise<ActionRow[]>;
  /**
   * Actions de plusieurs matchs, en une lecture.
   *
   * exists pour l'écran des stats cumulées : sans elle, il faudrait interroger
   * la table une fois par match, soit vingt lectures pour une saison. `anyOf`
   * sur l'index `matchId` suffit — les matchs d'une équipe sont proches en
   * `updatedAt`, donc la lecture reste peu coûteuse.
   *
   * Ordre de sortie : par `matchId` puis `seq`. Le tri final se fait côté
   * appelant, il n'a pas de sens ici.
   */
  listByMatches(
    matchIds: readonly string[],
    options?: { includeVoided?: boolean },
  ): Promise<ActionRow[]>;
  countByMatch(
    matchId: string,
    options?: { activeOnly?: boolean },
  ): Promise<number>;
  /** Annule une action. Soft-delete, jamais de suppression physique. */
  voidAction(id: string, at?: number): Promise<ActionRow | undefined>;
  /** Annule tout un combo (`2P+F` et ses lancers). */
  voidGroup(groupId: string, at?: number): Promise<ActionRow[]>;
  /** Annule la dernière saisie ou le dernier combo. Renvoie le périmètre annulé. */
  undoLast(matchId: string, at?: number): Promise<ActionRow[]>;
}

export interface Repositories {
  teams: TeamRepository;
  players: PlayerRepository;
  matches: MatchRepository;
  actions: ActionRepository;
}

// ---------------------------------------------------------------------------
// Utilitaires partagés
// ---------------------------------------------------------------------------

/**
 * Valide une ligne avant écriture.
 *
 * Le schéma de domaine est la référence : une ligne qui ne le passe pas est
 * rejetée ici, donc jamais écrite, donc jamais synchronisée. Écrire d'abord et
 * valider ensuite laisserait un match corrompu dans IndexedDB, invisible jusqu'à
 * la première lecture des statistiques.
 */
function validate(schema: ZodType, value: object): void {
  const result = schema.safeParse(value);
  if (result.success) return;
  // `path` est toujours renseigné par Zod pour les schémas du domaine ; le
  // fallback sert seulement à ce qu'un issue de niveau racine reste lisible.
  const detail = result.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join(" · ");
  throw new Error(`Ligne invalide — ${detail}`);
}

function toOutboxPayload(row: object): Record<string, unknown> {
  return { ...row };
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

const DEFAULT_TEAM_NAME = "Mon équipe";

/** `id` déterministe : l'équipe locale est un singleton identifiable. */
export const LOCAL_TEAM_ID = "local";

class DexieTeamRepository implements TeamRepository {
  constructor(private readonly database: SpaceBunnyDB) {}

  async ensureLocal(name: string = DEFAULT_TEAM_NAME): Promise<TeamRow> {
    const existing = await this.database.teams.get(LOCAL_TEAM_ID);
    if (existing !== undefined) return existing;

    const now = Date.now();
    const row: TeamRow = {
      id: LOCAL_TEAM_ID,
      name,
      ownerId: null,
      updatedAt: now,
    };
    validate(TeamSchema, row);

    await this.database.transaction(
      "rw",
      [this.database.teams, this.database.outbox],
      async () => {
        // Relecture sous transaction : deux appels concurrents au premier
        // lancement ne doivent pas créer deux équipes locales.
        const raced = await this.database.teams.get(LOCAL_TEAM_ID);
        if (raced !== undefined) return;
        await this.database.teams.put(row);
        await enqueue(this.database, {
          entity: "teams",
          entityId: row.id,
          payload: toOutboxPayload(row),
          now,
        });
      },
    );

    return row;
  }

  async get(id: string): Promise<TeamRow | undefined> {
    return this.database.teams.get(id);
  }

  async list(): Promise<TeamRow[]> {
    return this.database.teams.toArray();
  }

  async rename(id: string, name: string): Promise<TeamRow> {
    return this.write(id, (row) => ({ ...row, name }));
  }

  async attachOwner(id: string, ownerId: string): Promise<TeamRow> {
    return this.write(id, (row) => ({ ...row, ownerId }));
  }

  private async write(
    id: string,
    patch: (row: TeamRow) => TeamRow,
  ): Promise<TeamRow> {
    let result: TeamRow | undefined;

    await this.database.transaction(
      "rw",
      [this.database.teams, this.database.outbox],
      async () => {
        const current = await this.database.teams.get(id);
        if (current === undefined) {
          throw new Error(`Équipe introuvable : ${id}`);
        }
        const next = patch({ ...current, updatedAt: Date.now() });
        validate(TeamSchema, next);
        await this.database.teams.put(next);
        await enqueue(this.database, {
          entity: "teams",
          entityId: next.id,
          payload: toOutboxPayload(next),
          now: next.updatedAt,
        });
        result = next;
      },
    );

    // La transaction a réussi, `result` est donc défini. Le `!` évite un `??`
    // silencieux qui masquerait une violation de la garantie ci-dessus.
    return result!;
  }
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

/**
 * Tri du roster : numéros d'abord, puis par nom.
 *
 * Les joueurs sans numéro vont à la fin : en bord de terrain, un joueur sans
 * numéro identifiable ne doit pas prendre la tête de la liste.
 */
function comparePlayers(a: PlayerRow, b: PlayerRow): number {
  if (a.number !== null && b.number !== null && a.number !== b.number) {
    return a.number - b.number;
  }
  if (a.number !== null && b.number === null) return -1;
  if (a.number === null && b.number !== null) return 1;
  return `${a.lastName} ${a.firstName}`.localeCompare(
    `${b.lastName} ${b.firstName}`,
    "fr",
  );
}

class DexiePlayerRepository implements PlayerRepository {
  constructor(private readonly database: SpaceBunnyDB) {}

  async create(teamId: string, player: NewPlayer): Promise<PlayerRow> {
    const now = Date.now();
    const row: PlayerRow = {
      id: newId(),
      teamId,
      firstName: player.firstName.trim(),
      lastName: player.lastName.trim(),
      number: player.number ?? null,
      updatedAt: now,
    };
    validate(PlayerSchema, row);

    await this.database.transaction(
      "rw",
      [this.database.players, this.database.outbox],
      async () => {
        await this.database.players.put(row);
        await enqueue(this.database, {
          entity: "players",
          entityId: row.id,
          payload: toOutboxPayload(row),
          now,
        });
      },
    );

    return row;
  }

  async createMany(
    teamId: string,
    players: readonly NewPlayer[],
  ): Promise<PlayerRow[]> {
    if (players.length === 0) return [];
    const created: PlayerRow[] = [];
    for (const player of players) {
      created.push(await this.create(teamId, player));
    }
    return created;
  }

  async get(id: string): Promise<PlayerRow | undefined> {
    return this.database.players.get(id);
  }

  async listByTeam(teamId: string): Promise<PlayerRow[]> {
    const rows = await this.database.players
      .where("teamId")
      .equals(teamId)
      .toArray();
    return rows.sort(comparePlayers);
  }

  async findByNumber(
    teamId: string,
    number: number,
  ): Promise<PlayerRow | undefined> {
    return this.database.players
      .where("[teamId+number]")
      .equals([teamId, number])
      .first();
  }

  async update(id: string, patch: Partial<NewPlayer>): Promise<PlayerRow> {
    let result: PlayerRow | undefined;

    await this.database.transaction(
      "rw",
      [this.database.players, this.database.outbox],
      async () => {
        const current = await this.database.players.get(id);
        if (current === undefined) {
          throw new Error(`Joueur introuvable : ${id}`);
        }
        const next: PlayerRow = {
          ...current,
          ...patch,
          firstName: (patch.firstName ?? current.firstName).trim(),
          lastName: (patch.lastName ?? current.lastName).trim(),
          updatedAt: Date.now(),
        };
        validate(PlayerSchema, next);
        await this.database.players.put(next);
        await enqueue(this.database, {
          entity: "players",
          entityId: next.id,
          payload: toOutboxPayload(next),
          now: next.updatedAt,
        });
        result = next;
      },
    );

    return result!;
  }
}

// ---------------------------------------------------------------------------
// Matches
// ---------------------------------------------------------------------------

function compareMatchesDesc(a: MatchRow, b: MatchRow): number {
  // `createdAt` départage les matchs d'une même date : deux matchs peuvent
  // parfaitement être créés le même jour, et un tri instable les réordonnerait
  // à chaque lecture de l'historique.
  if (a.date !== b.date) return b.date.localeCompare(a.date);
  return b.createdAt - a.createdAt;
}

class DexieMatchRepository implements MatchRepository {
  constructor(private readonly database: SpaceBunnyDB) {}

  async create(teamId: string, match: NewMatch): Promise<MatchRow> {
    const now = Date.now();
    const playerIds =
      match.playerIds ??
      (
        await this.database.players.where("teamId").equals(teamId).toArray()
      ).map((player) => player.id);
    const row: MatchRow = {
      id: newId(),
      teamId,
      opponentName: match.opponentName.trim(),
      date: match.date,
      playerIds: [...playerIds],
      status: match.status ?? "draft",
      createdAt: now,
      finishedAt: null,
      updatedAt: now,
    };
    validate(MatchSchema, row);

    await this.database.transaction(
      "rw",
      [this.database.matches, this.database.outbox],
      async () => {
        await this.database.matches.put(row);
        await enqueue(this.database, {
          entity: "matches",
          entityId: row.id,
          payload: toOutboxPayload(row),
          now,
        });
      },
    );

    return row;
  }

  async get(id: string): Promise<MatchRow | undefined> {
    return this.database.matches.get(id);
  }

  async listByTeam(teamId: string): Promise<MatchRow[]> {
    const rows = await this.database.matches
      .where("teamId")
      .equals(teamId)
      .toArray();
    return rows.sort(compareMatchesDesc);
  }

  async listUnfinished(teamId: string): Promise<MatchRow[]> {
    const rows = await this.database.matches
      .where("teamId")
      .equals(teamId)
      .toArray();
    return rows
      .filter((row) => row.status !== "finished")
      .sort(compareMatchesDesc);
  }

  async latestUnfinished(teamId: string): Promise<MatchRow | undefined> {
    return (await this.listUnfinished(teamId))[0];
  }

  async setStatus(id: string, status: MatchStatus): Promise<MatchRow> {
    return this.write(id, (row) => ({
      ...row,
      status,
      // `finishedAt` n'est posé qu'à la clôture. Le remettre à `null` lors d'une
      // réouverture garderait une date de fin incohérente avec le statut.
      finishedAt: status === "finished" ? (row.finishedAt ?? Date.now()) : null,
    }));
  }

  async update(id: string, patch: Partial<NewMatch>): Promise<MatchRow> {
    return this.write(id, (row) => {
      const next: MatchRow = { ...row };
      if (patch.opponentName !== undefined) {
        next.opponentName = patch.opponentName.trim();
      }
      if (patch.date !== undefined) next.date = patch.date;
      if (patch.status !== undefined) next.status = patch.status;
      if (patch.playerIds !== undefined) next.playerIds = [...patch.playerIds];
      return next;
    });
  }

  async setRoster(id: string, playerIds: readonly string[]): Promise<MatchRow> {
    return this.write(id, (row) => ({ ...row, playerIds: [...playerIds] }));
  }

  async rosterOf(id: string): Promise<PlayerRow[]> {
    const match = await this.database.matches.get(id);
    if (match === undefined) return [];

    // Le roster est filtré par `playerIds` puis réordonné par `comparePlayers` :
    // l'ordre de saisie du tableau est celui du clic, pas celui du numéro de
    // maillot, et le carrousel s'attend à l'ordre des joueurs de l'équipe.
    const wanted = new Set(match.playerIds);
    const all = await this.database.players
      .where("teamId")
      .equals(match.teamId)
      .toArray();
    return all.filter((player) => wanted.has(player.id)).sort(comparePlayers);
  }

  private async write(
    id: string,
    patch: (row: MatchRow) => MatchRow,
  ): Promise<MatchRow> {
    let result: MatchRow | undefined;

    await this.database.transaction(
      "rw",
      [this.database.matches, this.database.outbox],
      async () => {
        const current = await this.database.matches.get(id);
        if (current === undefined) {
          throw new Error(`Match introuvable : ${id}`);
        }
        const next = patch({ ...current, updatedAt: Date.now() });
        validate(MatchSchema, next);
        await this.database.matches.put(next);
        await enqueue(this.database, {
          entity: "matches",
          entityId: next.id,
          payload: toOutboxPayload(next),
          now: next.updatedAt,
        });
        result = next;
      },
    );

    return result!;
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * `seq` suivant pour un match, à partir de l'index composé `[matchId+seq]`.
 *
 * Indexé donc en O(log n) plutôt qu'en parcourant toutes les actions du match,
 * ce qui compte quand on écrit une action par appui et qu'un match contient
 * plusieurs centaines d'événements.
 *
 * ⚠️ Ne doit être appelée qu'à l'intérieur d'une transaction `rw` sur
 * `actions` : c'est Dexie, sérialisant les transactions qui se recouvrent, qui
 * rend la lecture-modification-écriture atomique.
 */
async function lastSeqIn(
  database: SpaceBunnyDB,
  matchId: string,
): Promise<number> {
  const last = await database.actions
    .where("[matchId+seq]")
    .between([matchId, -Infinity], [matchId, Infinity], true, true)
    .last();
  return last?.seq ?? -1;
}

class DexieActionRepository implements ActionRepository {
  constructor(private readonly database: SpaceBunnyDB) {}

  async append(
    matchId: string,
    drafts: readonly ActionDraft[],
    options: { now?: number; groupId?: string } = {},
  ): Promise<AppendResult> {
    if (drafts.length === 0) {
      throw new Error("append : au moins une action est requise");
    }
    const now = options.now ?? Date.now();
    // Un lot sans `groupId` explicite forme un seul groupe : c'est l'atomicité
    // attendue d'un combo (`2P+F`), et l'annulation retire les deux d'un coup.
    const groupId = options.groupId ?? drafts[0]?.groupId ?? newId();

    return this.database.transaction(
      "rw",
      [this.database.actions, this.database.outbox, this.database.matches],
      async () => {
        // Un match terminé n'accepte plus d'action. Sans ce garde-fou, un écran
        // resté ouvert pendant la clôture écrirait silencieusement une action
        // dans une feuille déjà lue — et les stats exportées divergeraient de ce
        // que le coach vient de voir.
        const currentMatch = await this.database.matches.get(matchId);
        if (currentMatch === undefined) {
          throw new Error(`append : match introuvable (${matchId})`);
        }
        if (currentMatch.status === "finished") {
          throw new Error(
            "append : le match est terminé, rouvrez-le pour corriger",
          );
        }

        const first = (await lastSeqIn(this.database, matchId)) + 1;

        const rows: ActionRow[] = drafts.map((draft, offset) => {
          const row: ActionRow = {
            ...draft,
            id: newId(),
            // Écrit **après** le spread : le `matchId` vient de l'appelant,
            // jamais du draft.
            matchId,
            seq: first + offset,
            // Un draft qui porte déjà son `groupId` le conserve ; sinon il
            // rejoint le groupe du lot. Mélanger les deux au sein d'un même
            // appel n'aurait aucun sens : un combo est un groupe.
            groupId: draft.groupId ?? groupId,
            voidedAt: null,
            updatedAt: now,
          };
          validate(ActionSchema, row);
          return row;
        });

        await this.database.actions.bulkAdd(rows);
        for (const row of rows) {
          await enqueue(this.database, {
            entity: "actions",
            entityId: row.id,
            payload: toOutboxPayload(row),
            now,
          });
        }

        return { actions: rows, fromSeq: first, groupId };
      },
    );
  }

  async nextSeq(matchId: string): Promise<number> {
    return this.database.transaction("rw", this.database.actions, async () => {
      return (await lastSeqIn(this.database, matchId)) + 1;
    });
  }

  async get(id: string): Promise<ActionRow | undefined> {
    return this.database.actions.get(id);
  }

  async listByMatch(
    matchId: string,
    options: { includeVoided?: boolean } = {},
  ): Promise<ActionRow[]> {
    const { includeVoided = true } = options;
    const rows = await this.database.actions
      .where("matchId")
      .equals(matchId)
      .toArray();
    return rows
      .filter(
        (row) =>
          includeVoided || row.voidedAt === null || row.voidedAt === undefined,
      )
      .sort((a, b) => a.seq - b.seq);
  }

  async listByMatches(
    matchIds: readonly string[],
    options: { includeVoided?: boolean } = {},
  ): Promise<ActionRow[]> {
    if (matchIds.length === 0) return [];
    const { includeVoided = false } = options;

    const rows = await this.database.actions
      .where("matchId")
      .anyOf([...matchIds])
      .toArray();

    return rows
      .filter(
        (row) =>
          includeVoided || row.voidedAt === null || row.voidedAt === undefined,
      )
      .sort((a, b) => a.seq - b.seq || a.matchId.localeCompare(b.matchId));
  }

  async countByMatch(
    matchId: string,
    options: { activeOnly?: boolean } = {},
  ): Promise<number> {
    return (
      await this.listByMatch(matchId, { includeVoided: !options.activeOnly })
    ).length;
  }

  async voidAction(
    id: string,
    at: number = Date.now(),
  ): Promise<ActionRow | undefined> {
    const scope = await this.database.actions.get(id);
    if (scope === undefined || !isStillActive(scope)) return scope;
    const [voided] = await this.voidMany([scope], at);
    return voided;
  }

  async voidGroup(
    groupId: string,
    at: number = Date.now(),
  ): Promise<ActionRow[]> {
    const group = await this.database.actions
      .where("groupId")
      .equals(groupId)
      .toArray();
    return this.voidMany(group, at);
  }

  /**
   * Annulation « undo » : la dernière saisie, ou le dernier combo entier.
   *
   * Le périmètre est calculé par `undoScope()` côté domaine, pas ici. Cette
   * méthode ne fait qu'écrire le `voidedAt` que le domaine a décidé, ce qui
   * garantit que le bouton « annuler » de l'écran et les tests du domaine
   * désignent exactement le même ensemble.
   */
  async undoLast(
    matchId: string,
    at: number = Date.now(),
  ): Promise<ActionRow[]> {
    const all = await this.listByMatch(matchId);
    return this.voidMany(undoScope(all), at);
  }

  /**
   * Écrit `voidedAt` sur un périmètre d'actions, en une transaction.
   *
   * Les actions déjà annulées sont laissées intactes : réécrire leur
   * `voidedAt` déplacerait la trace de la première annulation, qui est
   * précisément l'information que le fil du match doit conserver.
   */
  private async voidMany(
    actions: readonly Action[],
    at: number,
  ): Promise<ActionRow[]> {
    if (actions.length === 0) return [];

    return this.database.transaction(
      "rw",
      [this.database.actions, this.database.outbox],
      async () => {
        const stored = await this.database.actions.bulkGet(
          actions.map((action) => action.id),
        );
        const voided: ActionRow[] = [];

        for (const row of stored) {
          if (row === undefined || !isStillActive(row)) continue;
          const next: ActionRow = { ...row, voidedAt: at, updatedAt: at };
          await this.database.actions.put(next);
          await enqueue(this.database, {
            entity: "actions",
            entityId: next.id,
            payload: toOutboxPayload(next),
            now: at,
          });
          voided.push(next);
        }

        return voided;
      },
    );
  }
}

function isStillActive(action: Action): boolean {
  return action.voidedAt === null || action.voidedAt === undefined;
}

// ---------------------------------------------------------------------------
// Assemblage
// ---------------------------------------------------------------------------

/** Construit l'ensemble des repositories sur une base. */
export function createRepositories(database: SpaceBunnyDB): Repositories {
  return {
    teams: new DexieTeamRepository(database),
    players: new DexiePlayerRepository(database),
    matches: new DexieMatchRepository(database),
    actions: new DexieActionRepository(database),
  };
}

/** Conversions vers le domaine, pour ne pas exposer `updatedAt` à l'UI. */
export function toTeam(row: TeamRow): Team {
  const { updatedAt: _updatedAt, ...team } = row;
  return team;
}

export function toPlayer(row: PlayerRow): Player {
  const { updatedAt: _updatedAt, ...player } = row;
  return player;
}

export function toMatch(row: MatchRow): Match {
  const { updatedAt: _updatedAt, ...match } = row;
  return match;
}

export function toAction(row: ActionRow): Action {
  const { updatedAt: _updatedAt, ...action } = row;
  return action;
}

/** Période d'un lot d'actions. Utile pour vérifier qu'un combo est cohérent. */
export function quartersOf(actions: readonly Action[]): Quarter[] {
  return [...new Set(actions.map((action) => action.quarter))];
}
