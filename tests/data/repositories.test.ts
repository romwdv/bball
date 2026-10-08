import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createRepositories,
  LOCAL_TEAM_ID,
  quartersOf,
  SON,
  toAction,
  toMatch,
  toPlayer,
  toTeam,
  type Repositories,
} from "@/data/repositories";
import { outboxKey } from "@/data/outbox";
import { SpaceBunnyDB } from "@/data/schema";
import { combos } from "@/domain/rules";
import { aggregateFor, scoreForQuarters } from "@/domain/stats";
import { QUARTERS } from "@/domain/types";

let counter = 0;
function uniqueName(): string {
  counter += 1;
  return `space-bunny-repos-${counter}`;
}

let database: SpaceBunnyDB;
let repos: Repositories;

beforeEach(async () => {
  database = new SpaceBunnyDB(uniqueName());
  await database.open();
  repos = createRepositories(database);
});

afterEach(async () => {
  database.close();
  await Dexie.delete(database.name);
});

// ---------------------------------------------------------------------------

describe("TeamRepository", () => {
  it("crée une équipe locale unique", async () => {
    const team = await repos.teams.ensureLocal("Volley-Ball Club");
    expect(team.id).toBe(LOCAL_TEAM_ID);
    expect(team.name).toBe("Volley-Ball Club");
    expect(team.ownerId).toBeNull();
  });

  it("est idempotent : deux appels ne créent pas deux équipes", async () => {
    const first = await repos.teams.ensureLocal("A");
    const second = await repos.teams.ensureLocal("B");
    expect(second.id).toBe(first.id);
    // Le nom passé au second appel est ignoré : l'équipe existe déjà, la
    // renommer est une action explicite.
    expect(second.name).toBe("A");
    expect(await repos.teams.list()).toHaveLength(1);
  });

  it("supporte les appels concurrents au premier lancement", async () => {
    const local = new SpaceBunnyDB(uniqueName());
    await local.open();
    const fresh = createRepositories(local);
    await Promise.all([fresh.teams.ensureLocal(), fresh.teams.ensureLocal()]);
    expect(await local.teams.count()).toBe(1);
    local.close();
  });

  it("lit une équipe par son id", async () => {
    await repos.teams.ensureLocal();
    expect((await repos.teams.get(LOCAL_TEAM_ID))?.name).toBe("Mon équipe");
    expect(await repos.teams.get("inexistant")).toBeUndefined();
  });

  it("renomme une équipe", async () => {
    await repos.teams.ensureLocal();
    const team = await repos.teams.rename(LOCAL_TEAM_ID, "Nouveau nom");
    expect(team.name).toBe("Nouveau nom");
  });

  it("refuse un nom vide", async () => {
    await repos.teams.ensureLocal();
    await expect(repos.teams.rename(LOCAL_TEAM_ID, "   ")).rejects.toThrow(
      /invalide/i,
    );
  });

  it("refuse de modifier une équipe inexistante", async () => {
    await expect(repos.teams.rename("fantome", "X")).rejects.toThrow(
      /introuvable/i,
    );
  });

  it("rattache un compte cloud", async () => {
    await repos.teams.ensureLocal();
    const team = await repos.teams.attachOwner(LOCAL_TEAM_ID, "user-123");
    expect(team.ownerId).toBe("user-123");
  });

  it("expose le domaine sans la colonne de persistence", () => {
    expect(toTeam({ ...DEFAULT_TEAM, updatedAt: 5 })).toEqual(DEFAULT_TEAM);
  });
});

// ---------------------------------------------------------------------------

describe("PlayerRepository", () => {
  it("crée un joueur avec un id et un numéro", async () => {
    const player = await repos.players.create("local", {
      firstName: "Ada",
      lastName: "Lovelace",
      number: 4,
    });
    expect(player.id).not.toBe("");
    expect(player.teamId).toBe("local");
    expect(player.number).toBe(4);
  });

  it("accepte un joueur sans numéro", async () => {
    const player = await repos.players.create("local", {
      firstName: "Grace",
      lastName: "Hopper",
    });
    expect(player.number).toBeNull();
  });

  it("refuse un joueur totalement anonyme", async () => {
    await expect(
      repos.players.create("local", { firstName: "", lastName: "" }),
    ).rejects.toThrow(/invalide/i);
  });

  it("trim les espaces des noms", async () => {
    const player = await repos.players.create("local", {
      firstName: "  Ada ",
      lastName: " Lovelace ",
      number: 4,
    });
    expect(player.firstName).toBe("Ada");
    expect(player.lastName).toBe("Lovelace");
  });

  it("accepte un nom seul, sans prénom", async () => {
    // Cas le plus fréquent en bord de terrain : on connaît le nom de famille de
    // tout le monde, le prénom de personne. Le prénom vide est donc valide, et
    // `lastName` porte l'identité.
    const player = await repos.players.create("local", {
      firstName: "",
      lastName: "Dupont",
      number: 12,
    });
    expect(player).toMatchObject({ firstName: "", lastName: "Dupont" });
  });

  it("accepte un nom de famille vide quand le prénom est là", async () => {
    // Règle inversée en PLAN.md §11 : l'identité peut tenir dans le prénom seul.
    // L'ancien test affirmait le contraire — il encodait la décision de faire
    // porter le nom au joueur unique, il est donc légitimement remplacé ici.
    const player = await repos.players.create("local", {
      firstName: "Ada",
      lastName: "  ",
    });
    expect(player).toMatchObject({ firstName: "Ada", lastName: "" });
  });

  it("refuse un numéro hors bornes", async () => {
    await expect(
      repos.players.create("local", {
        firstName: "Ada",
        lastName: "Lovelace",
        number: 120,
      }),
    ).rejects.toThrow(/invalide/i);
  });

  it("lit un joueur par son id", async () => {
    const player = await repos.players.create("local", {
      firstName: "Ada",
      lastName: "Lovelace",
    });
    expect((await repos.players.get(player.id))?.id).toBe(player.id);
    expect(await repos.players.get("fantome")).toBeUndefined();
  });

  it("liste le roster trié par numéro, sans numéro en fin de liste", async () => {
    await repos.players.createMany("local", [
      { firstName: "Zoe", lastName: "Zzz", number: 12 },
      { firstName: "Bob", lastName: "Bbb", number: null },
      { firstName: "Ada", lastName: "Lovelace", number: 4 },
      { firstName: "Alan", lastName: "Aaa", number: 4 },
    ]);

    const roster = await repos.players.listByTeam("local");
    // 4 / 4 départagés par le nom de famille (« Aaa » avant « Lovelace »),
    // puis 12, puis le joueur sans numéro.
    expect(roster.map((p) => `${p.number ?? "-"} ${p.firstName}`)).toEqual([
      "4 Alan",
      "4 Ada",
      "12 Zoe",
      "- Bob",
    ]);
  });

  it("place un joueur sans numéro après tous les autres", async () => {
    // Trois joueurs et des numéros distincts : `Array.sort` peut appeler son
    // comparateur dans les deux sens, et la règle « sans numéro en fin de
    // liste » doit être correcte quel que soit le sens.
    await repos.players.createMany("local", [
      { firstName: "Bob", lastName: "Bbb", number: null },
      { firstName: "Ada", lastName: "Lovelace", number: 4 },
      { firstName: "Zoe", lastName: "Zzz", number: 12 },
    ]);

    const roster = await repos.players.listByTeam("local");
    expect(roster.map((p) => p.firstName)).toEqual(["Ada", "Zoe", "Bob"]);
  });

  it("n'affiche que les joueurs de l'équipe demandée", async () => {
    await repos.players.create("local", {
      firstName: "Ada",
      lastName: "Lovelace",
    });
    await repos.players.create("autre", { firstName: "Bob", lastName: "Bbb" });
    expect(await repos.players.listByTeam("local")).toHaveLength(1);
  });

  it("retrouve un joueur par son numéro", async () => {
    const player = await repos.players.create("local", {
      firstName: "Ada",
      lastName: "Lovelace",
      number: 4,
    });
    expect((await repos.players.findByNumber("local", 4))?.id).toBe(player.id);
    expect(await repos.players.findByNumber("local", 99)).toBeUndefined();
  });

  it("ne retrouve pas un numéro qui appartient à une autre équipe", async () => {
    await repos.players.create("local", {
      firstName: "Ada",
      lastName: "Lovelace",
      number: 4,
    });
    expect(await repos.players.findByNumber("autre", 4)).toBeUndefined();
  });

  it("modifie un joueur", async () => {
    const player = await repos.players.create("local", {
      firstName: "Ada",
      lastName: "Lovelace",
      number: 4,
    });
    const updated = await repos.players.update(player.id, {
      firstName: " Augusta ",
      number: 7,
    });
    expect(updated.firstName).toBe("Augusta");
    expect(updated.number).toBe(7);
    expect(updated.lastName).toBe("Lovelace");
  });

  it("modifie un joueur sans toucher aux champs non fournis", async () => {
    const player = await repos.players.create("local", {
      firstName: "Ada",
      lastName: "Lovelace",
      number: 4,
    });
    // Patch partiel : le nom existant doit être conservé tel quel, et revalidé
    // au passage.
    const updated = await repos.players.update(player.id, { number: 5 });
    expect(updated).toMatchObject({
      firstName: "Ada",
      lastName: "Lovelace",
      number: 5,
    });
  });

  it("refuse de modifier un joueur inexistant", async () => {
    await expect(
      repos.players.update("fantome", { number: 1 }),
    ).rejects.toThrow(/introuvable/i);
  });

  it("accepte une création multiple et renvoie les joueurs créés", async () => {
    const created = await repos.players.createMany("local", [
      { firstName: "Ada", lastName: "Lovelace", number: 4 },
      { firstName: "Alan", lastName: "Turing", number: 5 },
    ]);
    expect(created).toHaveLength(2);
    expect(await repos.players.listByTeam("local")).toHaveLength(2);
  });

  it("ne fait rien sur une création multiple vide", async () => {
    expect(await repos.players.createMany("local", [])).toEqual([]);
  });

  it("expose le domaine sans la colonne de persistence", async () => {
    const player = await repos.players.create("local", {
      firstName: "Ada",
      lastName: "Lovelace",
    });
    expect(toPlayer(player)).toEqual({
      id: player.id,
      teamId: "local",
      firstName: "Ada",
      lastName: "Lovelace",
      number: null,
    });
  });
});

// ---------------------------------------------------------------------------

/**
 * `ensureSon()` — le joueur unique (PLAN.md §11).
 *
 * Ces trois cas ne sont pas des variantes d'un même comportement : ce sont trois
 *ponses à trois états distincts d'une base, et le choix de la réponse est ce qui
 * évite de perdre des actions déjà saisies. Le cas « un joueur déjà présent »
 * est le plus important : c'est lui qui est exécuté à chaque ouverture, et c'est
 * lui qui ne doit rien écrire.
 */
describe("PlayerRepository — ensureSon", () => {
  it("crée le joueur au premier lancement", async () => {
    const player = await repos.players.ensureSon("local");

    expect(player.firstName).toBe(SON.firstName);
    expect(player.lastName).toBe(SON.lastName);
    expect(player.number).toBeNull();
    expect(await repos.players.listByTeam("local")).toHaveLength(1);
  });

  it("est idempotent : deux appels renvoient le même joueur", async () => {
    const first = await repos.players.ensureSon("local");
    const second = await repos.players.ensureSon("local");

    expect(second.id).toBe(first.id);
    expect(await repos.players.listByTeam("local")).toHaveLength(1);
  });

  it("adopte le joueur existant sans rien réécrire", async () => {
    // Un `updatedAt` sans raison ferait remonter la ligne en tête du tirage
    // descendant côté cloud, et l'indicateur de synchronisation clignoterait pour
    // rien. C'est le test qui verrouille l'absence d'écriture.
    const existing = await repos.players.create("local", {
      firstName: "Andreas",
      lastName: "",
    });
    const before = await repos.players.get(existing.id);

    const son = await repos.players.ensureSon("local");

    expect(son.id).toBe(existing.id);
    expect((await repos.players.get(existing.id))?.updatedAt).toBe(
      before?.updatedAt,
    );
  });

  it("préserve les actions d'un joueur adopté", async () => {
    // C'est la raison d'être de l'adoption : un joueur recréé sous un nouvel id
    // laisserait toutes les actions déjà saisies orphelines, et les statistiques
    // cumulées repartiraient de zéro.
    const existing = await repos.players.create("local", {
      firstName: "Andreas",
      lastName: "",
    });
    const match = await repos.matches.create("local", {
      opponentName: "BC Nuit",
      date: "2026-10-05",
      playerIds: [existing.id],
    });
    await repos.actions.append(match.id, [
      {
        kind: "shot",
        playerId: existing.id,
        quarter: 1,
        value: 3,
        made: true,
      },
    ]);

    const son = await repos.players.ensureSon("local");
    const actions = await repos.actions.listByMatch(match.id, {
      includeVoided: false,
    });

    expect(son.id).toBe(existing.id);
    expect(aggregateFor(actions, son.id).points).toBe(3);
  });

  it("écarte les joueurs parasites et garde celui qui porte l'identité", async () => {
    // Cas des données de test : plusieurs joueurs coexistent, un seul doit
    // rester, sinon la saisie aurait encore à choisir.
    await repos.players.create("local", {
      firstName: "Ada",
      lastName: "Lovelace",
    });
    await repos.players.create("local", { firstName: "Zoe", lastName: "Zzz" });
    const kept = await repos.players.create("local", {
      firstName: SON.firstName,
      lastName: SON.lastName,
    });

    const son = await repos.players.ensureSon("local");
    const roster = await repos.players.listByTeam("local");

    expect(son.id).toBe(kept.id);
    expect(roster.map((player) => player.id)).toEqual([kept.id]);
  });

  it("écarte aussi les joueurs d'une autre équipe", async () => {
    // Le prune est borné à l'équipe : `listByTeam` filtre, donc un joueur d'une
    // autre équipe ne doit jamais être supprimé par cette méthode.
    await repos.players.create("autre-equipe", {
      firstName: "Grace",
      lastName: "Hopper",
    });
    await repos.players.create("local", {
      firstName: "Ada",
      lastName: "Lovelace",
    });

    await repos.players.ensureSon("local");

    expect(await repos.players.listByTeam("autre-equipe")).toHaveLength(1);
  });

  it("conserve le joueur au prénom attendu même avec un numéro hérité", async () => {
    // Un joueur trouvé par les essais peut porter un numéro. Le strict `isSon`
    // échouerait, il faut donc un second critère — sans lui, `ensureSon` créerait
    // un nouveau joueur et les actions de l'ancien deviendraient orphelines.
    const legacy = await repos.players.create("local", {
      firstName: SON.firstName,
      lastName: "",
      number: 7,
    });
    await repos.players.create("local", { firstName: "Zoe", lastName: "Zzz" });

    const son = await repos.players.ensureSon("local");

    expect(son.id).toBe(legacy.id);
    expect(await repos.players.listByTeam("local")).toHaveLength(1);
  });

  it("remplace un roster d'essai par le joueur attendu quand aucun ne correspond", () => {
    // Aucun joueur ne porte l'identité : il n'y a donc aucune action à
    // préserver. Créer le joueur attendu et purger le reste est le seul résultat
    // qui laisse une base cohérente.
    return expect(
      repos.players
        .createMany("local", [
          { firstName: "Ada", lastName: "Lovelace" },
          { firstName: "Zoe", lastName: "Zzz" },
        ])
        .then(() => repos.players.ensureSon("local"))
        .then(async (son) => {
          expect(son.firstName).toBe(SON.firstName);
          expect(await repos.players.listByTeam("local")).toHaveLength(1);
        }),
    ).resolves.toBeUndefined();
  });

  it("met la suppression des parasites en file pour le cloud", async () => {
    // Sans entrée d'outbox `delete`, le joueur parasite reviendrait au tirage
    // suivant : un fantôme impossible à expliquer dans l'indicateur de sync.
    await repos.players.create("local", {
      firstName: "Ada",
      lastName: "Lovelace",
    });
    const parasite = await repos.players.create("local", {
      firstName: "Zoe",
      lastName: "Zzz",
    });

    await repos.players.ensureSon("local");

    const entry = await database.outbox.get(outboxKey("players", parasite.id));
    expect(entry?.operation).toBe("delete");
  });
});

// ---------------------------------------------------------------------------

describe("MatchRepository", () => {
  it("crée un match en brouillon par défaut", async () => {
    const match = await repos.matches.create("local", {
      opponentName: "BC Nuit",
      date: "2026-10-05",
    });
    expect(match.status).toBe("draft");
    expect(match.finishedAt).toBeNull();
    expect(match.teamId).toBe("local");
  });

  it("trim le nom de l'adversaire", async () => {
    const match = await repos.matches.create("local", {
      opponentName: "  BC Nuit  ",
      date: "2026-10-05",
    });
    expect(match.opponentName).toBe("BC Nuit");
  });

  it("refuse un adversaire vide", async () => {
    await expect(
      repos.matches.create("local", { opponentName: " ", date: "2026-10-05" }),
    ).rejects.toThrow(/invalide/i);
  });

  it("refuse une date mal formatée", async () => {
    await expect(
      repos.matches.create("local", { opponentName: "BC", date: "05/10/2026" }),
    ).rejects.toThrow(/invalide/i);
  });

  it("refuse un statut inconnu", async () => {
    await expect(
      repos.matches.create("local", {
        opponentName: "BC",
        date: "2026-10-05",
        status: "abandonned" as never,
      }),
    ).rejects.toThrow(/invalide/i);
  });

  it("lit un match par son id", async () => {
    const match = await repos.matches.create("local", {
      opponentName: "BC Nuit",
      date: "2026-10-05",
    });
    expect((await repos.matches.get(match.id))?.id).toBe(match.id);
    expect(await repos.matches.get("fantome")).toBeUndefined();
  });

  it("liste par date décroissante", async () => {
    await repos.matches.create("local", {
      opponentName: "A",
      date: "2026-10-01",
    });
    await repos.matches.create("local", {
      opponentName: "C",
      date: "2026-10-05",
    });
    await repos.matches.create("local", {
      opponentName: "B",
      date: "2026-10-03",
    });

    const matches = await repos.matches.listByTeam("local");
    expect(matches.map((m) => m.opponentName)).toEqual(["C", "B", "A"]);
  });

  it("départage deux matchs de même date par ordre de création", async () => {
    const first = await repos.matches.create("local", {
      opponentName: "Premier",
      date: "2026-10-05",
    });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await repos.matches.create("local", {
      opponentName: "Second",
      date: "2026-10-05",
    });

    const matches = await repos.matches.listByTeam("local");
    expect(matches.map((m) => m.opponentName)).toEqual(["Second", "Premier"]);
    expect(matches[1]?.id).toBe(first.id);
  });

  it("n'affiche que les matchs de l'équipe demandée", async () => {
    await repos.matches.create("local", {
      opponentName: "A",
      date: "2026-10-05",
    });
    await repos.matches.create("autre", {
      opponentName: "B",
      date: "2026-10-05",
    });
    expect(await repos.matches.listByTeam("local")).toHaveLength(1);
  });

  it("exclut les matchs terminés de listUnfinished", async () => {
    const live = await repos.matches.create("local", {
      opponentName: "En cours",
      date: "2026-10-05",
    });
    const draft = await repos.matches.create("local", {
      opponentName: "Brouillon",
      date: "2026-10-04",
    });
    const finished = await repos.matches.create("local", {
      opponentName: "Terminé",
      date: "2026-10-03",
    });
    await repos.matches.setStatus(finished.id, "finished");

    const unfinished = await repos.matches.listUnfinished("local");
    expect(unfinished.map((m) => m.opponentName)).toEqual([
      "En cours",
      "Brouillon",
    ]);
    expect(unfinished.map((m) => m.id)).toContain(draft.id);
    expect(unfinished.map((m) => m.id)).not.toContain(
      live.id === "" ? "" : finished.id,
    );
  });

  it("renvoie le match en cours le plus récent", async () => {
    await repos.matches.create("local", {
      opponentName: "Ancien",
      date: "2026-09-01",
    });
    await repos.matches.create("local", {
      opponentName: "Recent",
      date: "2026-10-05",
    });
    const finished = await repos.matches.create("local", {
      opponentName: "Terminé",
      date: "2026-10-06",
    });
    await repos.matches.setStatus(finished.id, "finished");

    expect((await repos.matches.latestUnfinished("local"))?.opponentName).toBe(
      "Recent",
    );
  });

  it("renvoie undefined s'il n'y a aucun match en cours", async () => {
    const finished = await repos.matches.create("local", {
      opponentName: "Terminé",
      date: "2026-10-05",
    });
    await repos.matches.setStatus(finished.id, "finished");
    expect(await repos.matches.latestUnfinished("local")).toBeUndefined();
  });

  it("pose finishedAt à la clôture", async () => {
    const match = await repos.matches.create("local", {
      opponentName: "BC",
      date: "2026-10-05",
    });
    const closed = await repos.matches.setStatus(match.id, "finished");
    expect(closed.status).toBe("finished");
    expect(typeof closed.finishedAt).toBe("number");
  });

  it("ne repose pas finishedAt lors d'une réouverture", async () => {
    const match = await repos.matches.create("local", {
      opponentName: "BC",
      date: "2026-10-05",
    });
    await repos.matches.setStatus(match.id, "finished");
    const reopened = await repos.matches.setStatus(match.id, "live");
    // Le statut et la date de fin ne doivent jamais se contredire.
    expect(reopened.status).toBe("live");
    expect(reopened.finishedAt).toBeNull();
  });

  it("conserve finishedAt si la clôture est rejouée", async () => {
    const match = await repos.matches.create("local", {
      opponentName: "BC",
      date: "2026-10-05",
    });
    const first = await repos.matches.setStatus(match.id, "finished");
    await new Promise((resolve) => setTimeout(resolve, 2));
    const again = await repos.matches.setStatus(match.id, "finished");
    expect(again.finishedAt).toBe(first.finishedAt);
  });

  it("modifie adversaire et date", async () => {
    const match = await repos.matches.create("local", {
      opponentName: "BC",
      date: "2026-10-05",
    });
    const updated = await repos.matches.update(match.id, {
      opponentName: "  BC Revised  ",
      date: "2026-10-06",
    });
    expect(updated.opponentName).toBe("BC Revised");
    expect(updated.date).toBe("2026-10-06");
  });

  it("modifie le statut via update", async () => {
    const match = await repos.matches.create("local", {
      opponentName: "BC",
      date: "2026-10-05",
    });
    const updated = await repos.matches.update(match.id, { status: "live" });
    expect(updated.status).toBe("live");
  });

  it("laisse les champs non fournis inchangés", async () => {
    const match = await repos.matches.create("local", {
      opponentName: "BC",
      date: "2026-10-05",
    });
    await repos.matches.setStatus(match.id, "live");
    const updated = await repos.matches.update(match.id, {
      date: "2026-10-06",
    });
    expect(updated.opponentName).toBe("BC");
    expect(updated.status).toBe("live");
  });

  it("refuse de modifier un match inexistant", async () => {
    await expect(
      repos.matches.update("fantome", { date: "2026-10-06" }),
    ).rejects.toThrow(/introuvable/i);
  });

  it("expose le domaine sans la colonne de persistence", async () => {
    const match = await repos.matches.create("local", {
      opponentName: "BC",
      date: "2026-10-05",
    });
    const { updatedAt: _ignored, ...expected } = match;
    expect(toMatch(match)).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------

describe("ActionRepository — écriture", () => {
  async function newMatch(): Promise<string> {
    const match = await repos.matches.create("local", {
      opponentName: "BC Nuit",
      date: "2026-10-05",
    });
    return match.id;
  }

  it("écrit une action avec ses colonnes de persistence", async () => {
    const matchId = await newMatch();
    const { actions } = await repos.actions.append(
      matchId,
      combos.twoMade("p1", 1, "g1"),
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      matchId,
      playerId: "p1",
      quarter: 1,
      kind: "shot",
      value: 2,
      made: true,
      groupId: "g1",
      seq: 0,
      voidedAt: null,
    });
    expect(typeof actions[0]?.updatedAt).toBe("number");
  });

  it("démarre la numérotation à 0 et expose le premier seq écrit", async () => {
    const matchId = await newMatch();
    const { fromSeq } = await repos.actions.append(
      matchId,
      combos.twoMade("p1", 1, "g1"),
    );
    expect(fromSeq).toBe(0);
  });

  it("numérote un combo en seq contigus", async () => {
    const matchId = await newMatch();
    const { actions, fromSeq } = await repos.actions.append(matchId, [
      {
        kind: "shot",
        playerId: "p1",
        quarter: 1,
        value: 2,
        made: false,
        fouled: true,
      },
      { kind: "free_throw", playerId: "p1", quarter: 1, made: true },
      { kind: "free_throw", playerId: "p1", quarter: 1, made: false },
    ]);

    expect(actions.map((a) => a.seq)).toEqual([
      fromSeq,
      fromSeq + 1,
      fromSeq + 2,
    ]);
  });

  it("donne un id distinct à chaque action, même dans un même lot", async () => {
    const matchId = await newMatch();
    const { actions } = await repos.actions.append(matchId, [
      { kind: "shot", playerId: "p1", quarter: 1, value: 3, made: true },
      { kind: "free_throw", playerId: "p1", quarter: 1, made: true },
    ]);
    expect(new Set(actions.map((a) => a.id)).size).toBe(2);
  });

  it("refuse un lot vide", async () => {
    const matchId = await newMatch();
    await expect(repos.actions.append(matchId, [])).rejects.toThrow(
      /au moins une/i,
    );
  });

  it("reprend le groupId du draft s'il est fourni", async () => {
    const matchId = await newMatch();
    const { groupId } = await repos.actions.append(
      matchId,
      combos.twoMade("p1", 1, "g-fourni"),
    );
    expect(groupId).toBe("g-fourni");
  });

  it("crée un groupe quand le draft n'en porte pas", async () => {
    const matchId = await newMatch();
    const { actions, groupId } = await repos.actions.append(matchId, [
      { kind: "shot", playerId: "p1", quarter: 1, value: 2, made: true },
      { kind: "free_throw", playerId: "p1", quarter: 1, made: true },
    ]);
    expect(groupId).not.toBe("");
    // Toutes les actions d'un lot partagent le groupe, sinon l'annulation
    // groupée n'aurait aucun sens.
    expect(actions.every((a) => a.groupId === groupId)).toBe(true);
  });

  it("respecte un groupId passé en option", async () => {
    const matchId = await newMatch();
    const { actions, groupId } = await repos.actions.append(
      matchId,
      [{ kind: "assist", playerId: "p1", quarter: 2 }],
      { groupId: "g-option" },
    );
    expect(groupId).toBe("g-option");
    expect(actions[0]?.groupId).toBe("g-option");
  });

  it("écrit réellement les actions en base", async () => {
    const matchId = await newMatch();
    await repos.actions.append(matchId, combos.twoMade("p1", 1, "g1"));

    const stored = await repos.actions.listByMatch(matchId);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe(
      (
        await repos.actions.get(
          (await repos.actions.listByMatch(matchId))[0]!.id,
        )
      )?.id,
    );
  });
});

describe("ActionRepository — nextSeq", () => {
  async function newMatch(): Promise<string> {
    const match = await repos.matches.create("local", {
      opponentName: "BC Nuit",
      date: "2026-10-05",
    });
    return match.id;
  }

  it("renvoie 0 sur un match vide", async () => {
    expect(await repos.actions.nextSeq(await newMatch())).toBe(0);
  });

  it("renvoie le nombre d'actions déjà écrites", async () => {
    const matchId = await newMatch();
    await repos.actions.append(matchId, combos.twoMade("p1", 1, "g1"));
    await repos.actions.append(matchId, combos.twoMade("p1", 1, "g2"));
    expect(await repos.actions.nextSeq(matchId)).toBe(2);
  });

  it("compte aussi les actions annulées", async () => {
    const matchId = await newMatch();
    const { actions } = await repos.actions.append(
      matchId,
      combos.twoMade("p1", 1, "g1"),
    );
    await repos.actions.voidAction(actions[0]!.id);

    // Un `seq` annulé reste consommé : le réattribuer ferait bouger une action
    // dans le fil du match et casserait l'ordre d'affichage du toast d'undo.
    expect(await repos.actions.nextSeq(matchId)).toBe(1);
  });

  it("numérote indépendamment deux matchs", async () => {
    const a = await newMatch();
    const b = await newMatch();
    await repos.actions.append(a, combos.twoMade("p1", 1, "g1"));
    await repos.actions.append(a, combos.twoMade("p1", 1, "g2"));
    expect(await repos.actions.nextSeq(a)).toBe(2);
    expect(await repos.actions.nextSeq(b)).toBe(0);
  });

  it("ne produit aucun doublon sous écriture concurrente", async () => {
    const match = await repos.matches.create("local", {
      opponentName: "BC Nuit",
      date: "2026-10-05",
    });

    // Dix écritures lancées sans await : c'est ce que fait un double rendu
    // React ou un tap très rapide. Dexie sérialise les transactions qui se
    // recouvrent, la lecture-modification-écriture reste atomique.
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        repos.actions.append(match.id, combos.assist("p1", 1, `g${i}`)),
      ),
    );

    const seqs = (await repos.actions.listByMatch(match.id)).map((a) => a.seq);
    expect(seqs).toHaveLength(10);
    expect([...seqs].sort((x, y) => x - y)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(await repos.actions.nextSeq(match.id)).toBe(10);
  });
});

describe("ActionRepository — lecture", () => {
  async function matchWithActions(): Promise<string> {
    const match = await repos.matches.create("local", {
      opponentName: "BC Nuit",
      date: "2026-10-05",
    });
    await repos.actions.append(match.id, [
      ...combos.twoMade("p1", 1, "g1"),
      ...combos.assist("p2", 1, "g2"),
      ...combos.threeMade("p1", 2, "g3"),
    ]);
    return match.id;
  }

  it("renvoie les actions triées par seq", async () => {
    const matchId = await matchWithActions();
    const actions = await repos.actions.listByMatch(matchId);
    expect(actions.map((a) => a.seq)).toEqual([0, 1, 2]);
  });

  it("n'affiche pas les actions d'un autre match", async () => {
    await matchWithActions();
    expect(await repos.actions.listByMatch("autre-match")).toHaveLength(0);
  });

  it("exclut les actions annulées sur demande", async () => {
    const matchId = await matchWithActions();
    const all = await repos.actions.listByMatch(matchId);
    await repos.actions.voidAction(all[1]!.id, 500);

    expect(await repos.actions.listByMatch(matchId)).toHaveLength(3);
    expect(
      await repos.actions.listByMatch(matchId, { includeVoided: false }),
    ).toHaveLength(2);
  });

  it("compte les actions actives", async () => {
    const matchId = await matchWithActions();
    expect(await repos.actions.countByMatch(matchId)).toBe(3);

    const all = await repos.actions.listByMatch(matchId);
    await repos.actions.voidAction(all[0]!.id, 500);
    expect(await repos.actions.countByMatch(matchId)).toBe(3);
    expect(
      await repos.actions.countByMatch(matchId, { activeOnly: true }),
    ).toBe(2);
  });

  it("lit une action par son id", async () => {
    const matchId = await matchWithActions();
    const [action] = await repos.actions.listByMatch(matchId);
    expect((await repos.actions.get(action!.id))?.id).toBe(action!.id);
    expect(await repos.actions.get("fantome")).toBeUndefined();
  });

  it("expose le domaine sans la colonne de persistence", async () => {
    const matchId = await matchWithActions();
    const [action] = await repos.actions.listByMatch(matchId);
    const { updatedAt: _ignored, ...expected } = action!;
    expect(toAction(action!)).toEqual(expected);
    expect(toAction(action!)).not.toHaveProperty("updatedAt");
  });

  it("déduit les périodes d'un lot", async () => {
    const matchId = await newMatchWithMixedQuarters();
    const actions = await repos.actions.listByMatch(matchId);
    expect(quartersOf(actions)).toEqual([1, 2]);
  });

  async function newMatchWithMixedQuarters(): Promise<string> {
    const match = await repos.matches.create("local", {
      opponentName: "BC Nuit",
      date: "2026-10-05",
    });
    await repos.actions.append(match.id, [
      { kind: "shot", playerId: "p1", quarter: 1, value: 2, made: true },
      { kind: "assist", playerId: "p2", quarter: 2 },
    ]);
    return match.id;
  }
});

describe("ActionRepository — annulation", () => {
  async function newMatch(): Promise<string> {
    const match = await repos.matches.create("local", {
      opponentName: "BC Nuit",
      date: "2026-10-05",
    });
    return match.id;
  }

  it("annule une action par soft-delete", async () => {
    const matchId = await newMatch();
    const { actions } = await repos.actions.append(
      matchId,
      combos.twoMade("p1", 1, "g1"),
    );
    const id = actions[0]!.id;

    const voided = await repos.actions.voidAction(id, 1234);

    expect(voided?.voidedAt).toBe(1234);
    // La ligne existe toujours : l'historique montre ce qui a été défait.
    expect((await repos.actions.get(id))?.voidedAt).toBe(1234);
  });

  it("retire l'action des statistiques", async () => {
    const matchId = await newMatch();
    const { actions } = await repos.actions.append(
      matchId,
      combos.twoMade("p1", 1, "g1"),
    );
    const all = await repos.actions.listByMatch(matchId);

    expect(scoreForQuarters(all, QUARTERS)).toBe(2);
    expect(aggregateFor(all, "p1").points).toBe(2);

    const stored = await repos.actions.voidAction(actions[0]!.id, 1);

    // Relecture depuis la base : c'est ce que fera l'écran de saisie, qui ne
    // connaît pas l'objet renvoyé par l'écriture.
    const after = await repos.actions.listByMatch(matchId);
    expect(stored?.voidedAt).toBe(1);
    expect(scoreForQuarters(after, QUARTERS)).toBe(0);
    expect(aggregateFor(after, "p1").points).toBe(0);
  });

  it("ne touche pas à une action déjà annulée", async () => {
    const matchId = await newMatch();
    const { actions } = await repos.actions.append(
      matchId,
      combos.twoMade("p1", 1, "g1"),
    );
    await repos.actions.voidAction(actions[0]!.id, 1000);
    const again = await repos.actions.voidAction(actions[0]!.id, 2000);

    // Réécrire `voidedAt` déplacerait la trace de la première annulation, qui
    // est exactement ce que le fil du match doit montrer.
    expect(again?.voidedAt).toBe(1000);
  });

  it("renvoie undefined pour une action inexistante", async () => {
    expect(await repos.actions.voidAction("fantome")).toBeUndefined();
  });

  it("annule un combo entier", async () => {
    const matchId = await newMatch();
    const { groupId } = await repos.actions.append(matchId, [
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

    const voided = await repos.actions.voidGroup(groupId, 900);

    expect(voided).toHaveLength(3);
    expect(voided.every((a) => a.voidedAt === 900)).toBe(true);
  });

  it("ne touche que les actions du groupe visé", async () => {
    const matchId = await newMatch();
    await repos.actions.append(matchId, combos.twoMade("p1", 1, "g1"));
    const other = await repos.actions.append(
      matchId,
      combos.assist("p2", 1, "g2"),
    );

    await repos.actions.voidGroup("g1", 700);

    expect(
      (await repos.actions.get(other.actions[0]!.id))?.voidedAt,
    ).toBeNull();
  });

  it("ne renvoie rien pour un groupe inconnu", async () => {
    expect(await repos.actions.voidGroup("fantome", 1)).toEqual([]);
  });

  it("exclut du décompte les actions déjà annulées d'un groupe", async () => {
    const matchId = await newMatch();
    const { groupId, actions } = await repos.actions.append(matchId, [
      {
        kind: "shot",
        playerId: "p1",
        quarter: 1,
        value: 2,
        made: false,
        fouled: true,
      },
      { kind: "free_throw", playerId: "p1", quarter: 1, made: true },
    ]);
    await repos.actions.voidAction(actions[1]!.id, 100);

    const voided = await repos.actions.voidGroup(groupId, 200);

    expect(voided).toHaveLength(1);
    expect(voided[0]?.kind).toBe("shot");
  });

  it("annule la dernière action via undoLast", async () => {
    const matchId = await newMatch();
    await repos.actions.append(matchId, combos.twoMade("p1", 1, "g1"));
    const last = await repos.actions.append(
      matchId,
      combos.assist("p2", 1, "g2"),
    );

    const voided = await repos.actions.undoLast(matchId, 111);

    expect(voided).toHaveLength(1);
    expect(voided[0]?.id).toBe(last.actions[0]!.id);
  });

  it("annule le dernier combo entier via undoLast", async () => {
    const matchId = await newMatch();
    await repos.actions.append(matchId, combos.assist("p2", 1, "g1"));
    const combo = await repos.actions.append(matchId, [
      {
        kind: "shot",
        playerId: "p1",
        quarter: 1,
        value: 3,
        made: true,
        fouled: true,
      },
      { kind: "free_throw", playerId: "p1", quarter: 1, made: true },
    ]);

    const voided = await repos.actions.undoLast(matchId, 222);

    expect(voided).toHaveLength(2);
    expect(voided.map((a) => a.id).sort()).toEqual(
      combo.actions.map((a) => a.id).sort(),
    );
  });

  it("remonte à la dernière action active après une annulation", async () => {
    const matchId = await newMatch();
    const first = await repos.actions.append(
      matchId,
      combos.twoMade("p1", 1, "g1"),
    );
    await repos.actions.append(matchId, combos.assist("p2", 1, "g2"));

    await repos.actions.undoLast(matchId, 1);
    const second = await repos.actions.undoLast(matchId, 2);

    // Sans ça, le coach aurait l'impression que l'annulation est cassée.
    expect(second.map((a) => a.id)).toEqual([first.actions[0]!.id]);
  });

  it("ne renvoie rien quand tout est déjà annulé", async () => {
    const matchId = await newMatch();
    await repos.actions.append(matchId, combos.twoMade("p1", 1, "g1"));
    await repos.actions.undoLast(matchId, 1);
    expect(await repos.actions.undoLast(matchId, 2)).toEqual([]);
  });

  it("ne renvoie rien sur un match vide", async () => {
    expect(await repos.actions.undoLast(await newMatch(), 1)).toEqual([]);
  });

  it("n'annule que le match demandé", async () => {
    const a = await newMatch();
    const b = await newMatch();
    const kept = await repos.actions.append(b, combos.assist("p2", 1, "g1"));
    await repos.actions.append(a, combos.twoMade("p1", 1, "g2"));

    await repos.actions.undoLast(a, 1);

    expect((await repos.actions.get(kept.actions[0]!.id))?.voidedAt).toBeNull();
  });

  it("met à jour updatedAt à l'annulation", async () => {
    const matchId = await newMatch();
    const { actions } = await repos.actions.append(
      matchId,
      combos.twoMade("p1", 1, "g1"),
      { now: 10 },
    );
    expect(actions[0]?.updatedAt).toBe(10);

    const voided = await repos.actions.voidAction(actions[0]!.id, 55);

    expect(voided?.updatedAt).toBe(55);
  });

  it("utilise l'horodatage courant par défaut", async () => {
    const matchId = await newMatch();
    const { actions } = await repos.actions.append(
      matchId,
      combos.twoMade("p1", 1, "g1"),
    );
    const before = Date.now();
    const voided = await repos.actions.voidAction(actions[0]!.id);
    expect(voided?.voidedAt).toBeGreaterThanOrEqual(before);
  });
});

// ---------------------------------------------------------------------------

const DEFAULT_TEAM = {
  id: LOCAL_TEAM_ID,
  name: "Mon équipe",
  ownerId: null,
};

// ---------------------------------------------------------------------------

describe("garde-fou : match terminé", () => {
  async function newMatch(): Promise<string> {
    const match = await repos.matches.create("local", {
      opponentName: "BC Nuit",
      date: "2026-10-05",
    });
    return match.id;
  }

  it("refuse d'ajouter une action à un match terminé", async () => {
    const matchId = await newMatch();
    await repos.matches.setStatus(matchId, "finished");

    await expect(
      repos.actions.append(matchId, combos.assist("p1", 1, "g1")),
    ).rejects.toThrow(/terminé/);
  });

  it("ne laisse ni action ni entrée d'outbox derrière le refus", async () => {
    const matchId = await newMatch();
    await repos.matches.setStatus(matchId, "finished");
    const before = await repos.actions.countByMatch(matchId);

    await expect(
      repos.actions.append(matchId, combos.twoMade("p1", 1, "g1")),
    ).rejects.toThrow(/terminé/);

    // Le garde-fou doit être dans la transaction : un écran resté ouvert ne
    // doit pas pouvoir écrire à moitié.
    expect(await repos.actions.countByMatch(matchId)).toBe(before);
  });

  it("réaccepte les actions après réouverture", async () => {
    const matchId = await newMatch();
    await repos.matches.setStatus(matchId, "finished");
    await expect(
      repos.actions.append(matchId, combos.assist("p1", 1, "g1")),
    ).rejects.toThrow(/terminé/);

    await repos.matches.setStatus(matchId, "live");
    const written = await repos.actions.append(
      matchId,
      combos.assist("p1", 1, "g2"),
    );
    // La correction passe par « rouvrir », jamais par un contournement.
    expect(written.actions).toHaveLength(1);
  });

  it("n'empêche pas la lecture", async () => {
    const matchId = await newMatch();
    await repos.actions.append(matchId, combos.twoMade("p1", 1, "g1"));
    await repos.matches.setStatus(matchId, "finished");

    expect(await repos.actions.listByMatch(matchId)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Suppression d'un match
// ---------------------------------------------------------------------------

describe("suppression d'un match", () => {
  /** Match complet : équipe, joueur, actions de deux périodes. */
  async function seedMatch() {
    const team = await repos.teams.ensureLocal();
    const player = await repos.players.create(team.id, {
      firstName: "Karim",
      lastName: "Bernard",
      number: 4,
    });
    const match = await repos.matches.create(team.id, {
      opponentName: "BC Nuit",
      date: "2026-10-05",
    });
    const { actions } = await repos.actions.append(match.id, [
      { playerId: player.id, quarter: 1, kind: "shot", value: 2, made: true },
      { playerId: player.id, quarter: 2, kind: "foul" },
    ]);
    return { team, player, match, actions };
  }

  it("supprime le match et ses actions", async () => {
    const { match, actions } = await seedMatch();

    await repos.matches.delete(match.id);

    expect(await repos.matches.get(match.id)).toBeUndefined();
    for (const action of actions) {
      expect(await repos.actions.get(action.id)).toBeUndefined();
    }
  });

  it("laisse le roster de l'équipe intact", async () => {
    const { match, player } = await seedMatch();

    await repos.matches.delete(match.id);

    // Les joueurs servent les matchs suivants : les supprimer viderait l'équipe
    // d'un match créé par erreur.
    expect(await repos.players.get(player.id)).toBeDefined();
  });

  it("ne touche pas aux autres matchs", async () => {
    const { team, player, match } = await seedMatch();
    const other = await repos.matches.create(team.id, {
      opponentName: "BC Jour",
      date: "2026-10-06",
    });
    await repos.actions.append(other.id, [
      { playerId: player.id, quarter: 1, kind: "shot", value: 3, made: true },
    ]);

    await repos.matches.delete(match.id);

    expect(await repos.matches.get(other.id)).toBeDefined();
    expect(await repos.actions.countByMatch(other.id)).toBe(1);
  });

  it("met une entrée delete en file pour le match et ses actions", async () => {
    const { match, actions } = await seedMatch();

    await repos.matches.delete(match.id);

    // Sans ces entrées, le match reviendrait au tirage suivant — un fantôme
    // impossible à expliquer ni à supprimer ensuite.
    const entries = await database.outbox.toArray();
    const deletions = entries.filter((entry) => entry.operation === "delete");

    expect(deletions.map((entry) => entry.entity).sort()).toEqual([
      "actions",
      "actions",
      "matches",
    ]);
    expect(deletions.some((entry) => entry.entityId === match.id)).toBe(true);
    for (const action of actions) {
      expect(deletions.some((entry) => entry.entityId === action.id)).toBe(
        true,
      );
    }
  });

  it("purge les upserts en attente avant de poser les suppressions", async () => {
    const { match, actions } = await seedMatch();

    await repos.matches.delete(match.id);

    const entries = await database.outbox.toArray();
    // Seules les lignes du match sont concernées : l'équipe et le joueur portent
    // toujours des `upsert`, ils servent les matchs suivants.
    const concerning = entries.filter(
      (entry) =>
        entry.entityId === match.id ||
        actions.some((action) => action.id === entry.entityId),
    );

    // Une seule opération par ligne : un `delete` ne peut pas cohabiter avec
    // l'`upsert` qu'il remplace, sans quoi le cloud recréerait le match au
    // cycle suivant.
    expect(concerning.every((entry) => entry.operation === "delete")).toBe(
      true,
    );
    expect(
      concerning.filter((entry) => entry.entityId === match.id),
    ).toHaveLength(1);
    for (const action of actions) {
      expect(
        concerning.filter((entry) => entry.entityId === action.id),
      ).toHaveLength(1);
    }

    // Et l'équipe, elle, n'a pas bougé.
    expect(entries.some((entry) => entry.entity === "teams")).toBe(true);
  });

  it("ne pose aucune entrée pour un match inconnu", async () => {
    const { match } = await seedMatch();
    const before = await database.outbox.count();

    await repos.matches.delete("inexistant");

    // Idempotent comme un `DELETE` HTTP : pas d'entrée pour une ligne absente,
    // sinon la file se remplirait de suppressions de lignes qui n'ont jamais
    // existé, et chaque cycle partirait avec une requête inutile.
    expect(await repos.matches.get(match.id)).toBeDefined();
    expect(await database.outbox.count()).toBe(before);
  });

  it("ne repropose rien si le match est déjà supprimé", async () => {
    const { match, actions } = await seedMatch();

    await repos.matches.delete(match.id);
    await database.outbox.clear();
    await repos.matches.delete(match.id);

    // La seconde passe trouve un match absent et s'arrête : aucune entrée pour
    // des lignes déjà parties, donc pas de requête inutile à chaque cycle.
    const entries = await database.outbox.toArray();
    expect(entries).toHaveLength(0);
    for (const action of actions) {
      expect(entries.some((e) => e.entityId === action.id)).toBe(false);
    }
  });
});
