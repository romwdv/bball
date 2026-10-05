import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import {
  DB_NAME,
  migrateV1ToV2,
  SpaceBunnyDB,
  SYNC_KEY,
  V1_SCHEMA,
  V2_SCHEMA,
} from "@/data/schema";

/**
 * Une base « v1 » servant de fixture : mêmes noms de tables, mêmes index que
 * `V1_SCHEMA`, mais créée directement par Dexie sans la classe `SpaceBunnyDB`.
 * C'est le seul moyen de reproduire un upgrade réel.
 */
class LegacyV1Db extends Dexie {
  declare teams: Dexie.Table<Record<string, unknown>, string>;
  declare players: Dexie.Table<Record<string, unknown>, string>;
  declare matches: Dexie.Table<Record<string, unknown>, string>;
  declare actions: Dexie.Table<Record<string, unknown>, string>;
  declare syncState: Dexie.Table<Record<string, unknown>, string>;
  declare outbox: Dexie.Table<Record<string, unknown>, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores(V1_SCHEMA);
  }
}

/** Base à l'état v2 : c'est le dernier état qui existait avant `playerIds`. */
class LegacyV2Db extends Dexie {
  declare teams: Dexie.Table<Record<string, unknown>, string>;
  declare players: Dexie.Table<Record<string, unknown>, string>;
  declare matches: Dexie.Table<Record<string, unknown>, string>;
  declare actions: Dexie.Table<Record<string, unknown>, string>;
  declare syncState: Dexie.Table<Record<string, unknown>, string>;
  declare outbox: Dexie.Table<Record<string, unknown>, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores(V1_SCHEMA);
    this.version(2).stores(V2_SCHEMA);
  }
}

let counter = 0;
function uniqueName(): string {
  counter += 1;
  return `${DB_NAME}-schema-${counter}`;
}

describe("schéma Dexie", () => {
  beforeEach(() => {
    // Chaque test a sa propre base : fake-indexeddb est en mémoire, mais un
    // nom partagé ferait fuiter les lignes d'un test dans l'autre.
  });

  it("déclare les six tables attendues", async () => {
    const database = new SpaceBunnyDB(uniqueName());
    await database.open();
    expect(database.tables.map((table) => table.name).sort()).toEqual([
      "actions",
      "matches",
      "outbox",
      "players",
      "syncState",
      "teams",
    ]);
    database.close();
  });

  it("s'ouvre en version courante", async () => {
    const database = new SpaceBunnyDB(uniqueName());
    await database.open();
    expect(database.verno).toBe(3);
    database.close();
  });

  it("expose les index compounds attendus sur les actions", async () => {
    const database = new SpaceBunnyDB(uniqueName());
    await database.open();

    const indexes = database.actions.schema.indexes.map((index) => index.name);
    // `[matchId+seq]` sert `nextSeq`, `[matchId+quarter]` sert le filtre par
    // période, `groupId` sert `voidGroup`, `voidedAt` et `updatedAt` servent
    // le tirage descendant.
    expect(indexes).toContain("[matchId+seq]");
    expect(indexes).toContain("[matchId+quarter]");
    expect(indexes).toContain("groupId");
    expect(indexes).toContain("voidedAt");
    expect(indexes).toContain("updatedAt");

    database.close();
  });

  it("n'ajoute aucune colonne à un enregistrement créé en v2", async () => {
    const database = new SpaceBunnyDB(uniqueName());
    await database.open();

    await database.teams.put({
      id: "local",
      name: "Mon équipe",
      ownerId: null,
      updatedAt: 1,
    });

    expect(await database.teams.get("local")).toEqual({
      id: "local",
      name: "Mon équipe",
      ownerId: null,
      updatedAt: 1,
    });
    database.close();
  });

  describe("migration v1 → v2", () => {
    it("ouvre une base v1 sans tenter de migration", async () => {
      const legacy = new LegacyV1Db(uniqueName());
      await legacy.open();
      expect(legacy.verno).toBe(1);
      legacy.close();
    });

    it("ajoute updatedAt = 0 aux lignes existantes", async () => {
      const name = uniqueName();

      const legacy = new LegacyV1Db(name);
      await legacy.open();
      await legacy.players.put({
        id: "p1",
        teamId: "local",
        firstName: "Ada",
        lastName: "Lovelace",
        number: 4,
      });
      await legacy.matches.put({
        id: "m1",
        teamId: "local",
        opponentName: "BC Nuit",
        date: "2026-10-05",
        status: "live",
        createdAt: 1,
        finishedAt: null,
      });
      await legacy.actions.put({
        id: "a1",
        matchId: "m1",
        playerId: "p1",
        seq: 0,
        quarter: 1,
        kind: "shot",
        value: 3,
        made: true,
        voidedAt: null,
      });
      await legacy.syncState.put({ key: SYNC_KEY, lastPulledAt: 42 });
      legacy.close();

      const upgraded = new SpaceBunnyDB(name);
      await upgraded.open();

      expect(upgraded.verno).toBe(3);
      // 0 et non `Date.now()` : une valeur élevée ferait passer ces lignes pour
      // déjà synchronisées et le cloud ne les recevrait jamais.
      expect(await upgraded.players.get("p1")).toMatchObject({ updatedAt: 0 });
      expect(await upgraded.matches.get("m1")).toMatchObject({ updatedAt: 0 });
      expect(await upgraded.actions.get("a1")).toMatchObject({ updatedAt: 0 });
      expect(await upgraded.syncState.get(SYNC_KEY)).toMatchObject({
        lastPulledAt: 42,
        updatedAt: 0,
      });

      upgraded.close();
    });

    it("préserve toutes les colonnes métier", async () => {
      const name = uniqueName();

      const legacy = new LegacyV1Db(name);
      await legacy.open();
      await legacy.actions.put({
        id: "a1",
        matchId: "m1",
        playerId: "p1",
        seq: 7,
        quarter: 3,
        kind: "shot",
        value: 2,
        made: true,
        fouled: true,
        groupId: "g1",
        voidedAt: null,
      });
      legacy.close();

      const upgraded = new SpaceBunnyDB(name);
      await upgraded.open();

      expect(await upgraded.actions.get("a1")).toEqual({
        id: "a1",
        matchId: "m1",
        playerId: "p1",
        seq: 7,
        quarter: 3,
        kind: "shot",
        value: 2,
        made: true,
        fouled: true,
        groupId: "g1",
        voidedAt: null,
        updatedAt: 0,
      });

      upgraded.close();
    });

    it("ne réécrit pas un updatedAt déjà présent", async () => {
      const name = uniqueName();

      const legacy = new LegacyV1Db(name);
      await legacy.open();
      // Une base réellement issue d'une v2 de développement peut déjà porter la
      // colonne si le schéma a été redéfini entre deux builds.
      await legacy.players.put({
        id: "p1",
        teamId: "local",
        firstName: "Ada",
        lastName: "Lovelace",
        number: 4,
        updatedAt: 1_700_000_000_000,
      });
      legacy.close();

      const upgraded = new SpaceBunnyDB(name);
      await upgraded.open();

      expect((await upgraded.players.get("p1"))?.updatedAt).toBe(
        1_700_000_000_000,
      );
      upgraded.close();
    });

    it("rend le curseur de tirage descendant utilisable après upgrade", async () => {
      const name = uniqueName();

      const legacy = new LegacyV1Db(name);
      await legacy.open();
      for (let seq = 0; seq < 5; seq += 1) {
        await legacy.actions.put({
          id: `a${seq}`,
          matchId: "m1",
          playerId: "p1",
          seq,
          quarter: 1,
          kind: "assist",
          voidedAt: null,
        });
      }
      legacy.close();

      const upgraded = new SpaceBunnyDB(name);
      await upgraded.open();

      // Toutes les lignes à 0 sont « plus récentes que le curseur », donc le
      // premier tirage les renvoie toutes.
      const stale = await upgraded.actions
        .where("updatedAt")
        .aboveOrEqual(0)
        .toArray();
      expect(stale).toHaveLength(5);

      upgraded.close();
    });

    it("est idempotente : réouvrir une base déjà migrée ne change rien", async () => {
      const name = uniqueName();

      const legacy = new LegacyV1Db(name);
      await legacy.open();
      await legacy.players.put({
        id: "p1",
        teamId: "local",
        firstName: "Ada",
        lastName: "Lovelace",
        number: 4,
      });
      legacy.close();

      const first = new SpaceBunnyDB(name);
      await first.open();
      await first.players.put({
        id: "p2",
        teamId: "local",
        firstName: "Grace",
        lastName: "Hopper",
        number: 5,
        updatedAt: 123,
      });
      first.close();

      const second = new SpaceBunnyDB(name);
      await second.open();

      expect((await second.players.get("p1"))?.updatedAt).toBe(0);
      expect((await second.players.get("p2"))?.updatedAt).toBe(123);
      second.close();
    });

    it("applique la migration sur une base vide sans erreur", async () => {
      const name = uniqueName();

      const legacy = new LegacyV1Db(name);
      await legacy.open();
      legacy.close();

      const upgraded = new SpaceBunnyDB(name);
      await upgraded.open();

      expect(await upgraded.players.count()).toBe(0);
      upgraded.close();
    });

    it("migrateV1ToV2 couvre les cinq tables répliquées", async () => {
      const legacy = new LegacyV1Db(uniqueName());
      await legacy.open();

      await legacy.teams.put({
        id: "local",
        name: "Mon équipe",
        ownerId: null,
      });
      await legacy.players.put({
        id: "p1",
        teamId: "local",
        firstName: "Ada",
        lastName: "Lovelace",
        number: 4,
      });
      await legacy.matches.put({
        id: "m1",
        teamId: "local",
        opponentName: "BC Nuit",
        date: "2026-10-05",
        status: "finished",
        createdAt: 1,
        finishedAt: 2,
      });
      await legacy.actions.put({
        id: "a1",
        matchId: "m1",
        playerId: "p1",
        seq: 0,
        quarter: 4,
        kind: "block",
        voidedAt: null,
      });
      await legacy.syncState.put({ key: SYNC_KEY, lastPulledAt: 7 });

      // Appelée explicitement, hors upgrade : vérifie que la fonction est
      // autonome et ne touche pas l'outbox (jamais répliquée, cf. §5).
      await legacy.transaction("rw", legacy.tables, (tx) =>
        migrateV1ToV2(tx as unknown as Parameters<typeof migrateV1ToV2>[0]),
      );

      for (const table of [
        legacy.teams,
        legacy.players,
        legacy.matches,
        legacy.actions,
        legacy.syncState,
      ]) {
        const rows = await table.toArray();
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((row) => row.updatedAt === 0)).toBe(true);
      }

      legacy.close();
    });
  });

  describe("migration v2 → v3", () => {
    it("ajoute un roster vide aux matchs qui n'en ont pas", async () => {
      const name = uniqueName();

      const legacy = new LegacyV2Db(name);
      await legacy.open();
      await legacy.matches.put({
        id: "m1",
        teamId: "local",
        opponentName: "BC Nuit",
        date: "2026-10-05",
        status: "finished",
        createdAt: 1,
        finishedAt: 2,
        updatedAt: 1_700_000_000_000,
      });
      legacy.close();

      const upgraded = new SpaceBunnyDB(name);
      await upgraded.open();

      const match = await upgraded.matches.get("m1");
      // Vide, et non le roster actuel de l'équipe : attribuer retroactivement
      // les joueurs d'aujourd'hui à un match d'il y a trois mois donnerait
      // l'illusion qu'ils y ont joué.
      expect(match?.playerIds).toEqual([]);
      // La colonne `updatedAt` de v2 est préservée telle quelle.
      expect(match?.updatedAt).toBe(1_700_000_000_000);
      upgraded.close();
    });

    it("préserve un roster déjà enregistré", async () => {
      const name = uniqueName();

      const legacy = new LegacyV2Db(name);
      await legacy.open();
      await legacy.matches.put({
        id: "m1",
        teamId: "local",
        opponentName: "BC Nuit",
        date: "2026-10-05",
        status: "live",
        createdAt: 1,
        finishedAt: null,
        updatedAt: 5,
        playerIds: ["p1", "p2"],
      });
      legacy.close();

      const upgraded = new SpaceBunnyDB(name);
      await upgraded.open();

      expect((await upgraded.matches.get("m1"))?.playerIds).toEqual([
        "p1",
        "p2",
      ]);
      upgraded.close();
    });
  });

  it("V2_SCHEMA ajoute exactement les index attendus", () => {
    expect(V2_SCHEMA.actions).toContain("voidedAt");
    expect(V2_SCHEMA.actions).toContain("updatedAt");
    expect(V2_SCHEMA.actions).toContain("groupId");
    expect(V2_SCHEMA.outbox).toContain("[entity+entityId]");
    // Un index de v1 ne doit pas avoir disparu.
    expect(V2_SCHEMA.actions).toContain("[matchId+seq]");
    expect(V2_SCHEMA.players).toContain("[teamId+number]");
  });
});
