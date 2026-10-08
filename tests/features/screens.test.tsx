import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setDb, setRepos, SpaceBunnyDB } from "@/data";
import { createRepositories, type Repositories } from "@/data/repositories";
import type { PlayerRow } from "@/data/schema";
import { FreeThrowSheet } from "@/features/match/FreeThrowSheet";
import { MatchHeader } from "@/features/match/MatchHeader";
import { ActivePlayer, useMatchData } from "@/features/match/ActivePlayer";
import { formatDate, today } from "@/features/match/formatDate";
import { useMatchStore } from "@/features/match/store";
import { FoulDots, PlayerBadges } from "@/ui/Badges";
import { Flash } from "@/ui/Flash";
import { Sheet } from "@/ui/Sheet";
import { Toast } from "@/ui/Toast";
import { aggregateFor, describeAction } from "@/domain/stats";
import { QUARTERS } from "@/domain/types";

let counter = 0;

let database: SpaceBunnyDB;
let repos: Repositories;
let matchId: string;
let roster: PlayerRow[];

beforeEach(async () => {
  counter += 1;
  database = new SpaceBunnyDB(`space-bunny-screen-${counter}`);
  await database.open();
  setDb(database);
  repos = createRepositories(database);
  setRepos(repos);

  const team = await repos.teams.ensureLocal();
  roster = await repos.players.createMany(team.id, [
    { firstName: "Ada", lastName: "Lovelace", number: 4 },
    { firstName: "Alan", lastName: "Turing", number: 7 },
    { firstName: "Zoe", lastName: "Zzz", number: 12 },
  ]);
  const match = await repos.matches.create(team.id, {
    opponentName: "BC Nuit",
    date: "2026-10-05",
    playerIds: roster.map((player) => player.id),
  });
  matchId = match.id;

  useMatchStore.getState().openMatch(matchId, roster[0]!.id);
  useMatchStore.setState({
    revision: 0,
    notice: null,
    quarter: 1,
    sheet: null,
  });
});

afterEach(async () => {
  setRepos(null);
  setDb(null);
  database.close();
  await Dexie.delete(database.name);
});

// ---------------------------------------------------------------------------

describe("formatDate", () => {
  it("met la date au format français", () => {
    expect(formatDate("2026-10-05")).toBe("05/10/2026");
  });

  it("laisse une date illisible telle quelle plutôt que de mentir", () => {
    // Mieux vaut « 05/10 » affiché brut qu'un « NaN/NaN/NaN » dans une zone de
    // saisie : le coach verrait un bug là où il n'y a qu'une donnée absente.
    expect(formatDate("pas une date")).toBe("pas une date");
  });

  it("produit aujourd'hui au format attendu", () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ---------------------------------------------------------------------------

describe("MatchHeader", () => {
  function renderHeader() {
    return render(
      <MatchHeader
        match={{
          id: matchId,
          teamId: "local",
          opponentName: "BC Nuit",
          date: "2026-10-05",
          playerIds: roster.map((player) => player.id),
          status: "live",
          createdAt: 0,
          finishedAt: null,
          updatedAt: 0,
        }}
        score={0}
      />,
    );
  }

  it("affiche les quatre périodes", () => {
    renderHeader();
    for (const quarter of QUARTERS) {
      expect(
        screen.getByRole("tab", { name: String(quarter) }),
      ).toBeInTheDocument();
    }
  });

  it("marque la période courante", () => {
    useMatchStore.setState({ quarter: 3 });
    renderHeader();
    expect(screen.getByRole("tab", { name: "3" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("change de période au tap", async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByRole("tab", { name: "4" }));

    expect(useMatchStore.getState().quarter).toBe(4);
  });

  it("affiche le score de la période courante", () => {
    renderHeader();
    // Somme des points du roster sur la période affichée.
    expect(screen.getByText(/^0/)).toBeInTheDocument();
  });

  it("affiche le nombre de lancers dus quand il y en a", () => {
    useMatchStore.setState({ pendingFreeThrows: 2 });
    renderHeader();
    expect(screen.getByText("LF 2")).toBeInTheDocument();
  });

  it("déclenche l'annulation", async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByRole("button", { name: /Annuler/ }));

    await waitFor(() => {
      expect(useMatchStore.getState().notice?.text).toBe(
        "Dernière action annulée",
      );
    });
  });
});

// ---------------------------------------------------------------------------

describe("ActivePlayer", () => {
  /**
   * Le bandeau est mono-joueur : il ne reçoit qu'un joueur, ses stats et ses
   * fautes. Deux valeurs suffisent donc, là où le carrousel attendait une Map
   * par joueur — et c'est tout l'intérêt du changement (PLAN.md §11) : plus de
   * Map, donc plus de clé `playerId` dans une fixture, donc plus de statistiques
   * attribuables à un joueur absent du roster.
   */
  function renderBand() {
    return render(
      <ActivePlayer
        player={roster[0]!}
        stats={{ ...aggregateFor([], "a"), points: 7 }}
        fouls={3}
      />,
    );
  }

  it("affiche le prénom du joueur suivi", () => {
    renderBand();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  });

  it("affiche les points de la période", () => {
    renderBand();
    // Le « 7 » apparaît aussi dans le compteur de fautes (« 3/5 »), d'où la
    // recherche sur le contenu exact d'un nœud de texte.
    expect(
      screen.getAllByText((_c, node) => node?.textContent === "7").length,
    ).toBeGreaterThan(0);
  });

  it("affiche les fautes du match entier, pas de la période", () => {
    renderBand();

    // Les fautes viennent de la prop `fouls`, jamais des stats de période :
    // la limite à cinq est par rencontre. Si le compteur repartait à zéro à
    // chaque période, un joueur sorti en Q1 pourrait prendre cinq fautes de
    // plus, et la feuille de match en compterait dix.
    expect(
      screen.getAllByText((_c, node) => node?.textContent === "3/5").length,
    ).toBeGreaterThan(0);
  });

  it("affiche les pastilles de fautes", () => {
    renderBand();
    // Le compteur est rendu en deux nœuds de texte (« 3 » puis « /5 »), donc
    // la recherche se fait sur l'élément parent qui les contient tous les deux.
    const counters = screen.getAllByText((_content, node) =>
      /\d\/5/.test(node?.textContent ?? ""),
    );
    expect(counters.length).toBeGreaterThan(0);
    expect(counters.some((node) => node.textContent === "3/5")).toBe(true);
  });

  it("affiche un tiret quand le joueur n'a pas encore de stats", () => {
    render(<ActivePlayer player={roster[0]!} stats={undefined} fouls={0} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("ne rend rien tant que le joueur n'est pas connu", () => {
    // Le cas est transitoire, pas une erreur : la base n'a pas encore répondu.
    // Rendre une puce vide ferait clignoter l'écran à chaque ouverture.
    const { container } = render(
      <ActivePlayer player={null} stats={undefined} fouls={0} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("n'expose aucun contrôle de sélection", () => {
    // Le bandeau a remplacé un carrousel à onglets. Un `tablist` d'un seul
    // onglet annonce au lecteur d'écran une liste de choix qui n'en est pas
    // une : c'est le régression que ce test verrouille.
    renderBand();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("n'affiche aucun numéro de maillot", () => {
    // Le joueur suivi n'a pas de numéro. Un « — » à sa place afficherait un
    // manque là où il n'y a rien à afficher — et le composant ne rend le numéro
    // dans aucun cas, donc « 4 » ne doit pas apparaître non plus.
    render(
      <ActivePlayer
        player={{ ...roster[0]!, number: null }}
        stats={undefined}
        fouls={0}
      />,
    );
    expect(screen.queryByText(/^\d+$/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------

describe("useMatchData", () => {
  function Probe({ matchId: id }: { matchId: string | null }) {
    const { match, player, stats, fouls, loading } = useMatchData(id);
    if (loading) return <span>chargement</span>;
    return (
      <div>
        <span data-testid="opponent">{match?.opponentName ?? "—"}</span>
        <span data-testid="player">{player?.firstName ?? "—"}</span>
        <span data-testid="points">{stats?.points ?? 0}</span>
        <span data-testid="fouls">{fouls}</span>
      </div>
    );
  }

  it("charge le match et son joueur", async () => {
    render(<Probe matchId={matchId} />);

    await waitFor(() => {
      expect(screen.getByTestId("opponent")).toHaveTextContent("BC Nuit");
    });
    // Un seul joueur est suivi : la sonde lit le joueur, plus son nombre.
    expect(screen.getByTestId("player")).toHaveTextContent("Ada");
  });

  it("agrège les points de la période courante", async () => {
    await repos.actions.append(matchId, [
      {
        kind: "shot",
        playerId: roster[0]!.id,
        quarter: 1,
        value: 3,
        made: true,
      },
    ]);

    render(<Probe matchId={matchId} />);

    await waitFor(() => {
      expect(screen.getByTestId("points")).toHaveTextContent("3");
    });
  });

  it("change d'agrégat quand on change de période", async () => {
    await repos.actions.append(matchId, [
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
    useMatchStore.setState({ quarter: 2 });

    render(<Probe matchId={matchId} />);

    await waitFor(() => {
      expect(screen.getByTestId("points")).toHaveTextContent("3");
    });
  });

  it("ignore les actions annulées", async () => {
    const { actions } = await repos.actions.append(matchId, [
      {
        kind: "shot",
        playerId: roster[0]!.id,
        quarter: 1,
        value: 2,
        made: true,
      },
    ]);
    await repos.actions.voidAction(actions[0]!.id, 1);

    render(<Probe matchId={matchId} />);

    await waitFor(() => {
      expect(screen.getByTestId("points")).toHaveTextContent("0");
    });
  });

  it("cumule les fautes sur tout le match, pas sur la période", async () => {
    // La règle des cinq fautes est par rencontre. Un compteur remis à zéro à
    // chaque quart temps laisserait un joueur sorti en Q1 en prendre cinq de
    // plus en Q2, et la feuille de match en compterait dix.
    await repos.actions.append(matchId, [
      { kind: "foul", playerId: roster[0]!.id, quarter: 1 },
      { kind: "foul", playerId: roster[0]!.id, quarter: 2 },
    ]);
    useMatchStore.setState({ quarter: 2 });

    render(<Probe matchId={matchId} />);

    await waitFor(() => {
      // Q2 ne contient qu'une faute, le total du match en compte deux.
      expect(screen.getByTestId("fouls")).toHaveTextContent("2");
    });
  });

  it("renvoie un état vide sans identifiant de match", async () => {
    render(<Probe matchId={null} />);

    await waitFor(() => {
      expect(screen.getByTestId("opponent")).toHaveTextContent("—");
    });
    expect(screen.getByTestId("player")).toHaveTextContent("—");
  });
});

// ---------------------------------------------------------------------------

describe("FreeThrowSheet", () => {
  function renderSheet(due = 2) {
    useMatchStore.setState({ pendingFreeThrows: due, sheetGroupId: "g1" });
    return render(
      <FreeThrowSheet
        playerId={roster[0]!.id}
        quarter={1}
        parentGroupId="g1"
      />,
    );
  }

  it("affiche une ligne par lancer dû", () => {
    renderSheet(3);
    expect(screen.getByText("LF1")).toBeInTheDocument();
    expect(screen.getByText("LF3")).toBeInTheDocument();
    expect(screen.queryByText("LF4")).not.toBeInTheDocument();
  });

  it("indique le nombre de lancers restants", () => {
    renderSheet(2);
    expect(screen.getByRole("dialog")).toHaveAccessibleName(
      "Lancers libres · 2 à jouer",
    );
  });

  it("enregistre un lancer réussi", async () => {
    const user = userEvent.setup();
    renderSheet(2);

    await user.click(screen.getByRole("button", { name: "Lancer 1 réussi" }));

    await waitFor(async () => {
      const actions = await repos.actions.listByMatch(matchId);
      expect(actions[0]).toMatchObject({
        kind: "free_throw",
        made: true,
        playerId: roster[0]!.id,
      });
    });
  });

  it("enregistre un lancer raté", async () => {
    const user = userEvent.setup();
    renderSheet(2);

    await user.click(screen.getByRole("button", { name: "Lancer 1 raté" }));

    await waitFor(async () => {
      const actions = await repos.actions.listByMatch(matchId);
      expect(actions[0]).toMatchObject({ kind: "free_throw", made: false });
    });
  });

  it("rattache le lancer au groupe de la faute", async () => {
    const user = userEvent.setup();
    renderSheet(2);

    await user.click(screen.getByRole("button", { name: "Lancer 1 réussi" }));

    await waitFor(async () => {
      const actions = await repos.actions.listByMatch(matchId);
      expect(actions[0]?.groupId).toBe("g1");
    });
  });

  it("marque le bouton pressé", async () => {
    const user = userEvent.setup();
    renderSheet(2);

    await user.click(screen.getByRole("button", { name: "Lancer 2 réussi" }));

    expect(
      screen.getByRole("button", { name: "Lancer 2 réussi" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("décompte les lancers restants", async () => {
    const user = userEvent.setup();
    renderSheet(2);

    await user.click(screen.getByRole("button", { name: "Lancer 1 réussi" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toHaveAccessibleName(
        "Lancers libres · 1 à jouer",
      );
    });
  });

  it("ferme la fiche", async () => {
    const user = userEvent.setup();
    renderSheet(2);

    await user.click(screen.getByRole("button", { name: /Terminer|Terminé/ }));

    expect(useMatchStore.getState().sheet).toBeNull();
  });

  it("permet d'annuler la fiche entière", async () => {
    const user = userEvent.setup();
    renderSheet(2);

    // Une série de lancers s'annule d'un bloc : c'est le groupe parent qui relie
    // la faute et les lancers.
    const { groupId } = await repos.actions.append(matchId, [
      {
        kind: "shot",
        playerId: roster[0]!.id,
        quarter: 1,
        groupId: "g1",
        value: 2,
        made: false,
        fouled: true,
      },
    ]);
    await user.click(screen.getByRole("button", { name: "Lancer 1 réussi" }));

    await waitFor(async () => {
      const voided = await repos.actions.voidGroup(groupId, 99);
      expect(voided.length).toBe(2);
    });
  });
});

// ---------------------------------------------------------------------------

describe("Sheet", () => {
  it("ne rend rien quand elle est fermée", () => {
    const { container } = render(
      <Sheet open={false} title="Titre" onClose={() => {}}>
        contenu
      </Sheet>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("affiche le titre et le contenu", () => {
    render(
      <Sheet open title="Titre" onClose={() => {}}>
        <p>contenu</p>
      </Sheet>,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("contenu")).toBeInTheDocument();
  });

  it("ferme via le bouton", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Sheet open title="Titre" onClose={onClose}>
        <p>contenu</p>
      </Sheet>,
    );

    await user.click(screen.getByRole("button", { name: "Fermer" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ne se ferme pas au clic sur le fond", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Sheet open title="Titre" onClose={onClose}>
        <p>contenu</p>
      </Sheet>,
    );

    // Une annulation accidentelle ferait perdre un combo entier.
    await user.click(document.querySelector(".bg-black\\/60")!);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("affiche le pied fourni", () => {
    render(
      <Sheet open title="Titre" onClose={() => {}} footer={<p>pied</p>}>
        <p>contenu</p>
      </Sheet>,
    );
    expect(screen.getByText("pied")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------

describe("Toast", () => {
  it("ne rend rien sans message", () => {
    const { container } = render(<Toast message={null} onDismiss={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("annonce le message au lecteur d'écran", () => {
    render(
      <Toast
        message={{ id: 1, text: "Action annulée" }}
        onDismiss={() => {}}
      />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Action annulée");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("propose « Réfaire » quand un rappel est fourni", () => {
    render(
      <Toast
        message={{ id: 1, text: "Action annulée", onUndo: () => {} }}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Réfaire" })).toBeInTheDocument();
  });

  it("exécute le rappel et ferme", async () => {
    const user = userEvent.setup();
    const onUndo = vi.fn();
    const onDismiss = vi.fn();
    render(
      <Toast
        message={{ id: 1, text: "Action annulée", onUndo }}
        onDismiss={onDismiss}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Réfaire" }));

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("utilise un libellé personnalisé", () => {
    render(
      <Toast
        message={{ id: 1, text: "x", onUndo: () => {}, undoLabel: "Annuler" }}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Annuler" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------

describe("Badges", () => {
  it("remplit les pastilles de fautes", () => {
    const { container } = render(<FoulDots fouls={3} />);
    // 5 pastilles, une par place ; les 3 premières sont colorées.
    expect(container.querySelectorAll("span.rounded-full")).toHaveLength(5);
    expect(screen.getByText(/3 fautes sur 5/)).toBeInTheDocument();
  });

  it("affiche le compteur si demandé", () => {
    render(<FoulDots fouls={5} showCount />);
    const counter = screen.getAllByText(
      (_content, node) => node?.textContent === "5/5",
    );
    expect(counter.length).toBeGreaterThan(0);
  });

  it("singularise le libellé d'une seule faute", () => {
    render(<FoulDots fouls={1} />);
    expect(screen.getByText(/1 faute sur 5/)).toBeInTheDocument();
  });

  it("affiche un tiret sans stats", () => {
    render(<PlayerBadges stats={undefined} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("n'affiche rebonds et passes que s'ils sont non nuls", () => {
    const { container } = render(
      <PlayerBadges
        stats={{
          ...aggregateFor([], "p1"),
          points: 8,
          reboundsDefensive: 4,
          assists: 2,
        }}
      />,
    );
    expect(container).toHaveTextContent("84R");
    expect(container).toHaveTextContent("2P");
  });

  it("masque les statistiques à zéro", () => {
    const { container } = render(
      <PlayerBadges stats={aggregateFor([], "p1")} />,
    );
    expect(container).toHaveTextContent("0");
    expect(container.textContent).not.toContain("R");
  });
});

// ---------------------------------------------------------------------------

describe("Flash — acquittement de saisie", () => {
  it("ne rend rien sans message", () => {
    const { container } = render(<Flash message={null} onDismiss={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("annonce l'action enregistrée", () => {
    render(
      <Flash
        message={{ id: 1, text: "Panier 2 pts", missed: false }}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Panier 2 pts");
  });

  it("distingue visuellement le raté du panier", () => {
    const { unmount } = render(
      <Flash
        message={{ id: 1, text: "Tir 2 pts raté", missed: true }}
        onDismiss={() => {}}
      />,
    );
    // Un tir raté ne change ni le score ni les pastilles : sans traitement
    // visuel distinct, le coach ne peut pas savoir si son appui long est passé.
    expect(screen.getByRole("status").className).toContain("text-missed");
    unmount();

    render(
      <Flash
        message={{ id: 2, text: "Panier 2 pts", missed: false }}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByRole("status").className).toContain("text-made");
  });

  it("n'intercepte pas les appuis sur la grille du dessous", () => {
    const { container } = render(
      <Flash
        message={{ id: 1, text: "Panier 2 pts", missed: false }}
        onDismiss={() => {}}
      />,
    );
    // Sans `pointer-events-none`, acquitter une saisie en masquerait une autre.
    expect(container.querySelector(".pointer-events-none")).not.toBeNull();
  });

  it("disparaît après la durée", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onDismiss = vi.fn();
    render(
      <Flash
        message={{ id: 1, text: "Panier 2 pts", missed: false }}
        duration={900}
        onDismiss={onDismiss}
      />,
    );

    await vi.advanceTimersByTimeAsync(950);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe("describeAction", () => {
  const base = {
    id: "a1",
    matchId: "m1",
    playerId: "p1",
    seq: 0,
    quarter: 1,
    voidedAt: null,
  } as const;

  it("nomme un panier", () => {
    expect(
      describeAction({ ...base, kind: "shot", value: 2, made: true }),
    ).toBe("Panier 2 pts");
  });

  it("nomme un tir raté", () => {
    expect(
      describeAction({ ...base, kind: "shot", value: 3, made: false }),
    ).toBe("Tir 3 pts raté");
  });

  it("nomme un panneau", () => {
    expect(
      describeAction({
        ...base,
        kind: "shot",
        value: 3,
        made: true,
        fouled: true,
      }),
    ).toBe("Panneau 3 pts + faute");
  });

  it("nomme un tir raté suivi d'une faute", () => {
    expect(
      describeAction({
        ...base,
        kind: "shot",
        value: 2,
        made: false,
        fouled: true,
      }),
    ).toBe("Tir 2 pts raté + faute");
  });

  it("distingue un lancer réussi d'un lancer raté", () => {
    expect(describeAction({ ...base, kind: "free_throw", made: true })).toBe(
      "LF réussi",
    );
    expect(describeAction({ ...base, kind: "free_throw", made: false })).toBe(
      "LF raté",
    );
  });

  it("distingue les deux rebonds", () => {
    expect(
      describeAction({ ...base, kind: "rebound", side: "offensive" }),
    ).toBe("Rebond offensif");
    expect(
      describeAction({ ...base, kind: "rebound", side: "defensive" }),
    ).toBe("Rebond défensif");
  });

  it("couvre les autres actions", () => {
    expect(describeAction({ ...base, kind: "foul" })).toBe("Faute");
    expect(describeAction({ ...base, kind: "assist" })).toBe("Passe");
    expect(describeAction({ ...base, kind: "turnover" })).toBe(
      "Perte de balle",
    );
    expect(describeAction({ ...base, kind: "steal" })).toBe("Interception");
    expect(describeAction({ ...base, kind: "block" })).toBe("Contre");
    expect(describeAction({ ...base, kind: "substitution" })).toBe(
      "Remplacement",
    );
  });
});

describe("tirs affichés dans le carrousel", () => {
  it("affiche réussis/tentés, ce qui rend le raté visible", () => {
    const { container } = render(
      <PlayerBadges
        stats={{ ...aggregateFor([], "p1"), points: 4, fgm2: 2, fga2: 5 }}
      />,
    );
    // Un appui long ne change que `fga` : sans ce ratio, rien ne bougeait à
    // l'écran et le coach ne pouvait pas confirmer son geste.
    expect(container).toHaveTextContent("2/5");
  });

  it("affiche 0/1 dès la première tentative ratée", () => {
    const { container } = render(
      <PlayerBadges
        stats={{ ...aggregateFor([], "p1"), points: 0, fga2: 1 }}
      />,
    );
    expect(container).toHaveTextContent("0/1");
  });

  it("n'affiche rien quand le joueur n'a pas tiré", () => {
    const { container } = render(
      <PlayerBadges stats={aggregateFor([], "p1")} />,
    );
    expect(container.textContent).not.toContain("/");
  });
});
