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

function Probe() {
  const { matches, finished, inProgress, matchCount, loading } =
    useHistoryData();

  if (loading) return <span>chargement</span>;
  return (
    <div>
      <span data-testid="total">{matches.length}</span>
      <span data-testid="finished">{finished.length}</span>
      <span data-testid="progress">{inProgress.length}</span>
      <span data-testid="matchCount">{matchCount}</span>
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
});
