import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setDb, setRepos } from "@/data";
import { createRepositories, type Repositories } from "@/data/repositories";
import type { MatchRow } from "@/data/schema";
import { SpaceBunnyDB } from "@/data/schema";
import { DeleteMatchButton } from "@/features/match/DeleteMatchButton";
import { FoulDots } from "@/ui/Badges";

/**
 * Tests du bouton de suppression et des pastilles de fautes.
 *
 * La suppression est le seul geste de l'application qui **détruit** des données.
 * Tout le reste — y compris une annulation d'action — est réversible. Les tests
 * ci-dessous vérifient donc les deux propriétés qui la rendent acceptable :
 * elle demande confirmation, et elle dit **combien** de données vont partir.
 *
 * Les parcours bout en bout sont dans `tests/e2e/smoke.spec.ts` ; ces tests
 * couvrent les états qu'un parcours n'atteint pas facilement — l'échec de la
 * suppression, la confirmation refermée, le match sans action.
 */

let counter = 0;
let database: SpaceBunnyDB;
let repos: Repositories;

beforeEach(async () => {
  counter += 1;
  database = new SpaceBunnyDB(`space-bunny-delete-${counter}`);
  await database.open();
  setDb(database);
  repos = createRepositories(database);
  setRepos(repos);
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  setRepos(null);
  setDb(null);
  database.close();
  await Dexie.delete(database.name);
});

const MATCH: MatchRow = {
  id: "match-1",
  teamId: "local",
  opponentName: "BC Nuit",
  date: "2026-10-06",
  playerIds: [],
  status: "finished",
  createdAt: 1,
  finishedAt: 2,
  updatedAt: 3,
};

describe("bouton de suppression", () => {
  it("demande confirmation avant toute suppression", async () => {
    const onDeleted = vi.fn();
    render(
      <DeleteMatchButton
        match={MATCH}
        actionCount={12}
        onDeleted={onDeleted}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", {
        name: "Supprimer le match contre BC Nuit",
      }),
    );

    // La fiche s'ouvre sans rien supprimer : c'est tout l'intérêt.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("nomme le nombre d'actions qui vont partir", async () => {
    render(
      <DeleteMatchButton match={MATCH} actionCount={40} onDeleted={vi.fn()} />,
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Supprimer le match contre BC Nuit",
      }),
    );

    // « 40 actions seront perdues » est le seul énoncé qui permet de vérifier
    // qu'on choisit le bon match : deux matchs contre la même équipe sont
    // courants dans une saison.
    expect(screen.getByRole("dialog")).toHaveTextContent("40 actions");
  });

  it("écrit la date en toutes lettres", async () => {
    render(
      <DeleteMatchButton match={MATCH} actionCount={1} onDeleted={vi.fn()} />,
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Supprimer le match contre BC Nuit",
      }),
    );

    // La forme courte `06/10/2026` serait ambiguë dans une confirmation.
    expect(screen.getByRole("dialog")).toHaveTextContent("6 octobre 2026");
  });

  it("dit qu'il n'y a aucune action, plutôt que « 0 »", async () => {
    render(
      <DeleteMatchButton match={MATCH} actionCount={0} onDeleted={vi.fn()} />,
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Supprimer le match contre BC Nuit",
      }),
    );

    // Un « 0 actions » ferait croire à un bug de comptage.
    expect(screen.getByRole("dialog")).toHaveTextContent("n’en a aucune");
    // Sans action, la menace « pas de corbeille » n'a pas lieu d'être.
    expect(screen.getByRole("dialog")).not.toHaveTextContent(
      "pas de corbeille",
    );
  });

  it("« Garder » referme sans rien supprimer", async () => {
    const onDeleted = vi.fn();
    render(
      <DeleteMatchButton match={MATCH} actionCount={5} onDeleted={onDeleted} />,
    );

    await userEvent.click(
      screen.getByRole("button", {
        name: "Supprimer le match contre BC Nuit",
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Garder" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  // `name: /^Supprimer$/` plutôt que `exact: true` : Testing Library n'a pas
  // d'option `exact`, et le motif ancré fait le même travail — sans faire
  // matcher « Supprimer le match contre … », qui est le bouton de la liste.
  it("supprime, puis prévient l'appelant", async () => {
    const onDeleted = vi.fn();
    const store = repos;
    const team = await store.teams.ensureLocal();
    const match = await store.matches.create(team.id, {
      opponentName: "BC Nuit",
      date: "2026-10-06",
    });

    render(
      <DeleteMatchButton match={match} actionCount={0} onDeleted={onDeleted} />,
    );

    await userEvent.click(
      screen.getByRole("button", {
        name: "Supprimer le match contre BC Nuit",
      }),
    );
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /^Supprimer$/,
      }),
    );

    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalled();
    });
    expect(await store.matches.get(match.id)).toBeUndefined();
  });

  it("ferme la fiche après une suppression réussie", async () => {
    const store = repos;
    const team = await store.teams.ensureLocal();
    const match = await store.matches.create(team.id, {
      opponentName: "BC Nuit",
      date: "2026-10-06",
    });

    render(
      <DeleteMatchButton match={match} actionCount={0} onDeleted={vi.fn()} />,
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Supprimer le match contre BC Nuit",
      }),
    );
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /^Supprimer$/,
      }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("laisse la fiche ouverte et montre l'erreur si l'écriture échoue", async () => {
    vi.spyOn(repos.matches, "delete").mockRejectedValue(
      new Error("Suppression impossible"),
    );

    render(
      <DeleteMatchButton match={MATCH} actionCount={3} onDeleted={vi.fn()} />,
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Supprimer le match contre BC Nuit",
      }),
    );
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /^Supprimer$/,
      }),
    );

    // Le coach doit voir que rien n'a été supprimé et pouvoir réessayer : une
    // fiche qui se refermerait sur un échec l'informerait du contraire.
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Suppression impossible",
      );
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("ignore un second tap pendant la suppression", async () => {
    let release: () => void = () => {};
    vi.spyOn(repos.matches, "delete").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    render(
      <DeleteMatchButton match={MATCH} actionCount={3} onDeleted={vi.fn()} />,
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Supprimer le match contre BC Nuit",
      }),
    );

    const confirm = within(screen.getByRole("dialog")).getByRole("button", {
      name: /^Supprimer$/,
    });
    await userEvent.click(confirm);

    // Le bouton passe à « Suppression… » et se désactive : un double tap
    // enverrait deux suppressions.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Suppression/ }),
      ).toBeDisabled();
    });

    // La promesse se résout en dehors du cycle de rendu ; l'envelopper évite
    // l'avertissement « update not wrapped in act », qui polluerait la sortie
    // d'un test qui passe.
    await act(async () => {
      release();
    });
  });
});

describe("pastilles de fautes", () => {
  it("annoncent le nombre aux lecteurs d'écran", () => {
    render(<FoulDots fouls={3} showCount />);

    // Le composant ne peut pas être entièrement `aria-hidden` : les pastilles
    // sont décoratives, mais le compteur porte le seuil d'élimination.
    expect(screen.getByText("3 fautes sur 5")).toBeInTheDocument();
  });

  it("emploie le singulier", () => {
    render(<FoulDots fouls={1} />);
    expect(screen.getByText("1 faute sur 5")).toBeInTheDocument();
  });
});
