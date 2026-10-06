import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { setDb, setRepos, SpaceBunnyDB } from "@/data";
import { createRepositories, type Repositories } from "@/data/repositories";
import {
  COLUMNS,
  sortAndFilter,
  useCumulativeData,
} from "@/features/stats/useCumulativeData";
import { useToastStore } from "@/features/stats/useToastStore";
import { cumulativeStats } from "@/domain/stats";
import { cumulativeToCsv } from "@/domain/export";
import type { PlayerRow } from "@/data/schema";

/**
 * Stats cumulées : tri, filtre, cohérence des moyennes.
 *
 * La vérification demandée par le plan — « les moyennes sont cohérentes avec le
 * total / nombre de matchs » — est ici-made explicite, et pas seulement
 * vérifiée par l'implémentation qui les produit toutes les deux.
 */

let database: SpaceBunnyDB;
let repos: Repositories;
let roster: PlayerRow[];

beforeEach(async () => {
  database = new SpaceBunnyDB(`space-bunny-stats-${Math.random()}`);
  await database.open();
  setDb(database);
  repos = createRepositories(database);
  setRepos(repos);

  const team = await repos.teams.ensureLocal();
  roster = await repos.players.createMany(team.id, [
    { firstName: "Ada", lastName: "Lovelace", number: 4 },
    { firstName: "Alan", lastName: "Turing", number: 7 },
    { firstName: "Grace", lastName: "Hopper", number: 12 },
    // N'apparaît dans aucun match : sert à vérifier qu'il ne structure pas
    // les statistiques cumulées.
    { firstName: "Zoe", lastName: "Jamais", number: 15 },
  ]);
});

afterEach(async () => {
  setRepos(null);
  setDb(null);
  database.close();
  await Dexie.delete(database.name);
});

/** Deux matchs joués par Ada, un seul par Alan. */
async function seedTwoMatches(): Promise<void> {
  const team = await repos.teams.ensureLocal();

  const m1 = await repos.matches.create(team.id, {
    opponentName: "BC Nuit",
    date: "2026-10-01",
    playerIds: roster.map((player) => player.id),
  });
  await repos.actions.append(m1.id, [
    { kind: "shot", playerId: roster[0]!.id, quarter: 1, value: 2, made: true },
    { kind: "shot", playerId: roster[0]!.id, quarter: 1, value: 3, made: true },
    { kind: "assist", playerId: roster[1]!.id, quarter: 1 },
  ]);
  await repos.matches.setStatus(m1.id, "finished");

  const m2 = await repos.matches.create(team.id, {
    opponentName: "BC Sud",
    date: "2026-10-05",
    playerIds: roster.map((player) => player.id),
  });
  await repos.actions.append(m2.id, [
    { kind: "shot", playerId: roster[0]!.id, quarter: 2, value: 2, made: true },
    {
      kind: "shot",
      playerId: roster[0]!.id,
      quarter: 2,
      value: 2,
      made: false,
    },
    { kind: "rebound", playerId: roster[2]!.id, quarter: 2, side: "defensive" },
  ]);
  await repos.matches.setStatus(m2.id, "finished");
}

async function loadStats() {
  const team = await repos.teams.ensureLocal();
  const matches = await repos.matches.listByTeam(team.id);
  const matchIds = matches.map((match) => match.id);
  const actions = await repos.actions.listByMatches(matchIds);
  return { stats: cumulativeStats(actions, matchIds), matchIds };
}

// ---------------------------------------------------------------------------

describe("cumulativeStats — cohérence", () => {
  it("les moyennes valent total / matchs joués", async () => {
    await seedTwoMatches();
    const { stats } = await loadStats();

    const ada = stats.find((entry) => entry.playerId === roster[0]!.id);
    // 2 + 3 au premier match, 2 au second : 7 points sur 2 matchs.
    expect(ada?.totals.points).toBe(7);
    expect(ada?.matchesPlayed).toBe(2);
    expect(ada?.averages.points).toBe(3.5);
    expect(ada?.averages.points).toBe(
      (ada!.totals.points as number) / ada!.matchesPlayed,
    );
  });

  it("compte un match joué même sans action", async () => {
    await seedTwoMatches();
    const { stats } = await loadStats();

    // Grace n'a joué que le second match : un seul, pas deux.
    const grace = stats.find((entry) => entry.playerId === roster[2]!.id);
    expect(grace?.matchesPlayed).toBe(1);
    expect(grace?.totals.reboundsDefensive).toBe(1);
    expect(grace?.averages.rebounds).toBe(1);
  });

  it("exclut un joueur qui n'a jamais joué", async () => {
    await seedTwoMatches();
    const { stats } = await loadStats();
    // Zoe est au roster mais n'a joué aucun des deux matchs : aucune ligne.
    expect(stats).toHaveLength(3);
    expect(stats.map((entry) => entry.playerId)).not.toContain(roster[3]!.id);
  });

  it("ne compte pas un match terminé sans action", async () => {
    await seedTwoMatches();
    const team = await repos.teams.ensureLocal();
    const empty = await repos.matches.create(team.id, {
      opponentName: "Match vide",
      date: "2026-10-08",
      playerIds: roster.map((player) => player.id),
    });
    await repos.matches.setStatus(empty.id, "finished");

    const { stats } = await loadStats();
    // Le comptage se fait sur les actions distinctes : un match sans action ne
    // gonfle pas « matchs joués ».
    expect(
      stats.find((entry) => entry.playerId === roster[0]!.id)?.matchesPlayed,
    ).toBe(2);
  });
});

// ---------------------------------------------------------------------------

describe("sortAndFilter", () => {
  it("trie par points décroissant par défaut", async () => {
    await seedTwoMatches();
    const { stats } = await loadStats();

    const { rows } = sortAndFilter(stats, roster, "points", true, "");
    expect(rows[0]?.player?.lastName).toBe("Lovelace");
  });

  it("inverse l'ordre", async () => {
    await seedTwoMatches();
    const { stats } = await loadStats();

    const up = sortAndFilter(stats, roster, "points", false, "");
    expect(up.rows[up.rows.length - 1]?.player?.lastName).toBe("Lovelace");
  });

  it("trie par nom par ordre croissant, même en « décroissant »", async () => {
    await seedTwoMatches();
    const { stats } = await loadStats();

    // Lire une liste de noms à l'envers n'aide personne : le sens du tri est
    // forcé au croissant pour la colonne « Joueur ».
    const { rows } = sortAndFilter(stats, roster, "name", true, "");
    const names = rows.map((row) => row.player?.lastName);
    expect(names).toEqual(
      [...names].sort((a, b) => (a ?? "").localeCompare(b ?? "")),
    );
  });

  it("trie par fautes", async () => {
    await seedTwoMatches();
    const { stats } = await loadStats();

    const { rows } = sortAndFilter(stats, roster, "fouls", true, "");
    expect(rows[0]?.player?.lastName).toBeDefined();
  });

  it("place un joueur sans pourcentage en fin de tri décroissant", async () => {
    await seedTwoMatches();
    const { stats } = await loadStats();

    // Ni Alan ni Grace n'a tiré : leur ratio vaut -1 pour ne pas remonter dans
    // le classement, et la colonne affiche « — ». À -1, l'ordre est celui du nom.
    const { rows } = sortAndFilter(stats, roster, "shooting", true, "");
    expect(rows.slice(-2).map((row) => row.player?.lastName)).toEqual([
      "Hopper",
      "Turing",
    ]);
  });

  it("filtre par nom, insensible à la casse", async () => {
    await seedTwoMatches();
    const { stats } = await loadStats();

    expect(
      sortAndFilter(stats, roster, "points", true, "lovelace").rows,
    ).toHaveLength(1);
    expect(
      sortAndFilter(stats, roster, "points", true, "LOV").rows,
    ).toHaveLength(1);
    // Une recherche vide ne filtre rien : les trois joueurs ayant joué restent.
    expect(
      sortAndFilter(stats, roster, "points", true, "  ").rows,
    ).toHaveLength(3);
    expect(
      sortAndFilter(stats, roster, "points", true, "zzz").rows,
    ).toHaveLength(0);
  });

  it("départage les égalités par nom de famille", async () => {
    await seedTwoMatches();
    const { stats } = await loadStats();

    // Alan et Grace marquent 0 : l'ordre doit rester stable et lisible.
    const { rows } = sortAndFilter(stats, roster, "points", true, "");
    const zero = rows.filter((row) => row.entry.totals.points === 0);
    expect(zero.map((row) => row.player?.lastName)).toEqual([
      "Hopper",
      "Turing",
    ]);
  });

  it("chaque colonne produit une valeur numérique ou une chaîne", async () => {
    await seedTwoMatches();
    const { stats } = await loadStats();
    const entry = stats[0]!;

    for (const column of COLUMNS) {
      const value = column.value(
        entry,
        roster.find((p) => p.id === entry.playerId),
      );
      expect(["number", "string"]).toContain(typeof value);
    }
  });
});

// ---------------------------------------------------------------------------

describe("cumulativeToCsv", () => {
  it("écrit une ligne par joueur, dans l'ordre du classement", async () => {
    await seedTwoMatches();
    const { stats } = await loadStats();

    const csv = cumulativeToCsv({ players: roster, stats, matchCount: 2 });
    const lines = csv.split("\r\n");
    const lovelace = lines.findIndex((line) => line.includes("Lovelace"));
    const turing = lines.findIndex((line) => line.includes("Turing"));

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(lovelace).toBeGreaterThan(-1);
    // Ada est la meilleure scoreuse : sa ligne précède celle d'Alan.
    expect(lovelace).toBeLessThan(turing);
  });

  it("exporte les réussis ET les tentés", async () => {
    await seedTwoMatches();
    const { stats } = await loadStats();

    const csv = cumulativeToCsv({ players: roster, stats, matchCount: 2 });
    const row = csv.split("\r\n").find((line) => line.includes("Lovelace"));
    // 2 réussis à 2 points, 1 à 3 ; le coach peut recalculer les %.
    // 2 paniers à 2 points réussis sur 3 tentés — le raté du second match
    // compte comme tentative, c'est tout l'intérêt de la colonne.
    expect(row?.split(";")[6]).toBe("2");
    expect(row?.split(";")[7]).toBe("3");
  });

  it("garde une décimale sur les pourcentages", async () => {
    await seedTwoMatches();
    const { stats } = await loadStats();

    const csv = cumulativeToCsv({ players: roster, stats, matchCount: 2 });
    const row = csv.split("\r\n").find((line) => line.includes("Lovelace"));
    // 2/3 à 2 points = 66,7 % — l'écran arrondit à 67, l'export garde la décimale.
    expect(row?.split(";")[8]).toBe("66.7");
  });

  it("laisse vide un pourcentage sans tentative", async () => {
    await seedTwoMatches();
    const { stats } = await loadStats();

    const csv = cumulativeToCsv({ players: roster, stats, matchCount: 2 });
    const row = csv.split("\r\n").find((line) => line.includes("Hopper"));
    // Grace n'a tiré aucune fois : aucun ratio à afficher, pas un « 0.0 » trompeur.
    expect(row?.split(";")[8]).toBe("");
  });

  it("écrit la moyenne par match à une décimale", async () => {
    await seedTwoMatches();
    const { stats } = await loadStats();

    const csv = cumulativeToCsv({ players: roster, stats, matchCount: 2 });
    const row = csv.split("\r\n").find((line) => line.includes("Lovelace"));
    expect(row?.split(";")[5]).toBe("3.5");
  });

  it("annonce le nombre de matchs dans l'en-tête", () => {
    const csv = cumulativeToCsv({ players: [], stats: [], matchCount: 7 });
    expect(csv).toContain("Stats cumulées;7 match(s)");
  });

  it("échappe un nom contenant un point-virgule", () => {
    const csv = cumulativeToCsv({
      players: [
        {
          id: "p1",
          teamId: "local",
          firstName: "Ada",
          lastName: "Lo;velace",
          number: 4,
        },
      ],
      stats: [
        {
          playerId: "p1",
          points: 0,
          fgm2: 0,
          fga2: 0,
          fgm3: 0,
          fga3: 0,
          ftm: 0,
          fta: 0,
          fouls: 0,
          reboundsOffensive: 0,
          reboundsDefensive: 0,
          assists: 0,
          turnovers: 0,
          steals: 0,
          blocks: 0,
          matchesPlayed: 1,
          totals: {
            playerId: "p1",
            points: 0,
            fgm2: 0,
            fga2: 0,
            fgm3: 0,
            fga3: 0,
            ftm: 0,
            fta: 0,
            fouls: 0,
            reboundsOffensive: 0,
            reboundsDefensive: 0,
            assists: 0,
            turnovers: 0,
            steals: 0,
            blocks: 0,
          },
          averages: {
            points: 0,
            fgm2: 0,
            fga2: 0,
            fgm3: 0,
            fga3: 0,
            ftm: 0,
            fta: 0,
            fouls: 0,
            rebounds: 0,
            assists: 0,
            turnovers: 0,
            steals: 0,
            blocks: 0,
          },
        },
      ],
      matchCount: 1,
    });
    expect(csv).toContain('"Lo;velace"');
  });
});

// ---------------------------------------------------------------------------

describe("useCumulativeData", () => {
  function Probe() {
    const { stats, roster, matchCount, loading } = useCumulativeData();
    if (loading) return <span>chargement</span>;
    return (
      <div>
        <span data-testid="stats">{stats.length}</span>
        <span data-testid="roster">{roster.length}</span>
        <span data-testid="matches">{matchCount}</span>
        <span data-testid="points">
          {stats.reduce((sum, entry) => sum + entry.totals.points, 0)}
        </span>
      </div>
    );
  }

  it("renvoie un état vide sans match", async () => {
    render(<Probe />);
    await waitFor(() => {
      expect(screen.getByTestId("stats")).toHaveTextContent("0");
    });
  });

  it("cumule les points de tous les matchs", async () => {
    await seedTwoMatches();
    render(<Probe />);

    // Ada 7 points, les autres 0.
    await waitFor(() => {
      expect(screen.getByTestId("points")).toHaveTextContent("7");
    });
  });

  it("renvoie le roster complet, joueurs inactifs inclus", async () => {
    await seedTwoMatches();
    render(<Probe />);

    // Quatre joueurs au roster, mais seuls ceux qui ont joué ont une ligne de
    // statistiques : d'où l'écart.
    await waitFor(() => {
      expect(screen.getByTestId("roster")).toHaveTextContent("4");
    });
    expect(screen.getByTestId("stats")).toHaveTextContent("3");
  });

  it("compte les matchs, en cours compris", async () => {
    await seedTwoMatches();
    const team = await repos.teams.ensureLocal();
    await repos.matches.create(team.id, {
      opponentName: "En cours",
      date: "2026-10-09",
    });
    render(<Probe />);

    await waitFor(() => {
      expect(screen.getByTestId("matches")).toHaveTextContent("3");
    });
  });
});

describe("useToastStore", () => {
  beforeEach(() => {
    useToastStore.getState().clear();
  });

  it("annonce un message", () => {
    const store = useToastStore.getState();
    store.show("Export de 3 joueurs");
    expect(useToastStore.getState().text).toBe("Export de 3 joueurs");
  });

  it("incrémente l'identifiant pour rejouer l'animation", () => {
    const first = useToastStore.getState().id;
    useToastStore.getState().show("a");
    useToastStore.getState().show("a");
    // Même texte deux fois : sans identifiant croissant, la bannière ne
    // se rejouerait pas et le second export passerait inaperçu.
    expect(useToastStore.getState().id).toBe(first + 2);
  });

  it("se vide", () => {
    useToastStore.getState().show("x");
    useToastStore.getState().clear();
    expect(useToastStore.getState().text).toBeNull();
  });
});
