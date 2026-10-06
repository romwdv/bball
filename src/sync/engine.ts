"use client";

import type { Table } from "dexie";
import { ack, fail, peek, pendingCount } from "@/data/outbox";
import { dataDb } from "@/data";
import type {
  ActionRow,
  MatchRow,
  OutboxEntry,
  PlayerRow,
  SyncEntity,
  SyncStateRow,
  TeamRow,
} from "@/data/schema";
import {
  fromCloudRowFor,
  PUSH_ORDER,
  remoteUpdatedAt,
  toCloudRow,
  tableOf,
} from "@/sync/mapping";
import { remote } from "@/sync/supabase-client";
import type { RemoteClient } from "@/sync/remote";

/**
 * Moteur de synchronisation (PLAN.md §5).
 *
 * Un cycle = **pousser** puis **tirer**. L'ordre n'est pas indifférent : tirer
 * avant d'avoir poussé réécrirait en local des lignes que le cloud ne connaît
 * pas encore, et le curseur advanced les rendrait définitivement invisibles.
 *
 * ```
 *   ┌── push : drain de l'outbox (upsert par id) ──┐
 *   │                                              ▼
 *   └── pull : tirage descendant par updated_at ────┘
 * ```
 *
 * Trois garanties, qui sont aussi les trois tests du module :
 *
 * 1. **Rien n'est perdu.** Une entrée d'outbox n'est supprimée qu'après un
 *    `upsert` réussi. Tout échec passe par `fail()`, qui incrémente `attempts` et
 *    conserve le message — l'entrée reste donc en file.
 * 2. **Les identifiants font la dédupe.** Les lignes portent un `uuid` généré
 *    avant écriture locale ; réessayer le même envoi ne crée pas de doublon.
 * 3. **Le tirage est un curseur, pas un balayage.** Chaque table a le sien : un
 *    curseur unique serait *faux*, puisqu'une action écrite à T-50 mais encore
 *    inconnue du cloud serait sautée dès qu'un match écrit à T-80 ferait avancer
 *    le curseur global.
 *
 * Le moteur ne connaît **pas** le composant React : il publie son état par
 * abonnement et s'active à `startSync()`. Un test le pilote donc sans DOM, et
 * l'indicateur du header se contente de s'abonner.
 */

// ---------------------------------------------------------------------------
// État
// ---------------------------------------------------------------------------

/**
 * État de synchronisation, exactement ce que l'indicateur du header affiche.
 *
 * `offline` est un état à part entière et non une erreur : en gymnase, le
 * réseau manque une fois sur deux, et une app qui affiche « erreur » en rouge
 * alors que tout est simplement en attente apprendrait le coach à ignorer le
 * voyant.
 */
export type SyncState =
  /** Rien à envoyer, curseur à jour. L'état de repos. */
  | "idle"
  /** Cycle en cours. */
  | "syncing"
  /** `navigator.onLine` dit non, ou le dernier échec était un timeout réseau. */
  | "offline"
  /** Échec applicatif : RLS, contrainte, schema. Nécessite une action humaine. */
  | "error";

export interface SyncStatus {
  state: SyncState;
  /** Entrées d'outbox en attente. Alimente le libellé « 3 en attente ». */
  pending: number;
  /** Dernière synchronisation complète réussie, `null` si jamais. */
  lastSyncedAt: number | null;
  /** Message du dernier échec, `null` si aucun. */
  error: string | null;
  /**
   * Date avant laquelle aucun nouvel essai automatique n'a lieu (backoff).
   * Le retry manuel passe outre.
   */
  retryAt: number | null;
}

const INITIAL: SyncStatus = {
  state: "idle",
  pending: 0,
  lastSyncedAt: null,
  error: null,
  retryAt: null,
};

/** Intervalle entre deux cycles automatiques quand tout va bien. */
export const SYNC_INTERVAL_MS = 30_000;

/** Page de tirage. Assez grand pour vider un lot, assez petit pour rester rapide. */
const PAGE_SIZE = 500;

/**
 * Pages maximum par table et par cycle.
 *
 * Un plafond, pas une boucle infinie : si le cloud renvoie sans cesse `PAGE_SIZE`
 * lignes — cas reachable quand un autre appareil écrit en continu — le cycle doit
 * se terminer et rendre la main. Les pages suivantes sont prises au cycle suivant,
 * le curseur ayant déjà avancé.
 */
const MAX_PAGES = 20;

/** Backoff : 2 s, 4 s, 8 s… plafonné à 5 min. */
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 300_000;

export function backoffDelay(failures: number): number {
  if (failures <= 0) return 0;
  const delay = BACKOFF_BASE_MS * 2 ** Math.min(failures - 1, 10);
  return Math.min(delay, BACKOFF_MAX_MS);
}

// ---------------------------------------------------------------------------
// Curseurs
// ---------------------------------------------------------------------------

/**
 * Clé de curseur par table.
 *
 * `SYNC_KEY` (`"default"`) reste le cas d'un état global ; ici chaque entité a la
 * sienne, ce qui est la seule façon d'avoir un tirage descendant correct.
 */
export function cursorKey(entity: SyncEntity): string {
  return `cursor:${entity}`;
}

async function readCursor(entity: SyncEntity): Promise<number> {
  const row = await dataDb().syncState.get(cursorKey(entity));
  return row?.lastPulledAt ?? 0;
}

async function writeCursor(entity: SyncEntity, value: number): Promise<void> {
  const key = cursorKey(entity);
  const existing = await dataDb().syncState.get(key);
  // Jamais en arrière : une régression du curseur ferait re-tirer toute la base,
  // ce qui serait autorisé en cas de conflit mais bien plus coûteux qu'un
  // aller-retour inutile.
  if (existing !== undefined && existing.lastPulledAt > value) return;
  const row: SyncStateRow = {
    key,
    lastPulledAt: value,
    updatedAt: Date.now(),
  };
  await dataDb().syncState.put(row);
}

// ---------------------------------------------------------------------------
// Poussée
// ---------------------------------------------------------------------------

/**
 * Envoie les mutations en attente et acquitte ce qui est parti.
 *
 * Les entrées sont groupées par entité puis envoyées dans l'ordre de
 * `PUSH_ORDER` : une action ne peut pas être écrite si son match n'existe pas
 * encore, la contrainte de clé étrangère le refuserait. L'échec est **global** —
 * on n'acquitte rien tant qu'une table n'a pas confirmé.
 */
export async function pushPending(client: RemoteClient): Promise<number> {
  const database = dataDb();
  const entries = await peek(database, 200);
  if (entries.length === 0) return 0;

  const byEntity = new Map<SyncEntity, OutboxEntry[]>();
  for (const entry of entries) {
    const bucket = byEntity.get(entry.entity);
    if (bucket === undefined) {
      byEntity.set(entry.entity, [entry]);
    } else {
      bucket.push(entry);
    }
  }

  const sent: string[] = [];

  for (const entity of PUSH_ORDER) {
    const bucket = byEntity.get(entity);
    if (bucket === undefined) continue;

    const rows = bucket.map((entry) =>
      toCloudRow(entity, entry.payload as ActionRow),
    );

    const { error } = await client
      .from(tableOf(entity))
      .upsert(rows, { onConflict: "id" });

    if (error !== null) {
      // Échec global : rien n'est acquitté, tout est marqué en échec. Les
      // entrées déjà envoyées avec succès seront renvoyées au prochain cycle —
      // c'est le prix de l'idempotence, et il est inférieur à celui d'une perte.
      await fail(
        database,
        entries.map((entry) => entry.id),
        error.message,
      );
      throw new Error(error.message);
    }

    sent.push(...bucket.map((entry) => entry.id));
  }

  await ack(database, sent);
  return sent.length;
}

// ---------------------------------------------------------------------------
// Tirage
// ---------------------------------------------------------------------------

/**
 * Tire les lignes modifiées depuis le curseur et les écrit en local.
 *
 * Renvoie le nombre de lignes **réellement écrites**, pas le nombre de lignes
 * reçues : un cycle qui ne fait que relire ce qu'il vient de pousser renvoie 0.
 *
 * Résolution de conflit : **last-write-wins sur `updatedAt`**, et c'est
 * acceptable parce que l'usage est mono-appareil (PLAN.md §5). La règle n'est
 * pourtant pas appliquée à l'aveugle : une ligne locale plus récente est
 * conservée, ce qui protège le cas réel où le coach continue de saisir pendant
 * que le tirage se fait.
 *
 * Une ligne locale d'horodatage **égal** est elle aussi laissée intacte. Les deux
 * fois viennent du même `Date.now()` du client, donc le contenu est identique par
 * construction — c'est le cas ordinaire après une poussée, et réécrire ces lignes
 * à chaque cycle provoquerait un travail Dexie inutile au démarrage.
 */
export async function pullChanges(client: RemoteClient): Promise<number> {
  let applied = 0;

  for (const entity of PUSH_ORDER) {
    let cursor = await readCursor(entity);
    let pages = 0;

    // La boucle draine les pages plutôt que d'en prendre une seule : avec un
    // `gt` strict sur le `max(updated_at)` du lot précédent, s'arrêter à la
    // première page pleine sauterait le reste d'une saison d'un coup.
    for (;;) {
      const query = client
        .from(tableOf(entity))
        .select("*")
        .gt("updated_at", cursor)
        .limit(PAGE_SIZE);
      const { data, error } = await query.execute();

      if (error !== null) throw new Error(error.message);

      const rows = (data ?? []) as Record<string, unknown>[];
      if (rows.length === 0) break;

      applied += await applyRemote(entity, rows);

      cursor = rows.reduce(
        (max, row) => Math.max(max, remoteUpdatedAt(row)),
        cursor,
      );
      await writeCursor(entity, cursor);

      pages += 1;
      if (rows.length < PAGE_SIZE || pages >= MAX_PAGES) break;
    }
  }

  return applied;
}

/**
 * Table Dexie d'une entité, pour y écrire le lot tiré.
 *
 * Le retour est typé `Table<AnyRow, string>` : les quatre tables ont des types
 * de ligne différents, dont aucun n'est assignable aux autres, et l'union de
 * `Table` n'a pas de méthode `bulkGet` appelable. La conversion est sûre parce
 * que chaque branche retourne sa propre table et que les colonnes lues —
 * `id` et `updatedAt` — existent dans les quatre.
 */
type AnyRow = TeamRow | PlayerRow | MatchRow | ActionRow;

function tableOfRow(entity: SyncEntity): Table<AnyRow, string> {
  const database = dataDb();
  switch (entity) {
    case "teams":
      return database.teams as Table<AnyRow, string>;
    case "players":
      return database.players as Table<AnyRow, string>;
    case "matches":
      return database.matches as Table<AnyRow, string>;
    case "actions":
      return database.actions as Table<AnyRow, string>;
  }
}

/**
 * Écrit un lot tiré en local, en une transaction.
 *
 * La transaction est indispensable : une écriture interrompue au milieu
 * laisserait un match sans ses actions — un état que le domaine ne sait produire
 * nulle part, et que l'écran d'historique afficherait comme un match vide.
 */
async function applyRemote(
  entity: SyncEntity,
  rows: readonly Record<string, unknown>[],
): Promise<number> {
  const table = tableOfRow(entity);
  const parsed: (TeamRow | PlayerRow | MatchRow | ActionRow)[] = [];

  for (const raw of rows) {
    // Une ligne illisible est ignorée, pas fatale : elle est déjà dans le
    // registre serveur (`outbox`), donc rien n'est perdu, et bloquer tout le
    // tirage sur une seule ligne corrompue condamnerait l'app à ne plus
    // synchroniser du tout.
    try {
      parsed.push(fromCloudRowFor(entity, raw));
    } catch {
      continue;
    }
  }

  if (parsed.length === 0) return 0;

  const kept = await dataDb().transaction("rw", table, async () => {
    const existing = await table.bulkGet(parsed.map((row) => row.id));
    const toWrite = parsed.filter((row, index) => {
      const local = existing[index];
      if (local === undefined) return true;
      return row.updatedAt > local.updatedAt;
    });
    if (toWrite.length > 0) await table.bulkPut(toWrite);
    return toWrite.length;
  });

  return kept;
}

// ---------------------------------------------------------------------------
// Cycle
// ---------------------------------------------------------------------------

/** Détecte un échec **réseau** — distinct d'un refus du serveur. */
function isNetworkFailure(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("fetch") ||
    lower.includes("network") ||
    lower.includes("failed to fetch") ||
    lower.includes("timeout") ||
    lower.includes("load failed")
  );
}

let status: SyncStatus = INITIAL;
let consecutiveFailures = 0;
let running: Promise<SyncStatus> | null = null;
const listeners = new Set<(next: SyncStatus) => void>();

function publish(next: Partial<SyncStatus>): void {
  status = { ...status, ...next };
  for (const listener of listeners) listener(status);
}

/** Abonnement à l'état de synchronisation. Retourne la fonction de désabonnement. */
export function onSyncStatus(listener: (next: SyncStatus) => void): () => void {
  listeners.add(listener);
  listener(status);
  return () => {
    listeners.delete(listener);
  };
}

/** État courant, pour un composant qui veut la valeur sans s'abonner. */
export function syncStatus(): SyncStatus {
  return status;
}

/** Réinitialise l'état et le backoff. Réservé aux tests. */
export function resetSyncState(): void {
  status = INITIAL;
  consecutiveFailures = 0;
  running = null;
}

/**
 * Un cycle complet.
 *
 * Concurrency-safe : deux appels simultanés partagent la même promesse. Sans cela,
 * le déclenchement au retour réseau et le timer de 30 s peuvent se croiser et
 * envoyer deux fois le même lot — inoffensif grâce à l'idempotence, mais deux
 * fois plus lent en gymnase avec une connexion faible.
 *
 * @param force ignore le backoff (retry manuel depuis l'indicateur).
 */
export function syncNow(
  options: { force?: boolean } = {},
): Promise<SyncStatus> {
  if (running !== null) return running;

  const now = Date.now();
  if (
    options.force !== true &&
    status.retryAt !== null &&
    now < status.retryAt
  ) {
    return Promise.resolve(status);
  }

  running = cycle().finally(() => {
    running = null;
  });
  return running;
}

async function cycle(): Promise<SyncStatus> {
  const client = remote();

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    publish({
      state: "offline",
      pending: await pending(),
      error: null,
    });
    return status;
  }

  publish({ state: "syncing", error: null });

  try {
    await pushPending(client);
    await pullChanges(client);

    consecutiveFailures = 0;
    publish({
      state: "idle",
      pending: await pending(),
      lastSyncedAt: Date.now(),
      error: null,
      retryAt: null,
    });
  } catch (error) {
    consecutiveFailures += 1;
    const message = error instanceof Error ? error.message : String(error);
    const offline =
      (typeof navigator !== "undefined" && navigator.onLine === false) ||
      isNetworkFailure(message);

    publish({
      state: offline ? "offline" : "error",
      pending: await pending(),
      error: offline ? null : message,
      retryAt: Date.now() + backoffDelay(consecutiveFailures),
    });
  }

  return status;
}

async function pending(): Promise<number> {
  return pendingCount(dataDb());
}

// ---------------------------------------------------------------------------
// Cycle de vie
// ---------------------------------------------------------------------------

let stop: (() => void) | null = null;

/**
 * Démarre la synchronisation automatique et retourne la fonction d'arrêt.
 *
 * Déclenchée à trois moments, comme prévu au plan : au démarrage de la session,
 * au retour du réseau (`online`), et toutes les 30 secondes. La visibilité du
 * document est aussi écoutée : un téléphone qui sort du sac en pleine partie
 * lance un cycle immédiat au lieu d'attendre le prochain timer.
 *
 * L'indicateur du header et le retry manuel vivent dans le même store et n'ont
 * donc pas besoin d'être passés ici : ils s'abonnent et appellent `syncNow`.
 */
export function startSync(): () => void {
  if (stop !== null) return stop;

  const timer = setInterval(() => {
    void syncNow();
  }, SYNC_INTERVAL_MS);

  const onOnline = () => {
    // Retour du réseau : pas de backoff, on tente immédiatement. C'est le cas
    // le plus fréquent en gymnase, et attendre 2 à 300 s serait absurde.
    void syncNow({ force: true });
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") void syncNow();
  };

  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  void syncNow();

  stop = () => {
    clearInterval(timer);
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
    stop = null;
  };

  return stop;
}

/** Arrête la synchronisation. Idempotent. */
export function stopSync(): void {
  stop?.();
}
