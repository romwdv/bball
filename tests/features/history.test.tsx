import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { setDb, setRepos, SpaceBunnyDB } from "@/data";
import { createRepositories, type Repositories } from "@/data/repositories";
import { useHistoryData } from "@/features/history/useHistoryData";

/**
 * Hook d'historique.
 *
 * Le composant d'écran n'est pas testé ici : il ne fait que boucler sur ce que
 * ce hook renvoie, et `MatchSheet` a déjà ses propres tests. Ce qui mérite un
 * test, c'est la **répartition** des matchs — c'est elle qui décide de ce que le
 * coach voit en premier.
 */

let database: SpaceBunnyDB;
let repos: Repositories;

beforeEach(async () => {
  database = new SpaceBunnyDB(`space-bunny-hist-${Math.random()}`);
  await database.open();
  setDb(database);
  repos = createRepositories(database);
  setRepos(repos);
});

afterEach(async () => {
  setRepos(null);
  setDb(null);
  database.close();
  await Dexie.delete(database.name);
});

async function seed(): Promise<void> {
  const team = await repos.teams.ensureLocal();
  const done = await repos.matches.create(team.id, {
    opponentName: "BC Nuit",
    date: "2026-09-01",
  });
  await repos.matches.setStatus(done.id, "finished");
  await repos.matches.create(team.id, {
    opponentName: "BC Sud",
    date: "2026-10-05",
    status: "live",
  });
  await repos.matches.create(team.id, {
    opponentName: "BC Est",
    date: "2026-10-08",
    status: "live",
  });
}

function Probe({ revision = 0 }: { revision?: number }) {
  const { matches, finished, inProgress, matchCount, actionCounts, loading } =
    useHistoryData(revision);

  if (loading) return <span>chargement</span>;
  return (
    <div>
      <span data-testid="total">{matches.length}</span>
      <span data-testid="finished">{finished.length}</span>
      <span data-testid="progress">{inProgress.length}</span>
      <span data-testid="matchCount">{matchCount}</span>
      {/* Le décompte par match est affiché pour vérifier que la lecture des
          actions a bien eu lieu — pas seulement que le tableau existe. */}
      <span data-testid="counts">
        {[...actionCounts.entries()]
          .map(([id, count]) => `${id}:${count}`)
          .join(",")}
      </span>
      <ul>
        {matches.map((match) => (
          <li key={match.id}>{match.opponentName}</li>
        ))}
      </ul>
    </div>
  );
}

describe("useHistoryData", () => {
  it("renvoie un état vide sans match", async () => {
    render(<Probe />);
    await waitFor(() => {
      expect(screen.getByTestId("total")).toHaveTextContent("0");
    });
  });

  it("répartit les matchs entre terminés et en cours", async () => {
    await seed();
    render(<Probe />);

    await waitFor(() => {
      expect(screen.getByTestId("finished")).toHaveTextContent("1");
    });
    expect(screen.getByTestId("progress")).toHaveTextContent("2");
  });

  it("compte les matchs en cours dans le total", async () => {
    await seed();
    render(<Probe />);
    // Un match en cours appartient à l'historique : le coach veut le voir.
    await waitFor(() => {
      expect(screen.getByTestId("matchCount")).toHaveTextContent("3");
    });
  });

  it("trie du plus récent au plus ancien", async () => {
    await seed();
    render(<Probe />);

    await waitFor(() => {
      expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("BC Est");
    });
    expect(screen.getAllByRole("listitem")[1]).toHaveTextContent("BC Sud");
    expect(screen.getAllByRole("listitem")[2]).toHaveTextContent("BC Nuit");
  });

  it("compte les actions actives de chaque match", async () => {
    // Le compte sert à la confirmation de suppression : « 40 actions seront
    // perdues » est le seul énoncé qui permet de vérifier qu'on choisit le bon
    // match.
    const team = await repos.teams.ensureLocal();
    const player = await repos.players.create(team.id, {
      firstName: "Karim",
      lastName: "Bernard",
      number: 4,
    });
    const match = await repos.matches.create(team.id, {
      opponentName: "BC Compté",
      date: "2026-10-06",
    });
    await repos.actions.append(match.id, [
      { playerId: player.id, quarter: 1, kind: "shot", value: 2, made: true },
      { playerId: player.id, quarter: 1, kind: "foul" },
    ]);

    render(<Probe />);

    await waitFor(() => {
      expect(screen.getByTestId("counts")).toHaveTextContent(
        `${match.id}:2`,
      );
    });
  });

  it("exclut les actions annulées du compte", async () => {
    const team = await repos.teams.ensureLocal();
    const player = await repos.players.create(team.id, {
      firstName: "Karim",
      lastName: "Bernard",
      number: 4,
    });
    const match = await repos.matches.create(team.id, {
      opponentName: "BC Annulé",
      date: "2026-10-06",
    });
    const { actions } = await repos.actions.append(match.id, [
      { playerId: player.id, quarter: 1, kind: "shot", value: 2, made: true },
    ]);
    await repos.actions.voidAction(actions[0]!.id);

    render(<Probe />);

    // Aucune entrée pour ce match : la confirmation affichera « il n'en a
    // aucune ». Compter l'action annulée donnerait « 1 action sera perdue » —
    // une formulation trompeuse, puisque rien n'est actif.
    await waitFor(() => {
      expect(screen.getByTestId("total")).toHaveTextContent("1");
    });
    expect(screen.getByTestId("counts")).not.toHaveTextContent(match.id);
  });

  it("relaît quand la révision change", async () => {
    await seed();
    const { rerender } = render(<Probe revision={0} />);
    await waitFor(() => {
      expect(screen.getByTestId("total")).toHaveTextContent("3");
    });

    const team = await repos.teams.ensureLocal();
    await repos.matches.create(team.id, {
      opponentName: "BC Nouveau",
      date: "2026-10-09",
    });
    rerender(<Probe revision={1} />);

    // Sans ce mécanisme, un match supprimé resterait affiché après le tap sur
    // « Supprimer » — le pire rendu possible pour ce bouton.
    await waitFor(() => {
      expect(screen.getByTestId("total")).toHaveTextContent("4");
    });
  });
});
