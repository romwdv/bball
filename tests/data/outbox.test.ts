import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ack,
  clear,
  enqueue,
  entryFor,
  fail,
  outboxKey,
  peek,
  pendingCount,
} from "@/data/outbox";
import { createRepositories, type Repositories } from "@/data/repositories";
import { SpaceBunnyDB, type OutboxEntry, type SyncEntity } from "@/data/schema";
import { combos } from "@/domain/rules";

let counter = 0;
function uniqueName(): string {
  counter += 1;
  return `space-bunny-outbox-${counter}`;
}

let database: SpaceBunnyDB;
let repos: Repositories;

/** Crée un match et renvoie son id. */
async function seedMatch(opponent = "BC Nuit"): Promise<string> {
  const match = await repos.matches.create("local", {
    opponentName: opponent,
    date: "2026-10-05",
  });
  return match.id;
}

/** Entrées d'outbox d'une seule entité (la création d'un match enqueue aussi). */
async function entriesFor(entity: SyncEntity): Promise<OutboxEntry[]> {
  const entries = await peek(database);
  return entries.filter((entry) => entry.entity === entity);
}

beforeEach(async () => {
  database = new SpaceBunnyDB(uniqueName());
  await database.open();
  repos = createRepositories(database);
});

afterEach(async () => {
  database.close();
  await Dexie.delete(database.name);
});

describe("outbox", () => {
  it("construit une clé déterministe par ligne", () => {
    expect(outboxKey("actions", "a1")).toBe("actions:a1");
    // Une clé par ligne : c'est ce qui rend la déduplication triviale, et
    // empêche deux entités de se marcher dessus sur le même id.
    expect(outboxKey("actions", "a1")).not.toBe(outboxKey("players", "a1"));
  });

  it("n'écrit aucune entrée tant qu'aucune mutation n'a eu lieu", async () => {
    expect(await pendingCount(database)).toBe(0);
  });

  it("écrit une entrée par action appended", async () => {
    const matchId = await seedMatch();
    await repos.actions.append(matchId, combos.twoMade("p1", 1, "g1"));

    const entries = await entriesFor("actions");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.entity).toBe("actions");
    expect(entries[0]?.attempts).toBe(0);
    expect(entries[0]?.lastError).toBeNull();
    expect(entries[0]?.id).toBe(outboxKey("actions", entries[0]!.entityId));
  });

  it("écrit une entrée par action d'un combo, toutes dans le même état d'attente", async () => {
    const matchId = await seedMatch();
    await repos.actions.append(matchId, [
      {
        kind: "shot",
        playerId: "p1",
        quarter: 1,
        value: 2,
        made: false,
        fouled: true,
      },
      { kind: "free_throw", playerId: "p1", quarter: 1, made: true },
      { kind: "free_throw", playerId: "p1", quarter: 1, made: true },
    ]);

    expect(await entriesFor("actions")).toHaveLength(3);
    // Tous les lancers dus d'une série sont dans la file d'un seul coup.
    expect((await pendingCount(database)) - 1).toBe(3);
  });

  it("déduplique par ligne : une annulation remplace l'entrée, elle ne s'ajoute pas", async () => {
    const matchId = await seedMatch();
    const { actions } = await repos.actions.append(
      matchId,
      combos.twoMade("p1", 1, "g1"),
    );
    const id = actions[0]?.id ?? "";

    await repos.actions.voidAction(id, 1_000);

    // Le cloud ne fait que des upserts : envoyer la création *et* l'annulation
    // serait correct mais inutile. L'état le plus récent suffit.
    const entries = await entriesFor("actions");
    expect(entries).toHaveLength(1);
    expect((entries[0]?.payload as { voidedAt: number }).voidedAt).toBe(1_000);
  });

  it("conserve le nombre d'échecs et le message d'erreur", async () => {
    const matchId = await seedMatch();
    const { actions } = await repos.actions.append(
      matchId,
      combos.twoMade("p1", 1, "g1"),
    );
    const key = outboxKey("actions", actions[0]!.id);

    await fail(database, [key], "NetworkError");
    await fail(database, [key], "NetworkError");

    const after = await entryFor(database, "actions", actions[0]!.id);
    expect(after?.attempts).toBe(2);
    expect(after?.lastError).toBe("NetworkError");
  });

  it("préserve les échecs quand une nouvelle mutation remplace l'entrée", async () => {
    const matchId = await seedMatch();
    const { actions } = await repos.actions.append(
      matchId,
      combos.twoMade("p1", 1, "g1"),
    );
    await fail(
      database,
      [outboxKey("actions", actions[0]!.id)],
      "NetworkError",
    );

    await repos.actions.voidAction(actions[0]!.id, 2_000);

    const after = await entryFor(database, "actions", actions[0]!.id);
    // Le backoff ne doit pas repartir de zéro : une mutation locale ne
    // transforme pas un serveur injoignable en serveur joignable.
    expect(after?.attempts).toBe(1);
    expect(after?.lastError).toBe("NetworkError");
  });

  it("remplace l'état sans toucher au nombre d'échecs, même après plusieurs échecs", async () => {
    const matchId = await seedMatch();
    const { actions } = await repos.actions.append(
      matchId,
      combos.twoMade("p1", 1, "g1"),
    );
    const key = outboxKey("actions", actions[0]!.id);
    await fail(database, [key], "e1");
    await fail(database, [key], "e2");
    await fail(database, [key], "e3");

    await repos.actions.voidAction(actions[0]!.id, 3_000);

    expect(
      (await entryFor(database, "actions", actions[0]!.id))?.attempts,
    ).toBe(3);
  });

  it("supprime les entrées acquittées", async () => {
    const matchId = await seedMatch();
    await repos.actions.append(matchId, combos.twoMade("p1", 1, "g1"));
    const entries = await entriesFor("actions");

    expect(
      await ack(
        database,
        entries.map((entry) => entry.id),
      ),
    ).toBe(1);
    // Reste l'entrée du match : c'est le comportement voulu, l'ack porte sur les
    // ids qu'on lui donne.
    expect(await entriesFor("actions")).toHaveLength(0);
    expect(await pendingCount(database)).toBe(1);
  });

  it("ignore un ack vide", async () => {
    expect(await ack(database, [])).toBe(0);
  });

  it("ignore un fail vide", async () => {
    expect(await fail(database, [], "boom")).toBe(0);
  });

  it("ignore les ids d'entrées inconnues lors d'un fail", async () => {
    expect(await fail(database, ["actions:fantome"], "boom")).toBe(0);
  });

  it("renvoie les entrées les plus anciennes d'abord", async () => {
    const matchId = await seedMatch();
    await repos.actions.append(matchId, combos.twoMade("p1", 1, "g1"), {
      now: 300,
    });
    await repos.actions.append(matchId, combos.assist("p1", 1, "g2"), {
      now: 100,
    });
    await repos.actions.append(matchId, combos.steal("p1", 1, "g3"), {
      now: 200,
    });

    const times = (await entriesFor("actions")).map((entry) => entry.createdAt);
    expect(times).toEqual([100, 200, 300]);
  });

  it("respecte la limite de peek", async () => {
    const matchId = await seedMatch();
    for (let i = 0; i < 5; i += 1) {
      await repos.actions.append(matchId, combos.assist("p1", 1, `g${i}`), {
        now: 1000 + i,
      });
    }
    expect(await peek(database, 2)).toHaveLength(2);
  });

  it("horodate l'entrée avec l'heure courante si aucun instant n'est fourni", async () => {
    const before = Date.now();
    await enqueue(database, {
      entity: "matches",
      entityId: "m-sans-instant",
      payload: { id: "m-sans-instant" },
    });

    const entry = await entryFor(database, "matches", "m-sans-instant");
    expect(entry?.createdAt).toBeGreaterThanOrEqual(before);
  });

  it("vide la file", async () => {
    const matchId = await seedMatch();
    await repos.actions.append(matchId, combos.twoMade("p1", 1, "g1"));

    await clear(database);
    expect(await pendingCount(database)).toBe(0);
  });
});

describe("atomicité mutation + outbox", () => {
  it("n'écrit pas d'entrée d'outbox si la ligne est rejetée", async () => {
    await repos.teams.ensureLocal();
    const before = await pendingCount(database);

    await expect(
      repos.players.create("local", { firstName: "", lastName: "Sans prénom" }),
    ).rejects.toThrow(/invalide/i);

    expect(await pendingCount(database)).toBe(before);
    expect(await repos.players.listByTeam("local")).toHaveLength(0);
  });

  it("n'écrit aucune ligne partiellement quand un combo est invalide", async () => {
    const matchId = await seedMatch();
    const before = await pendingCount(database);

    // Le deuxième draft est un rebond sans `side` : invalide. L'écriture du
    // premier doit être annulée avec le lot.
    await expect(
      repos.actions.append(matchId, [
        { kind: "shot", playerId: "p1", quarter: 1, value: 2, made: true },
        { kind: "rebound", playerId: "p1", quarter: 1 } as never,
      ]),
    ).rejects.toThrow(/invalide/i);

    expect(await repos.actions.countByMatch(matchId)).toBe(0);
    expect(await repos.actions.nextSeq(matchId)).toBe(0);
    expect(await pendingCount(database)).toBe(before);
  });
});
