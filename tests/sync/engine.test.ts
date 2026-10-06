import Dexie from "dexie";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { dataDb, repos, setRepos } from "@/data";
import { createRepositories } from "@/data/repositories";
import { entryFor, pendingCount, setDb, SpaceBunnyDB } from "@/data";
import { setRemote } from "@/sync/supabase-client";
import {
  backoffDelay,
  cursorKey,
  onSyncStatus,
  pullChanges,
  pushPending,
  resetSyncState,
  startSync,
  stopSync,
  SYNC_INTERVAL_MS,
  syncNow,
  syncStatus,
} from "@/sync/engine";
import { fromCloudRow, toCloudRow } from "@/sync/mapping";
import { createFakeRemote, type FakeRemote } from "./fakeRemote";
import { newId } from "@/data/ids";

/**
 * Tests du moteur de synchronisation.
 *
 * Ce que ces tests verrouillent, et qui ne se déduit pas à la lecture :
 *   1. **Rien n'est perdu** — un upsert en échec laisse toute la file en place,
 *      `attempts` incrémenté, et le payload intact ;
 *   2. **L'ordre de dépendance** — `teams` avant `players` avant `matches` avant
 *      `actions`, sinon la clé étrangère refuse l'action d'un match inconnu ;
 *   3. **Le curseur est par table** — un match écrit à T+1000 ne doit pas faire
 *      sauter une action écrite à T+500 ;
 *   4. **Le last-write-wins est borné** — une ligne locale plus récente survit
 *      au tirage.
 */

let counter = 0;
let database: SpaceBunnyDB;
let remote: FakeRemote;

beforeEach(async () => {
  counter += 1;
  database = new SpaceBunnyDB(`space-bunny-sync-${counter}`);
  await database.open();
  setDb(database);
  setRepos(createRepositories(database));
  remote = createFakeRemote();
  setRemote(remote.client);
  resetSyncState();
});

afterEach(async () => {
  vi.restoreAllMocks();
  setRemote(null);
  setRepos(null);
  setDb(null);
  resetSyncState();
  database.close();
  await Dexie.delete(database.name);
});

/** Match complet : équipe, joueur, match, action — tous en file. */
async function seed() {
  const store = repos();
  const team = await store.teams.ensureLocal();
  const player = await store.players.create(team.id, {
    firstName: "Karim",
    lastName: "Bernard",
    number: 4,
  });
  const match = await store.matches.create(team.id, {
    opponentName: "BC Nuit",
    date: "2026-10-06",
  });
  const result = await store.actions.append(match.id, [
    { playerId: player.id, quarter: 1, kind: "shot", value: 2, made: true },
  ]);
  return { team, player, match, action: result.actions[0]! };
}

describe("poussée de l'outbox", () => {
  it("vide la file et envoie chaque entité une seule fois", async () => {
    await seed();

    const sent = await pushPending(remote.client);

    expect(sent).toBe(4);
    expect(await pendingCount(database)).toBe(0);
    expect(remote.calls.filter((call) => call.op === "upsert")).toEqual([
      { op: "upsert", table: "teams", rows: 1 },
      { op: "upsert", table: "players", rows: 1 },
      { op: "upsert", table: "matches", rows: 1 },
      { op: "upsert", table: "actions", rows: 1 },
    ]);
  });

  it("conserve l'état du cloud, colonnes en snake_case", async () => {
    const { match } = await seed();
    await pushPending(remote.client);

    const rows = remote.tables.get("matches") ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: match.id,
      team_id: match.teamId,
      opponent_name: "BC Nuit",
      status: "draft",
    });
    // `createdAt`/`updatedAt` sont des entiers côté domaine ; PostgREST les rend
    // en `bigint`, donc la conversion doit survivre à l'aller-retour.
    expect(typeof rows[0]?.updated_at).toBe("number");
  });

  it("n'acquitte rien quand une table refuse", async () => {
    await seed();
    const before = await pendingCount(database);
    remote.failOn.set("matches", "violation de clé étrangère");

    await expect(pushPending(remote.client)).rejects.toThrow(
      "violation de clé étrangère",
    );

    // Aucune perte : les quatre entrées sont encore là, y compris celles qui ont
    // déjà été acceptées avant l'échec. Le réessai est idempotent.
    expect(await pendingCount(database)).toBe(before);

    const entry = await entryFor(database, "matches", "inconnu");
    expect(entry).toBeUndefined();
  });

  it("incrémente attempts et conserve le message d'erreur", async () => {
    const { match } = await seed();
    remote.failOn.set("matches", "RLS refusée");

    await expect(pushPending(remote.client)).rejects.toThrow();
    const failed = await entryFor(database, "matches", match.id);
    expect(failed?.attempts).toBe(1);
    expect(failed?.lastError).toBe("RLS refusée");

    await expect(pushPending(remote.client)).rejects.toThrow();
    expect((await entryFor(database, "matches", match.id))?.attempts).toBe(2);
  });

  it("n'envoie que le dernier état d'une ligne (dédupe par id)", async () => {
    const { match, action } = await seed();

    // Annulation : l'entrée est remplacée, pas ajoutée (propriété de l'outbox).
    await repos().actions.voidAction(action.id, 1_700_000_000_000);
    expect(await pendingCount(database)).toBe(4);

    await pushPending(remote.client);

    const actions = remote.tables.get("actions") ?? [];
    expect(actions).toHaveLength(1);
    expect(actions[0]?.voided_at).toBe(1_700_000_000_000);
    expect(match.id).toBe(match.id);
  });

  it("rejoue deux fois sans créer de doublon", async () => {
    await seed();
    await pushPending(remote.client);

    // L'acquittement a été perdu après l'envoi (onglet fermé, processus tué) :
    // l'entrée est remise en file à l'identique. Le rejeu doit être sans effet.
    const leftover = await database.outbox.toArray();
    expect(leftover).toHaveLength(0);

    // La payload d'outbox est la ligne **locale** (camelCase), pas la colonne
    // cloud : la re-fabriquer via le mapping aller, pour ne pas écrire un test
    // qui passe pour la mauvaise raison.
    const match = remote.tables.get("matches")?.[0];
    expect(match).toBeDefined();
    await database.outbox.put({
      id: `matches:${String(match?.id)}`,
      entity: "matches",
      entityId: String(match?.id),
      payload: fromCloudRow("matches", match as Record<string, unknown>),
      createdAt: Date.now(),
      attempts: 0,
      lastError: null,
    });

    await pushPending(remote.client);
    expect(remote.tables.get("matches")).toHaveLength(1);
    expect(await pendingCount(database)).toBe(0);
  });
});

describe("tirage descendant", () => {
  it("écrit les lignes tirées et avance le curseur", async () => {
    const team = await repos().teams.ensureLocal();
    const player = await repos().players.create(team.id, {
      firstName: "Karim",
      lastName: "Bernard",
      number: 4,
    });

    // Le tirage l'emporte sur la ligne locale : `updatedAt` distant plus récent.
    const remotePlayer = toCloudRow("players", {
      ...player,
      firstName: "Yanis",
      updatedAt: player.updatedAt + 1,
    });
    remote.tables.set("players", [remotePlayer]);

    const applied = await pullChanges(remote.client);

    expect(applied).toBe(1);
    const stored = await repos().players.get(player.id);
    expect(stored?.firstName).toBe("Yanis");

    const cursor = await database.syncState.get(cursorKey("players"));
    expect(cursor?.lastPulledAt).toBe(player.updatedAt + 1);
  });

  it("ne retire pas deux fois la même ligne", async () => {
    const team = await repos().teams.ensureLocal();
    const player = await repos().players.create(team.id, {
      firstName: "Karim",
      lastName: "Bernard",
      number: 4,
    });
    remote.tables.set("players", [
      toCloudRow("players", { ...player, updatedAt: player.updatedAt + 1 }),
    ]);

    expect(await pullChanges(remote.client)).toBe(1);
    // Curseur déjà au niveau de la ligne : le tirage suivant doit rendre la
    // main, pas réécrire.
    expect(await pullChanges(remote.client)).toBe(0);
  });

  it("conserve une ligne locale plus récente (last-write-wins borné)", async () => {
    const team = await repos().teams.ensureLocal();
    const player = await repos().players.create(team.id, {
      firstName: "Karim",
      lastName: "Bernard",
      number: 4,
    });
    // Le coach a corrigé le prénom en ligne pendant que le tirage se faisait.
    await repos().players.update(player.id, { firstName: "Karim Jr" });

    remote.tables.set("players", [
      toCloudRow("players", {
        ...player,
        firstName: "Ancien",
        updatedAt: player.updatedAt - 1,
      }),
    ]);

    expect(await pullChanges(remote.client)).toBe(0);
    expect((await repos().players.get(player.id))?.firstName).toBe("Karim Jr");
  });

  it("un curseur par table : un match récent ne fait pas sauter une action", async () => {
    const store = repos();
    const team = await store.teams.ensureLocal();
    const player = await store.players.create(team.id, {
      firstName: "Karim",
      lastName: "Bernard",
      number: 4,
    });
    const match = await store.matches.create(team.id, {
      opponentName: "BC Nuit",
      date: "2026-10-06",
    });

    // Action écrite à T+500, match réécrit à T+1000.
    const action = {
      ...(
        await store.actions.append(match.id, [
          {
            playerId: player.id,
            quarter: 1,
            kind: "shot",
            value: 2,
            made: true,
          },
        ])
      ).actions[0]!,
      updatedAt: 500,
    };

    remote.tables.set("matches", [
      toCloudRow("matches", {
        ...match,
        opponentName: "BC Jour",
        updatedAt: 1_000,
      }),
    ]);
    remote.tables.set("actions", [toCloudRow("actions", action)]);

    await pullChanges(remote.client);

    // Le curseur des actions est à son propre compte : l'action n'a pas été
    // sautée parce que le match, plus récent, avait avancé le curseur global.
    const cursor = await database.syncState.get(cursorKey("actions"));
    expect(cursor?.lastPulledAt).toBe(500);
    expect(await store.actions.get(action.id)).toBeDefined();
  });

  it("ne fait jamais reculer un curseur", async () => {
    await database.syncState.put({
      key: cursorKey("players"),
      lastPulledAt: 9_000,
      updatedAt: 1,
    });
    remote.tables.set("players", [
      toCloudRow("players", {
        id: newId(),
        teamId: newId(),
        firstName: "A",
        lastName: "B",
        number: 1,
        updatedAt: 1_000,
      }),
    ]);

    await pullChanges(remote.client);

    const cursor = await database.syncState.get(cursorKey("players"));
    expect(cursor?.lastPulledAt).toBe(9_000);
  });

  it("ignore une ligne illisible sans bloquer le reste du tirage", async () => {
    const team = await repos().teams.ensureLocal();
    const good = await repos().players.create(team.id, {
      firstName: "Karim",
      lastName: "Bernard",
      number: 4,
    });
    const bad = { ...toCloudRow("players", good), id: newId() };

    remote.tables.set("players", [
      // `last_name` vide : refusé par `PlayerSchema`.
      { ...bad, last_name: "", updated_at: good.updatedAt + 1 },
      toCloudRow("players", {
        ...good,
        firstName: "Yanis",
        updatedAt: good.updatedAt + 2,
      }),
    ]);

    expect(await pullChanges(remote.client)).toBe(1);
    expect((await repos().players.get(good.id))?.firstName).toBe("Yanis");
  });

  it("propage une erreur select plutôt que de l'avaler", async () => {
    remote.failSelectOn.set("teams", "échec réseau");

    await expect(pullChanges(remote.client)).rejects.toThrow("échec réseau");
  });
});

describe("backoff", () => {
  it("double puis plafonne", () => {
    expect(backoffDelay(0)).toBe(0);
    expect(backoffDelay(1)).toBe(2_000);
    expect(backoffDelay(2)).toBe(4_000);
    expect(backoffDelay(3)).toBe(8_000);
    expect(backoffDelay(20)).toBe(300_000);
  });
});

describe("intégration push puis pull", () => {
  it("un aller-retour complet ne duplique rien", async () => {
    const { match, action } = await seed();

    await pushPending(remote.client);
    // Le tirage relit ce que la poussée vient d'écrire : même contenu, donc
    // l'égalité stricte `>=` le garde et rien n'est réécrit.
    const pulled = await pullChanges(remote.client);

    expect(pulled).toBe(0);
    expect(remote.tables.get("actions")).toHaveLength(1);
    expect(await repos().matches.get(match.id)).toBeDefined();
    expect(await repos().actions.get(action.id)).toBeDefined();
    expect(await pendingCount(database)).toBe(0);
    expect(dataDb()).toBe(database);
  });
});

describe("cycle complet et backoff", () => {
  it("publie un état repos quand tout est parti", async () => {
    await seed();
    await syncNow();

    const status = syncStatus();
    expect(status.state).toBe("idle");
    expect(status.pending).toBe(0);
    expect(status.lastSyncedAt).not.toBeNull();
    expect(status.error).toBeNull();
    expect(status.retryAt).toBeNull();
  });

  it("publie hors-ligne sans requête quand le réseau est absent", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    await seed();

    await syncNow();

    // Aucune requête : en gymnase, des allers-retours inutiles coûtent plus cher
    // que l'attente.
    expect(remote.calls).toHaveLength(0);
    expect(syncStatus().state).toBe("offline");
    expect(syncStatus().error).toBeNull();
  });

  it("programme un nouvel essai après un échec applicatif", async () => {
    await seed();
    remote.failOn.set("actions", "violation de contrainte");

    await syncNow();

    const status = syncStatus();
    expect(status.state).toBe("error");
    expect(status.error).toBe("violation de contrainte");
    // Le retry est daté, pas compté : le test doit lire un horaire, pas une durée.
    expect(status.retryAt).toBeGreaterThan(Date.now());
  });

  it("respecte le backoff, sauf en retry manuel", async () => {
    await seed();
    remote.failOn.set("actions", "échec");

    await syncNow();
    const afterFirst = remote.calls.length;

    // Sans `force`, le moteur respecte le délai et n'essaie pas.
    await syncNow();
    expect(remote.calls.length).toBe(afterFirst);

    await syncNow({ force: true });
    expect(remote.calls.length).toBeGreaterThan(afterFirst);
  });

  it("reprend un cycle en cours plutôt que d'en lancer deux", async () => {
    await seed();

    // Deux appels simultanés partagent la même promesse : sans cela, le timer de
    // 30 s et l'événement `online` pourraient se croiser.
    const [first, second] = await Promise.all([syncNow(), syncNow()]);
    expect(first).toBe(second);
  });

  it("programme un cycle automatique et l'annule à l'arrêt", async () => {
    // Horloges réelles : `fake-indexeddb` s'appuie sur des timers, et les geler
    // ferait expirer les `beforeEach`. L'intervalle est donc intercepté plutôt
    // qu'attendu.
    const interval = vi
      .spyOn(globalThis, "setInterval")
      // La valeur n'est jamais utilisée : le timer est annulé à l'arrêt, sans
      // qu'un vrai intervalle ne survive au test.
      .mockReturnValue(0 as unknown as ReturnType<typeof setInterval>);

    const stop = startSync();
    expect(interval).toHaveBeenCalledWith(
      expect.any(Function),
      SYNC_INTERVAL_MS,
    );

    await seed();
    expect(remote.calls.length).toBeGreaterThan(0);

    // `startSync` est idempotent : un second appel ne crée pas un second timer.
    expect(startSync()).toBe(stop);

    stop();
    expect(interval.mock.calls.length).toBe(1);
    interval.mockRestore();
  });

  it("relance sans délai au retour du réseau", async () => {
    await seed();

    // Un cycle déjà en échec a programmé un retry : c'est exactement le cas que
    // le retour du réseau doit court-circuiter, sinon le coach attend le backoff
    // alors que la connexion est revenue.
    remote.failOn.set("actions", "échec");
    startSync();
    await syncNow();
    expect(syncStatus().retryAt).not.toBeNull();

    const before = remote.calls.length;
    remote.failOn.clear();
    window.dispatchEvent(new Event("online"));
    await syncNow();

    expect(remote.calls.length).toBeGreaterThan(before);
    stopSync();
  });

  it("reprend au retour de l'écran, pas au masquage", async () => {
    startSync();
    await seed();
    const before = remote.calls.length;

    // Masqué : inutile d'aller sur le réseau, personne ne regarde l'écran.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    expect(remote.calls.length).toBe(before);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await syncNow();

    // Un téléphone sorti du sac en pleine partie doit synchroniser tout de suite,
    // pas attendre le prochain timer.
    expect(remote.calls.length).toBeGreaterThan(before);
    stopSync();
  });

  it("n'ouvre qu'un seul cycle, même appelé deux fois", () => {
    const first = startSync();
    const second = startSync();
    expect(second).toBe(first);
    stopSync();
    // `stopSync` sans cycle ouvert ne doit rien faire de particulier.
    expect(() => {
      stopSync();
    }).not.toThrow();
  });

  it("abonner rend l'état immédiatement et se désabonne", async () => {
    const seen: string[] = [];
    const unsubscribe = onSyncStatus((status) => seen.push(status.state));

    expect(seen).toEqual([syncStatus().state]);
    unsubscribe();
  });
});
