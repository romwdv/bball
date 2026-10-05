import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dataDb, repos as sharedRepos, setRepos } from "@/data";
import { createRepositories, type Repositories } from "@/data/repositories";
import { setDb, SpaceBunnyDB, SYNC_KEY } from "@/data/schema";

let counter = 0;
function uniqueName(): string {
  counter += 1;
  return `space-bunny-index-${counter}`;
}

let database: SpaceBunnyDB;

beforeEach(async () => {
  database = new SpaceBunnyDB(uniqueName());
  await database.open();
  setDb(database);
  setRepos(createRepositories(database));
});

afterEach(async () => {
  setRepos(null);
  setDb(null);
  database.close();
  await Dexie.delete(database.name);
});

describe("accès paresseux", () => {
  it("renvoie la même base à chaque appel", () => {
    expect(dataDb()).toBe(database);
    expect(dataDb()).toBe(dataDb());
  });

  it("renvoie les mêmes repositories à chaque appel", () => {
    const first: Repositories = sharedRepos();
    expect(sharedRepos()).toBe(first);
    expect(first.actions).toBe(sharedRepos().actions);
  });

  it("fabrique des repositories utilisables sur la base courante", async () => {
    const repos = sharedRepos();
    const team = await repos.teams.ensureLocal();
    expect((await dataDb().teams.get(team.id))?.id).toBe(team.id);
  });

  it("n'ouvre la base paresseuse qu'au premier appel", async () => {
    // Le build `output: 'export'` prerend les pages dans un environnement Node
    // sans `indexedDB`. Ouvrir la base à l'import du module ferait échouer le
    // build ; `db()` est donc paresseux.
    setRepos(null);
    setDb(null);

    const created = dataDb();
    expect(created).toBeInstanceOf(SpaceBunnyDB);
    await created.open();
    // Une seule instance, même après un accès intermédiaire.
    expect(dataDb()).toBe(created);
    expect(sharedRepos()).not.toBeNull();

    created.close();
  });
});

describe("curseur de synchronisation", () => {
  it("démarre à 0 sur une base neuve", async () => {
    const row = await dataDb().syncState.get(SYNC_KEY);
    // Aucune ligne tant que la synchronisation n'a pas tourné : `0` est la
    // convention « jamais synchronisé », pas une valeur à écrire par avance.
    expect(row).toBeUndefined();
  });

  it("conserve le curseur entre deux lectures", async () => {
    await dataDb().syncState.put({
      key: SYNC_KEY,
      lastPulledAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });

    const row = await dataDb().syncState.get(SYNC_KEY);
    expect(row?.lastPulledAt).toBe(1_700_000_000_000);
  });

  it("permet d'effacer toutes les données locales", async () => {
    const repos = sharedRepos();
    await repos.teams.ensureLocal();
    await dataDb().teams.clear();
    await dataDb().outbox.clear();

    expect(await dataDb().teams.count()).toBe(0);
    expect(await dataDb().outbox.count()).toBe(0);
    // L'équipe est recréable à la demande : le lancement suivant la recrée.
    expect((await repos.teams.ensureLocal()).id).toBe("local");
  });
});
