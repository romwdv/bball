import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDb, setRepos, SpaceBunnyDB } from "@/data";
import { createRepositories, type Repositories } from "@/data/repositories";
import { playerLabel, playerShortName, playerInitial } from "@/domain/stats";
import { PlayerSchema } from "@/domain/types";

/**
 * Tests de la création rapide d'un joueur.
 *
 * Régression directe : « Dupont » tapé dans le champ de nom était rejeté par le
 * schéma, l'erreur n'était pas affichée, et le coach croyait que le bouton ne
 * marchait pas. Ces tests verrouillent les deux causes.
 */

let database: SpaceBunnyDB;
let repos: Repositories;

beforeEach(async () => {
  database = new SpaceBunnyDB(`space-bunny-roster-${Math.random()}`);
  await database.open();
  setDb(database);
  repos = createRepositories(database);
  setRepos(repos);
  await repos.teams.ensureLocal();
});

afterEach(async () => {
  setRepos(null);
  setDb(null);
  database.close();
  await Dexie.delete(database.name);
});

describe("nom seul, sans prénom", () => {
  it("PlayerSchema accepte un prénom vide si le nom est présent", () => {
    const result = PlayerSchema.safeParse({
      id: "p1",
      teamId: "local",
      firstName: "",
      lastName: "Dupont",
      number: 12,
    });
    expect(result.success).toBe(true);
  });

  it("PlayerSchema accepte un nom de famille vide si le prénom est présent", () => {
    // Cas du joueur unique suivi (PLAN.md §11) : l'identité tient dans le
    // prénom, « Andreas » seul. Exiger un nom de famille n'aurait signifié
    // qu'une donnée inventée.
    const result = PlayerSchema.safeParse({
      id: "p1",
      teamId: "local",
      firstName: "Andreas",
      lastName: "",
      number: null,
    });
    expect(result.success).toBe(true);
  });

  it("PlayerSchema refuse un joueur sans prénom ni nom", () => {
    // Rendre les deux moitiés optionnelles ne veut pas dire « tout est permis » :
    // un joueur totalement anonyme n'aurait pas d'identité à afficher.
    const result = PlayerSchema.safeParse({
      id: "p1",
      teamId: "local",
      firstName: "  ",
      lastName: "  ",
      number: null,
    });
    expect(result.success).toBe(false);
  });

  it("playerLabel n'ajoute pas d'espace parasite quand le prénom manque", () => {
    const player = {
      id: "p1",
      teamId: "local",
      firstName: "",
      lastName: "Dupont",
      number: 12,
    };
    // « Dupont », pas «  Dupont » : le second s'afficherait avec une espace
    // devant dans le carrousel.
    expect(playerLabel(player)).toBe("Dupont");
  });

  it("playerShortName retombe sur le nom de famille", () => {
    const player = {
      id: "p1",
      teamId: "local",
      firstName: "",
      lastName: "Dupont",
      number: 12,
    };
    expect(playerShortName(player)).toBe("Dupont");
  });

  it("playerInitial prend la lettre du nom quand le prénom manque", () => {
    const player = {
      id: "p1",
      teamId: "local",
      firstName: "",
      lastName: "dupont",
      number: 12,
    };
    expect(playerInitial(player)).toBe("D");
  });

  it("playerLabel et playerShortName gèrent les deux formes", () => {
    const withFirst = {
      id: "p1",
      teamId: "local",
      firstName: "Alan",
      lastName: "Turing",
      number: 5,
    };
    expect(playerLabel(withFirst)).toBe("Alan Turing");
    expect(playerShortName(withFirst)).toBe("Alan");
  });

  it("playerLabel n'ajoute pas d'espace parasite quand le nom manque", () => {
    // Le joueur suivi n'a qu'un prénom (PLAN.md §11). « Andreas », pas
    // « Andreas » : l'espace en fin de chaîne se verrait dans le bandeau de
    // saisie, collée au nom de famille vide.
    const player = {
      id: "p1",
      teamId: "local",
      firstName: "Andreas",
      lastName: "",
      number: null,
    };
    expect(playerLabel(player)).toBe("Andreas");
  });

  it("playerShortName renvoie le prénom quand le nom manque", () => {
    const player = {
      id: "p1",
      teamId: "local",
      firstName: "Andreas",
      lastName: "",
      number: null,
    };
    expect(playerShortName(player)).toBe("Andreas");
  });

  it("playerInitial prend la lettre du prénom", () => {
    const player = {
      id: "p1",
      teamId: "local",
      firstName: "andreas",
      lastName: "",
      number: null,
    };
    expect(playerInitial(player)).toBe("A");
  });
});

describe("classement du roster", () => {
  it("range le joueur sans prénom à côté des autres, pas à la fin", async () => {
    await repos.players.createMany("local", [
      { firstName: "Ada", lastName: "Lovelace", number: 4 },
      { firstName: "", lastName: "Dupont", number: 7 },
      { firstName: "Alan", lastName: "Turing", number: 12 },
    ]);

    const roster = await repos.players.listByTeam("local");
    // Un numéro existe : le joueur doit se ranger dessus, le prénom manquant
    // n'a aucune raison de le pousser en fin de liste.
    expect(roster.map((player) => player.number)).toEqual([4, 7, 12]);
  });

  it("retrouve le joueur sans prénom par son numéro", async () => {
    await repos.players.create("local", {
      firstName: "",
      lastName: "Dupont",
      number: 7,
    });
    expect((await repos.players.findByNumber("local", 7))?.lastName).toBe(
      "Dupont",
    );
  });
});
