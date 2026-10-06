import Dexie from "dexie";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { entryFor, pendingCount, repos, setDb, setRepos } from "@/data";
import { createRepositories, LOCAL_TEAM_ID } from "@/data/repositories";
import { SpaceBunnyDB } from "@/data/schema";
import { isUuid } from "@/data/ids";
import { claimTeam } from "@/sync/claim";
import { pushPending } from "@/sync/engine";
import { setRemote } from "@/sync/supabase-client";
import { createFakeRemote, type FakeRemote } from "./fakeRemote";

/**
 * Tests de la phase 6b — données orphelines.
 *
 * Le test qui compte est le dernier : **données créées hors-ligne, puis
 * connexion — tout doit se retrouver dans le cloud**. C'est la seule garantie
 * qui justifie le garde-fou d'accès ; si elle casse, il faut choisir entre
 * l'app bloquée sans compte et la perte de données.
 */

let counter = 0;
let database: SpaceBunnyDB;
let remote: FakeRemote;
const USER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER_USER = "ffffffff-0000-4000-8000-000000000000";

beforeEach(async () => {
  counter += 1;
  database = new SpaceBunnyDB(`space-bunny-claim-${counter}`);
  await database.open();
  setDb(database);
  setRepos(createRepositories(database));
  remote = createFakeRemote();
  setRemote(remote.client);
});

afterEach(async () => {
  setRemote(null);
  setRepos(null);
  setDb(null);
  database.close();
  await Dexie.delete(database.name);
});

/** Usage hors-ligne typique : équipe, roster, match en cours, une action. */
async function seedOffline() {
  const store = repos();
  const team = await store.teams.ensureLocal();
  const players = await store.players.createMany(team.id, [
    { firstName: "Karim", lastName: "Bernard", number: 4 },
    { firstName: "Yanis", lastName: "Petit", number: 5 },
  ]);
  const match = await store.matches.create(team.id, {
    opponentName: "BC Nuit",
    date: "2026-10-06",
    status: "live",
  });
  const written = await store.actions.append(match.id, [
    {
      playerId: players[0]!.id,
      quarter: 1,
      kind: "shot",
      value: 2,
      made: true,
    },
  ]);

  return { team, players, match, actions: written.actions };
}

describe("rattachement au compte", () => {
  it("donne à l'équipe un identifiant uuid et un propriétaire", async () => {
    await seedOffline();

    const result = await claimTeam(USER);

    expect(result.status).toBe("claimed");
    if (result.status !== "claimed") throw new Error("claim attendu");
    expect(isUuid(result.team.id)).toBe(true);
    expect(result.team.ownerId).toBe(USER);
    expect(result.attached).toBe(true);
  });

  it("n'efface pas l'équipe d'origine avant d'avoir écrit la nouvelle", async () => {
    // `LOCAL_TEAM_ID` n'est pas un uuid : le laisser en base ferait échouer le
    // moindre tirage et le moindre upsert sur `teams`.
    await seedOffline();
    await claimTeam(USER);

    const remaining = await database.teams.toArray();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).not.toBe(LOCAL_TEAM_ID);
  });

  it("réécrit teamId des joueurs et des matchs", async () => {
    const { players, match } = await seedOffline();

    const result = await claimTeam(USER);
    if (result.status !== "claimed") throw new Error("claim attendu");

    for (const player of players) {
      expect((await repos().players.get(player.id))?.teamId).toBe(
        result.team.id,
      );
    }
    expect((await repos().matches.get(match.id))?.teamId).toBe(result.team.id);
    // Le contenu n'est pas touché : c'est une réécriture de clé, pas une copie.
    expect((await repos().matches.get(match.id))?.opponentName).toBe("BC Nuit");
    expect((await repos().players.get(players[0]!.id))?.firstName).toBe(
      "Karim",
    );
  });

  it("remet en file les lignes déplacées, avec leur nouveau teamId", async () => {
    const { players, match } = await seedOffline();

    const result = await claimTeam(USER);
    if (result.status !== "claimed") throw new Error("claim attendu");

    const player = await entryFor(database, "players", players[0]!.id);
    expect((player?.payload as { teamId: string }).teamId).toBe(result.team.id);

    const stored = await entryFor(database, "matches", match.id);
    expect((stored?.payload as { teamId: string }).teamId).toBe(result.team.id);

    // L'entrée de l'équipe d'origine ne doit plus exister : la laisser en file
    // enverrait un `id` non-uuid, refusé par Postgres à chaque cycle — et
    // l'échec bloquerait toutes les autres entités du lot.
    expect(await entryFor(database, "teams", LOCAL_TEAM_ID)).toBeUndefined();
    expect(await entryFor(database, "teams", result.team.id)).toBeDefined();
  });

  it("conserve une action déjà en file, dont teamId n'existe pas", async () => {
    // Les actions ne portent pas `teamId` : leur propriétaire vient du match.
    // Les laisser intactes est donc correct — et obligatoire, sinon le relecteur
    // du cloud ne retrouverait pas le match.
    const { actions } = await seedOffline();
    const before = await entryFor(database, "actions", actions[0]!.id);

    await claimTeam(USER);

    const after = await entryFor(database, "actions", actions[0]!.id);
    expect(after?.payload).toEqual(before?.payload);
    expect(after?.id).toBe(before?.id);
  });

  it("crée l'équipe si l'app n'a jamais serviie de données", async () => {
    const result = await claimTeam(USER);

    expect(result.status).toBe("claimed");
    if (result.status !== "claimed") throw new Error("claim attendu");
    expect(result.team.ownerId).toBe(USER);
    expect(isUuid(result.team.id)).toBe(true);
    expect(result.moved).toBe(0);
  });

  it("est idempotent : dix appels, une seule équipe", async () => {
    const { match } = await seedOffline();

    await claimTeam(USER);
    const first = await database.teams.toArray();
    const playerBefore = await database.players.toArray();

    for (let i = 0; i < 9; i += 1) await claimTeam(USER);

    const teams = await database.teams.toArray();
    expect(teams).toHaveLength(1);
    expect(teams[0]?.id).toBe(first[0]?.id);
    // `updatedAt` inchangé : le rattacher à nouveau ferait remonter la ligne en
    // tête du tirage descendant et clignoterait le voyant pour rien.
    expect(teams[0]?.updatedAt).toBe(first[0]?.updatedAt);
    expect(
      (await database.players.toArray()).map((row) => row.updatedAt),
    ).toEqual(playerBefore.map((row) => row.updatedAt));
    expect((await repos().matches.get(match.id))?.teamId).toBe(first[0]?.id);
  });

  it("refuse un second compte plutôt que de lui céder les données", async () => {
    const first = await claimTeam(USER);
    expect(first.status).toBe("claimed");

    const second = await claimTeam(OTHER_USER);

    // Refus, et rien n'est réécrit : céder l'équipe donnerait au second compte
    // les matchs du premier, et les RLS retireraient au premier l'accès à ses
    // propres données. Les deux pertes sont irréversibles.
    expect(second).toEqual({ status: "conflict", ownerId: USER });

    const teams = await database.teams.toArray();
    expect(teams).toHaveLength(1);
    expect(teams[0]?.ownerId).toBe(USER);
    expect(teams[0]?.id).toBe(
      first.status === "claimed" ? first.team.id : null,
    );
  });

  it("adopte un identifiant d'équipe existant mais sans propriétaire", async () => {
    // Cas atteint si une base a été migrée avant la phase 6 : l'équipe a un `id`
    // mais n'est rattachée à personne. Elle doit être adoptée telle quelle, pas
    // ré-identifiée — sinon tous les matchs du coach changeraient de clé.
    await seedOffline();
    const [row] = await database.teams.toArray();
    await database.teams.put({
      ...row!,
      id: "3d0f0d1e-1111-4111-8111-111111111111",
    });

    const result = await claimTeam(USER);
    if (result.status !== "claimed") throw new Error("claim attendu");

    expect(result.team.id).toBe("3d0f0d1e-1111-4111-8111-111111111111");
    expect(result.moved).toBe(0);
  });

  it("concurrent : deux rattachements en parallèle laissent une équipe", async () => {
    await seedOffline();

    await Promise.all([claimTeam(USER), claimTeam(USER)]);

    expect(await database.teams.toArray()).toHaveLength(1);
    const [player] = await repos().players.listByTeam(
      (await database.teams.toArray())[0]!.id,
    );
    expect(player).toBeDefined();
  });
});

describe("non-régression : hors-ligne puis connexion", () => {
  it("retrouve au cloud tout ce qui a été saisi sans compte", async () => {
    const { players, match, actions } = await seedOffline();
    const pendingBefore = await pendingCount(database);
    expect(pendingBefore).toBe(5); // équipe + 2 joueurs + match + 1 action

    await claimTeam(USER);
    await pushPending(remote.client);

    // Tout est parti, et rien n'est resté en file.
    expect(await pendingCount(database)).toBe(0);

    const cloudPlayers = remote.tables.get("players") ?? [];
    expect(cloudPlayers).toHaveLength(2);
    expect(cloudPlayers.every((row) => isUuid(String(row.id)))).toBe(true);
    const teamId = String(remote.tables.get("teams")?.[0]?.id);
    expect(cloudPlayers.every((row) => row.team_id === teamId)).toBe(true);

    const cloudMatches = remote.tables.get("matches") ?? [];
    expect(cloudMatches).toHaveLength(1);
    // Comparés en ensembles triés : le roster du match vient d'une lecture
    // Dexie, dont l'ordre n'est pas celui de la création. Ce qui compte est que
    // les deux joueurs y soient, pas leur rang.
    expect(
      [...((cloudMatches[0]?.player_ids ?? []) as string[])].sort(),
    ).toEqual(players.map((p) => p.id).sort());

    const cloudActions = remote.tables.get("actions") ?? [];
    expect(cloudActions).toHaveLength(1);
    expect(cloudActions[0]?.id).toBe(actions[0]!.id);
    expect(cloudActions[0]?.match_id).toBe(match.id);

    // Aucune clé étrangère non résolue : c'est ce que Postgres refuserait, et ce
    // que le test doit attraper avant le déploiement.
    expect(isUuid(String(cloudActions[0]?.match_id))).toBe(true);
    expect(isUuid(String(cloudActions[0]?.player_id))).toBe(true);
  });

  it("reste cohérent quand le cloud renvoie ses propres lignes", async () => {
    await seedOffline();
    await claimTeam(USER);
    await pushPending(remote.client);

    // Un second appareil répondrait avec les mêmes lignes : le dédupe par `id`
    // doit les reconnaître, pas les dupliquer.
    const { pullChanges } = await import("@/sync/engine");
    const applied = await pullChanges(remote.client);

    expect(applied).toBe(0);
    expect(await database.players.count()).toBe(2);
    expect(await database.matches.count()).toBe(1);
    expect(await database.actions.count()).toBe(1);
  });
});
