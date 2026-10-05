import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setDb, setRepos, SpaceBunnyDB } from "@/data";
import { createRepositories, type Repositories } from "@/data/repositories";
import { MatchSheet } from "@/features/match/MatchSheet";
import { FinishSheet } from "@/features/match/FinishSheet";
import type { Action, Match, Player } from "@/domain/types";

let counter = 0;

let database: SpaceBunnyDB;
let repos: Repositories;
let match: Match;
let roster: Player[];
let actions: Action[];

beforeEach(async () => {
  counter += 1;
  database = new SpaceBunnyDB(`space-bunny-sheet-${counter}`);
  await database.open();
  setDb(database);
  repos = createRepositories(database);
  setRepos(repos);

  const team = await repos.teams.ensureLocal();
  roster = await repos.players.createMany(team.id, [
    { firstName: "Ada", lastName: "Lovelace", number: 4 },
    { firstName: "Grace", lastName: "Hopper", number: 7 },
    { firstName: "", lastName: "Dupont", number: null },
  ]);
  match = await repos.matches.create(team.id, {
    opponentName: "BC Nuit",
    date: "2026-10-05",
    playerIds: roster.map((player) => player.id),
  });
  actions = [];
});

afterEach(async () => {
  setRepos(null);
  setDb(null);
  database.close();
  await Dexie.delete(database.name);
});

// ---------------------------------------------------------------------------

describe("MatchSheet — feuille de match", () => {
  function renderSheet() {
    return render(
      <MatchSheet match={match} players={roster} actions={actions} />,
    );
  }

  it("affiche le score par période", async () => {
    await repos.actions.append(match.id, [
      {
        kind: "shot",
        playerId: roster[0]!.id,
        quarter: 1,
        value: 2,
        made: true,
      },
      {
        kind: "shot",
        playerId: roster[0]!.id,
        quarter: 2,
        value: 3,
        made: true,
      },
    ]);
    actions = await repos.actions.listByMatch(match.id, {
      includeVoided: false,
    });

    renderSheet();
    // Scoped à la carte : les « 5 » du tableau des joueurs ne doivent pas
    // perturber la lecture.
    const card = screen.getByLabelText("Score par période");
    expect(within(card).getByText("5")).toBeInTheDocument();
    expect(within(card).getByText("3")).toBeInTheDocument();
  });

  it("affiche 0 pour une période sans point", () => {
    renderSheet();
    // Une période à 0 est une information, pas une absence de donnée : total
    // plus les quatre périodes, soit cinq zéros.
    const card = screen.getByLabelText("Score par période");
    expect(within(card).getAllByText("0")).toHaveLength(5);
  });

  it("affiche les pourcentages de l'équipe", async () => {
    await repos.actions.append(match.id, [
      {
        kind: "shot",
        playerId: roster[0]!.id,
        quarter: 1,
        value: 2,
        made: true,
      },
      {
        kind: "shot",
        playerId: roster[0]!.id,
        quarter: 1,
        value: 2,
        made: false,
      },
    ]);
    actions = await repos.actions.listByMatch(match.id, {
      includeVoided: false,
    });

    renderSheet();
    // 1/2 à 2 points, 1/2 au global : deux colonnes valent 50 %.
    const card = screen.getByLabelText("Pourcentages de l'équipe");
    expect(within(card).getAllByText("50%")).toHaveLength(2);
  });

  it("affiche un tiret quand aucune donnée ne permet un pourcentage", () => {
    renderSheet();
    // Un tiret par colonne sans donnée, pas de « 0/0 » trompeur.
    const card = screen.getByLabelText("Pourcentages de l'équipe");
    expect(within(card).getAllByText("—")).toHaveLength(4);
  });

  it("écrit la ligne d'un joueur en format `2/6`", async () => {
    await repos.actions.append(match.id, [
      {
        kind: "shot",
        playerId: roster[0]!.id,
        quarter: 1,
        value: 3,
        made: true,
      },
      {
        kind: "shot",
        playerId: roster[0]!.id,
        quarter: 1,
        value: 3,
        made: false,
      },
      {
        kind: "shot",
        playerId: roster[0]!.id,
        quarter: 1,
        value: 3,
        made: false,
      },
      {
        kind: "shot",
        playerId: roster[0]!.id,
        quarter: 1,
        value: 3,
        made: false,
      },
    ]);
    actions = await repos.actions.listByMatch(match.id, {
      includeVoided: false,
    });

    renderSheet();
    const cell = screen
      .getAllByRole("cell")
      .find((cell) => cell.textContent === "1/4");
    // C'est le format attendu par le plan : « 2/6 à 3pts ».
    expect(cell).toBeDefined();
  });

  it("affiche une ligne à zéro pour un joueur entré sans rien faire", () => {
    renderSheet();
    const row = screen
      .getAllByRole("row")
      .find((row) => row.textContent?.includes("Dupont"));
    // Sans cette ligne, le coach croirait à une omission du document.
    expect(row).toBeDefined();
    expect(within(row!).getAllByRole("cell")[1]).toHaveTextContent("0");
  });

  it("exclut les actions annulées des compteurs", async () => {
    const { actions: written } = await repos.actions.append(match.id, [
      {
        kind: "shot",
        playerId: roster[0]!.id,
        quarter: 1,
        value: 2,
        made: true,
      },
    ]);
    await repos.actions.voidAction(written[0]!.id, 1);
    actions = await repos.actions.listByMatch(match.id, {
      includeVoided: false,
    });

    renderSheet();
    // Tout est annulé : le score retombe à zéro partout.
    const card = screen.getByLabelText("Score par période");
    expect(within(card).getAllByText("0")).toHaveLength(5);
  });

  it("signale un joueur à 5 fautes", async () => {
    for (let i = 0; i < 5; i += 1) {
      const { groupId } = await repos.actions.append(match.id, [
        { kind: "foul", playerId: roster[0]!.id, quarter: 1 },
      ]);
      void groupId;
    }
    actions = await repos.actions.listByMatch(match.id, {
      includeVoided: false,
    });

    renderSheet();
    const cell = screen
      .getAllByRole("cell")
      .find((cell) => cell.textContent === "5");
    expect(cell).toHaveClass("text-foul");
  });

  it("affiche un message quand le roster est vide", () => {
    render(<MatchSheet match={match} players={[]} actions={[]} />);
    expect(screen.getByText(/Aucun joueur/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------

describe("MatchSheet — export", () => {
  function renderSheet() {
    return render(
      <MatchSheet match={match} players={roster} actions={actions} />,
    );
  }

  it("propose les deux formats", () => {
    renderSheet();
    expect(
      screen.getByRole("button", { name: "Exporter CSV" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Exporter JSON" }),
    ).toBeInTheDocument();
  });

  it("télécharge un CSV nommé par la date et l'adversaire", async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => "blob:x",
      revokeObjectURL: spy,
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    renderSheet();
    await user.click(screen.getByRole("button", { name: "Exporter CSV" }));

    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(anchor.download).toBe("2026-10-05-vs-bc-nuit.csv");

    click.mockRestore();
    vi.unstubAllGlobals();
  });

  it("télécharge un JSON", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => "blob:x",
      revokeObjectURL: () => {},
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    renderSheet();
    await user.click(screen.getByRole("button", { name: "Exporter JSON" }));

    const anchor = click.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(anchor.download).toBe("2026-10-05-vs-bc-nuit.json");

    click.mockRestore();
    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------

describe("FinishSheet — confirmation de clôture", () => {
  function renderFinish() {
    return render(
      <FinishSheet
        match={match}
        players={roster}
        actions={actions}
        onCancel={() => {}}
        onFinished={() => {}}
      />,
    );
  }

  it("affiche le score final", async () => {
    await repos.actions.append(match.id, [
      {
        kind: "shot",
        playerId: roster[0]!.id,
        quarter: 1,
        value: 2,
        made: true,
      },
    ]);
    actions = await repos.actions.listByMatch(match.id, {
      includeVoided: false,
    });

    renderFinish();
    // Le paragraphe assemble plusieurs nœuds de texte : la recherche porte sur
    // son `textContent` complet, pas sur un fragment.
    expect(
      screen.getByText(
        (_content, element) =>
          element?.textContent === "Score final : 2 pts contre BC Nuit.",
      ),
    ).toBeInTheDocument();
  });

  it("alerte sur les lancers dûs mais jamais saisis", async () => {
    await repos.actions.append(match.id, [
      {
        kind: "shot",
        playerId: roster[0]!.id,
        quarter: 1,
        value: 2,
        made: false,
        fouled: true,
      },
    ]);
    actions = await repos.actions.listByMatch(match.id, {
      includeVoided: false,
    });

    renderFinish();
    // Le seul écart réparable avant clôture : le laisser passer fait
    // disparaître la tentative des stats.
    expect(
      screen.getByText(/2 lancers libres dûs mais jamais saisis/),
    ).toBeInTheDocument();
  });

  it("ne dit rien quand tous les lancers ont été saisis", async () => {
    await repos.actions.append(match.id, [
      {
        kind: "shot",
        playerId: roster[0]!.id,
        quarter: 1,
        value: 2,
        made: false,
        fouled: true,
      },
    ]);
    const { groupId } = await repos.actions.append(match.id, [
      {
        kind: "free_throw",
        playerId: roster[0]!.id,
        quarter: 1,
        groupId: "g",
        made: true,
      },
    ]);
    void groupId;
    actions = await repos.actions.listByMatch(match.id, {
      includeVoided: false,
    });

    renderFinish();
    expect(screen.queryByText(/dûs mais jamais saisis/)).toBeNull();
  });

  it("liste les joueurs à 5 fautes", async () => {
    for (let i = 0; i < 5; i += 1) {
      await repos.actions.append(match.id, [
        { kind: "foul", playerId: roster[0]!.id, quarter: 1 },
      ]);
    }
    actions = await repos.actions.listByMatch(match.id, {
      includeVoided: false,
    });

    renderFinish();
    expect(screen.getByText(/joueur à 5 fautes/)).toBeInTheDocument();
    expect(screen.getByText(/Lovelace/)).toBeInTheDocument();
  });

  it("prévient que la saisie sera bloquée", () => {
    renderFinish();
    expect(screen.getByText(/la saisie est bloquée/)).toBeInTheDocument();
  });

  it("clôture le match au bouton Terminer", async () => {
    const user = userEvent.setup();
    const onFinished = vi.fn();
    render(
      <FinishSheet
        match={match}
        players={roster}
        actions={actions}
        onCancel={() => {}}
        onFinished={onFinished}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Terminer" }));

    await waitFor(() => {
      expect(onFinished).toHaveBeenCalledTimes(1);
    });
    expect((await repos.matches.get(match.id))?.status).toBe("finished");
  });

  it("ne clôture pas au bouton Continuer", async () => {
    const user = userEvent.setup();
    render(
      <FinishSheet
        match={match}
        players={roster}
        actions={actions}
        onCancel={() => {}}
        onFinished={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Continuer" }));

    expect((await repos.matches.get(match.id))?.status).not.toBe("finished");
  });

  it("permet de rouvrir un match terminé pour corriger", async () => {
    await repos.matches.setStatus(match.id, "finished");
    await repos.matches.setStatus(match.id, "live");

    const written = await repos.actions.append(match.id, [
      {
        kind: "shot",
        playerId: roster[0]!.id,
        quarter: 2,
        value: 3,
        made: true,
      },
    ]);
    // La correction passe par « rouvrir », jamais par un contournement.
    expect(written.actions).toHaveLength(1);
  });
});
