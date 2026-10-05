import type { OutboxEntry, SpaceBunnyDB, SyncEntity } from "@/data/schema";

/**
 * File d'attente des mutations à envoyer au cloud.
 *
 * Modèle *outbox* (PLAN.md §5), dans son état le plus simple : on n'écrit que
 * des entrées, on les lit dans l'ordre, on les supprime une fois acquittées. Le
 * moteur de synchronisation lui-même n'arrive qu'en phase 6 — ici on ne garantit
 * que la **file**, c'est-à-dire que rien n'est perdu entre l'écriture locale et
 * l'envoi.
 *
 * Trois propriétés non négociables :
 *
 * 1. **Aucune perte.** L'entrée est écrite dans la *même* transaction IndexedDB
 *    que la mutation. Soit les deux passent, soit aucune : il ne peut pas exister
 *    une action en base que la synchronisation n'essaiera jamais d'envoyer.
 * 2. **Déduplication par ligne.** Créer puis annuler une action produit deux
 *    mutations de la même ligne. Comme le cloud ne connaît que des upserts,
 *    n'envoyer que le dernier état suffit : `enqueue` écrase donc l'entrée
 *    précédente au lieu de s'accumuler.
 * 3. **Aucune opération `delete`.** Le domaine est append-only et une annulation
 *    est un upsert (`voidedAt`). Une entrée décrit donc toutes les mutations
 *    possibles.
 */

/** Corps brut d'une mutation, à upsert côté cloud. */
export type OutboxPayload = Record<string, unknown>;

/**
 * Clé primaire déterministe d'une entrée d'outbox : une entrée par ligne.
 *
 * Déterministe (et non un `newId()`), parce que la propriété 2 veut dire « au
 * plus une entrée par ligne ». Une clé aléatoire obligerait à chercher l'entrée
 * existante avant d'en écrire une nouvelle, donc à lire puis écrire — deux
 * opérations là où une clé calculée suffit.
 */
export function outboxKey(entity: SyncEntity, entityId: string): string {
  return `${entity}:${entityId}`;
}

/**
 * Ajoute, ou remplace, l'entrée d'outbox correspondant à une ligne.
 *
 * ⚠️ **À appeler à l'intérieur d'une transaction `rw` couvrant la table
 * `outbox`.** Les repositories le font systématiquement (voir `repositories.ts`) :
 * c'est la condition pour que la propriété 1 tienne. Hors transaction, Dexie
 * ouvrirait la sienne et l'entrée pourrait être écrite alors que la mutation
 * échouerait — exactement la perte de données que ce module existe pour éviter.
 */
export async function enqueue(
  database: SpaceBunnyDB,
  entry: {
    entity: SyncEntity;
    entityId: string;
    payload: OutboxPayload;
    now?: number;
  },
): Promise<string> {
  const key = outboxKey(entry.entity, entry.entityId);

  // Propriété 2 : une seule entrée par ligne, la plus récente gagne. `attempts`
  // et `lastError` sont conservés : la file n'est pas purgée par une nouvelle
  // mutation, mais replacée par un état plus récent — le backoff doit survivre.
  const previous = await database.outbox.get(key);
  await database.outbox.put({
    id: key,
    entity: entry.entity,
    entityId: entry.entityId,
    payload: entry.payload,
    createdAt: entry.now ?? Date.now(),
    attempts: previous?.attempts ?? 0,
    lastError: previous?.lastError ?? null,
  });

  return key;
}

/**
 * Entrées à envoyer, les plus anciennes d'abord.
 *
 * Le tri par `createdAt` rend le drain déterministe, ce qui compte pour
 * `voidedAt` : une annulation envoyée avant sa création se ferait écraser par
 * celle-ci au tirage descendant. L'ordre à `createdAt` ex æquo est celui de la
 * clé primaire, donc stable lui aussi.
 */
export async function peek(
  database: SpaceBunnyDB,
  limit = 50,
): Promise<OutboxEntry[]> {
  return database.outbox.orderBy("createdAt").limit(limit).toArray();
}

/** Nombre d'entrées en attente. Alimente l'indicateur du header (§4). */
export async function pendingCount(database: SpaceBunnyDB): Promise<number> {
  return database.outbox.count();
}

/** Supprime les entrées acquittées par le cloud. */
export async function ack(
  database: SpaceBunnyDB,
  ids: readonly string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  await database.outbox.bulkDelete([...ids]);
  return ids.length;
}

/**
 * Enregistre l'échec d'un envoi sans perdre l'entrée.
 *
 * `attempts` est incrémenté et le message conservé : c'est ce qui permettra un
 * backoff exponentiel en phase 6 et un affichage « 3 échecs » honnête. Une entrée
 * échouée reste en file, donc sera réessayée — c'est le comportement voulu, le
 * mode hors-ligne étant la situation normale et non l'exception.
 */
export async function fail(
  database: SpaceBunnyDB,
  ids: readonly string[],
  error: string,
): Promise<number> {
  if (ids.length === 0) return 0;

  const found = await database.outbox.bulkGet([...ids]);
  const rows = found.filter(
    (entry): entry is OutboxEntry => entry !== undefined,
  );
  await database.outbox.bulkPut(
    rows.map((entry) => ({
      ...entry,
      attempts: entry.attempts + 1,
      lastError: error,
    })),
  );
  return rows.length;
}

/**
 * Vide complètement l'outbox.
 *
 * Réservé aux tests et au réinitialiseur de développement. Une entrée supprimée
 * ici est une mutation qui ne sera **jamais** envoyée : le cloud la croira
 * synchronisée à tort.
 */
export async function clear(database: SpaceBunnyDB): Promise<void> {
  await database.outbox.clear();
}

/** Entrée d'outbox correspondant à une ligne. Diagnostic « hors-ligne ». */
export async function entryFor(
  database: SpaceBunnyDB,
  entity: SyncEntity,
  entityId: string,
): Promise<OutboxEntry | undefined> {
  return database.outbox.get(outboxKey(entity, entityId));
}
