import Dexie from "dexie";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setDb, setRepos, SpaceBunnyDB } from "@/data";
import { createRepositories, type Repositories } from "@/data/repositories";
import { LONG_PRESS_MS, usePress } from "@/ui/usePress";
import { ActionGrid, AdvancedStatsBar } from "@/features/match/ActionGrid";
import { CombosBar } from "@/features/match/CombosBar";
import { useMatchStore } from "@/features/match/store";
import type { ActionDraft } from "@/domain/rules";

/**
 * Tests de la saisie tactile.
 *
 * Le centre de gravité n'est pas le rendu mais le **geste** : tap vs appui de
 * 400 ms, et ce qu'ils écrivent réellement en base. C'est ce contrat que le plan
 * §4 pose, et c'est le seul endroit où une erreur produirait des statistiques
 * fausses sans qu'on s'en aperçoive.
 */

let counter = 0;

let database: SpaceBunnyDB;
let repos: Repositories;
let matchId: string;

beforeEach(async () => {
  counter += 1;
  database = new SpaceBunnyDB(`space-bunny-press-${counter}`);
  await database.open();
  setDb(database);
  setRepos(createRepositories(database));

  const store = createRepositories(database);
  const team = await store.teams.ensureLocal();
  await store.players.createMany(team.id, [
    { firstName: "Ada", lastName: "Lovelace", number: 4 },
    { firstName: "Alan", lastName: "Turing", number: 7 },
  ]);
  const match = await store.matches.create(team.id, {
    opponentName: "BC Nuit",
    date: "2026-10-05",
  });
  matchId = match.id;

  repos = store;
  useMatchStore.getState().openMatch(matchId, "p1");
  useMatchStore.setState({ revision: 0, notice: null, quarter: 1 });
});

afterEach(async () => {
  setRepos(null);
  setDb(null);
  database.close();
  await Dexie.delete(database.name);
});

// ---------------------------------------------------------------------------
// Le geste
// ---------------------------------------------------------------------------

function PressHarness({
  onTap,
  onLongPress,
}: {
  onTap?: () => void;
  onLongPress?: () => void;
}) {
  const { handlers, isPressed } = usePress({ onTap, onLongPress });
  return (
    <button type="button" data-pressed={isPressed} {...handlers}>
      cible
    </button>
  );
}

/**
 * Exécute un scénario de geste avec des minuteurs virtuels.
 *
 * `shouldAdvanceTime: true` est indispensable : sans lui, RTL et React utilisent
 * eux aussi `setTimeout`, qui n'avance plus, et le test se fige jusqu'au
 * timeout. Le `finally` rétablit les vrais minuteurs même si l'assertion échoue —
 * sinon les minuteurs virtuels fuient sur les tests suivants, qui expirent tous
 * sans raison apparente.
 */
const fireEventRef = { fireEvent };

async function withTimers(
  run: (advance: (ms: number) => Promise<void>) => Promise<void>,
): Promise<void> {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    await run(async (ms) => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  } finally {
    vi.useRealTimers();
  }
}

function pressDown(button: HTMLElement, isPrimary = true): void {
  const { fireEvent } = fireEventRef;
  fireEvent.pointerDown(button, { isPrimary });
}

describe("usePress — tap contre appui long", () => {
  it("déclenche le tap au relâche", async () => {
    const onTap = vi.fn();
    const user = userEvent.setup();
    render(<PressHarness onTap={onTap} />);

    await user.click(screen.getByRole("button"));
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("ne déclenche pas de tap avant le relâchement", async () => {
    const onTap = vi.fn();
    render(<PressHarness onTap={onTap} />);

    await withTimers(async () => {
      pressDown(screen.getByRole("button"));
      expect(onTap).not.toHaveBeenCalled();
      fireEventRef.fireEvent.pointerUp(screen.getByRole("button"));
      expect(onTap).toHaveBeenCalledTimes(1);
    });
  });

  it("déclenche l'appui long après 400 ms", async () => {
    const onLongPress = vi.fn();
    render(<PressHarness onLongPress={onLongPress} />);

    await withTimers(async (advance) => {
      pressDown(screen.getByRole("button"));
      await advance(LONG_PRESS_MS - 50);
      expect(onLongPress).not.toHaveBeenCalled();

      await advance(60);
      expect(onLongPress).toHaveBeenCalledTimes(1);
    });
  });

  it("n'enregistre PAS de tap après un appui long", async () => {
    const onTap = vi.fn();
    const onLongPress = vi.fn();
    render(<PressHarness onTap={onTap} onLongPress={onLongPress} />);

    await withTimers(async (advance) => {
      const button = screen.getByRole("button");
      pressDown(button);
      await advance(LONG_PRESS_MS + 20);
      fireEventRef.fireEvent.pointerUp(button);

      // Sans cela, un appui de 600 ms compterait un panier *et* un raté : le
      // score serait faux et rien ne le signalerait.
      expect(onLongPress).toHaveBeenCalledTimes(1);
      expect(onTap).not.toHaveBeenCalled();
    });
  });

  it("annule l'appui long si le pointeur quitte la cible", async () => {
    const onLongPress = vi.fn();
    const onTap = vi.fn();
    render(<PressHarness onTap={onTap} onLongPress={onLongPress} />);

    await withTimers(async (advance) => {
      const button = screen.getByRole("button");
      pressDown(button);
      await advance(100);
      // Un glissement vers le bas pour scroller ne doit pas valider un tir.
      fireEventRef.fireEvent.pointerLeave(button);
      await advance(LONG_PRESS_MS + 20);

      expect(onLongPress).not.toHaveBeenCalled();
    });
  });

  it("n'enregistre rien si le pointeur est annulé", async () => {
    const onTap = vi.fn();
    const onLongPress = vi.fn();
    render(<PressHarness onTap={onTap} onLongPress={onLongPress} />);

    await withTimers(async () => {
      const button = screen.getByRole("button");
      pressDown(button);
      fireEventRef.fireEvent.pointerCancel(button);
      fireEventRef.fireEvent.pointerUp(button);

      expect(onTap).not.toHaveBeenCalled();
      expect(onLongPress).not.toHaveBeenCalled();
    });
  });

  it("ignore les pointeurs secondaires", async () => {
    const onTap = vi.fn();
    render(<PressHarness onTap={onTap} />);

    const button = screen.getByRole("button");
    const { fireEvent } = await import("@testing-library/react");
    // Second doigt posé en même temps que le premier : ne doit rien créer.
    fireEvent.pointerDown(button, { isPrimary: false });
    fireEvent.pointerUp(button);

    expect(onTap).not.toHaveBeenCalled();
  });

  it("neutralise le menu contextuel", async () => {
    const user = userEvent.setup();
    render(<PressHarness />);

    const button = screen.getByRole("button");
    // iOS ouvre son menu contextuel et avale l'appui long si on ne l'empêche pas.
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await user.click(button);
  });

  it("indique l'état pressé pour le retour visuel", async () => {
    render(<PressHarness />);
    const button = screen.getByRole("button");

    fireEventRef.fireEvent.pointerDown(button, { isPrimary: true });
    await waitFor(() => {
      expect(button).toHaveAttribute("data-pressed", "true");
    });

    fireEventRef.fireEvent.pointerUp(button);
    await waitFor(() => {
      expect(button).toHaveAttribute("data-pressed", "false");
    });
  });

  it("ne déclenche que le tap quand aucun appui long n'est défini", async () => {
    const onTap = vi.fn();
    render(<PressHarness onTap={onTap} />);

    await withTimers(async (advance) => {
      const button = screen.getByRole("button");
      pressDown(button);
      await advance(2000);
      fireEventRef.fireEvent.pointerUp(button);

      // Le minuteur n'est même pas armé : pas de minuteur orphelin à nettoyer.
      expect(onTap).toHaveBeenCalledTimes(1);
    });
  });
});

// ---------------------------------------------------------------------------
// La grille d'actions
// ---------------------------------------------------------------------------

/** Enregistre comme le fait l'écran, via le store. */
async function recordThrough(drafts: readonly ActionDraft[]) {
  return useMatchStore.getState().record(drafts, "neutral");
}

/**
 * Appui long de bout en bout, minuteurs compris.
 *
 * `advanceTimersByTimeAsync` plutôt que `advanceTimersByTime` : il vide aussi la
 * file de microtâches, donc l'écriture IndexedDB — qui est asynchrone — a le
 * temps d'aboutir avant l'assertion.
 */
async function longPress(button: HTMLElement): Promise<void> {
  await withTimers(async (advance) => {
    fireEvent.pointerDown(button, { isPrimary: true });
    await advance(LONG_PRESS_MS + 20);
    fireEvent.pointerUp(button);
  });
}

describe("ActionGrid", () => {
  function renderGrid() {
    return render(
      <ActionGrid
        playerId="p1"
        onRecord={async (drafts) => {
          await recordThrough(drafts);
        }}
      />,
    );
  }

  it("écrit un tir à 2 points réussi au tap", async () => {
    const user = userEvent.setup();
    renderGrid();

    await user.click(screen.getByRole("button", { name: /2 points/ }));

    // `user.click` attend la fin des handlers synchrones, pas la promesse
    // d'écriture que le gestionnaire lance sans l'attendre : c'est le
    // comportement réel du composant, il faut donc attendre la base.
    await waitFor(async () => {
      expect(await repos.actions.countByMatch(matchId)).toBe(1);
    });

    const actions = await repos.actions.listByMatch(matchId);
    expect(actions[0]).toMatchObject({
      kind: "shot",
      value: 2,
      made: true,
      quarter: 1,
      playerId: "p1",
    });
  });

  it("écrit un tir à 3 points raté à l'appui long", async () => {
    renderGrid();

    await longPress(screen.getByRole("button", { name: /3 points/ }));

    const actions = await repos.actions.listByMatch(matchId);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ value: 3, made: false });
  });

  it("écrit une faute simple", async () => {
    const user = userEvent.setup();
    renderGrid();

    await user.click(screen.getByRole("button", { name: /^Faute 1 sur 5$/ }));

    await waitFor(async () => {
      const actions = await repos.actions.listByMatch(matchId);
      expect(actions[0]?.kind).toBe("foul");
    });
  });

  it("écrit un lancer raté à l'appui long", async () => {
    renderGrid();

    await longPress(screen.getByRole("button", { name: /Lancer libre/ }));

    const actions = await repos.actions.listByMatch(matchId);
    expect(actions[0]).toMatchObject({ kind: "free_throw", made: false });
  });

  it("désactive toutes les cibles sans joueur verrouillé", () => {
    render(<ActionGrid playerId="" disabled onRecord={async () => {}} />);

    expect(screen.getByRole("button", { name: /2 points/ })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /^Faute 1 sur 5$/ }),
    ).toBeDisabled();
  });
});

describe("AdvancedStatsBar", () => {
  it("écrit un rebond offensif", async () => {
    const user = userEvent.setup();
    render(
      <AdvancedStatsBar
        playerId="p1"
        disabled={false}
        onRecord={async (drafts) => {
          await recordThrough(drafts);
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Rebond offensif" }));

    await waitFor(async () => {
      const actions = await repos.actions.listByMatch(matchId);
      expect(actions[0]).toMatchObject({ kind: "rebound", side: "offensive" });
    });
  });

  it("écrit une interception", async () => {
    const user = userEvent.setup();
    render(
      <AdvancedStatsBar
        playerId="p1"
        disabled={false}
        onRecord={async (drafts) => {
          await recordThrough(drafts);
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Interception" }));

    await waitFor(async () => {
      const actions = await repos.actions.listByMatch(matchId);
      expect(actions[0]).toMatchObject({ kind: "steal", quarter: 1 });
    });
  });

  it("couvre les six statistiques avancées", async () => {
    const user = userEvent.setup();
    const names = [
      "Rebond offensif",
      "Rebond défensif",
      "Passe décisive",
      "Perte de balle",
      "Contre",
      "Interception",
    ];

    render(
      <AdvancedStatsBar
        playerId="p1"
        disabled={false}
        onRecord={async (drafts) => {
          await recordThrough(drafts);
        }}
      />,
    );

    for (const [index, name] of names.entries()) {
      await user.click(screen.getByRole("button", { name }));
      // Le compte exact, pas « > 0 » : sinon l'attente passe à la deuxième
      // itération grâce à l'écriture précédente et la dernière n'est jamais
      // vérifiée.
      await waitFor(async () => {
        expect(await repos.actions.countByMatch(matchId)).toBe(index + 1);
      });
    }

    const actions = await repos.actions.listByMatch(matchId);
    expect(actions).toHaveLength(6);

    // Chaque cible produit bien une catégorie distincte : pas deux boutons
    // câblés sur le même `kind`. Les deux rebonds font exception — ils ne
    // diffèrent que par `side`, ce que le test vérifie séparément.
    expect(new Set(actions.map((action) => action.kind)).size).toBe(5);
    expect(
      actions.filter((action) => action.kind === "rebound").map((a) => a.side),
    ).toEqual(["offensive", "defensive"]);
  });
});

// ---------------------------------------------------------------------------
// Le bandeau de combos
// ---------------------------------------------------------------------------

describe("CombosBar", () => {
  function renderCombos() {
    return render(
      <CombosBar
        playerId="p1"
        disabled={false}
        onRecord={async (drafts, kind) =>
          useMatchStore.getState().record(drafts, kind)
        }
      />,
    );
  }

  it("écrit un and-1 à 2 points en UNE seule action", async () => {
    const user = userEvent.setup();
    renderCombos();

    await user.click(
      screen.getByRole("button", { name: /Panier 2 points \+ faute/ }),
    );

    await waitFor(async () => {
      expect(await repos.actions.countByMatch(matchId)).toBe(1);
    });

    const actions = await repos.actions.listByMatch(matchId);
    // Une action, pas deux : sinon la faute serait comptée deux fois.
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      kind: "shot",
      value: 2,
      made: true,
      fouled: true,
    });
  });

  it("écrit un and-1 à 3 points", async () => {
    const user = userEvent.setup();
    renderCombos();

    await user.click(
      screen.getByRole("button", { name: /Panier 3 points \+ faute/ }),
    );

    await waitFor(async () => {
      const actions = await repos.actions.listByMatch(matchId);
      expect(actions[0]).toMatchObject({ value: 3, made: true, fouled: true });
    });
  });

  it("ouvre la fiche d'un seul lancer après un and-1", async () => {
    const user = userEvent.setup();
    renderCombos();

    await user.click(
      screen.getByRole("button", { name: /Panier 2 points \+ faute/ }),
    );

    await waitFor(() => {
      expect(useMatchStore.getState().sheet).toBe("free-throws");
    });
    // Un and-1 ne donne qu'un lancer, quelle que soit la valeur du panier.
    expect(useMatchStore.getState().pendingFreeThrows).toBe(1);
  });

  it("rattache le lancer de l'and-1 au groupe du panier", async () => {
    const user = userEvent.setup();
    renderCombos();

    await user.click(
      screen.getByRole("button", { name: /Panier 2 points \+ faute/ }),
    );
    const sheetGroupId = useMatchStore.getState().sheetGroupId;

    // Sans ce lien, annuler ne retirait que le lancer, laissant un panier
    // marqué sans la faute qui l qui va avec.
    const written = await useMatchStore.getState().record(
      [
        {
          kind: "free_throw",
          playerId: "p1",
          quarter: 1,
          groupId: sheetGroupId ?? "",
          made: true,
        },
      ],
      "made",
    );

    expect(written[0]?.groupId).toBe(sheetGroupId);
  });

  it("ouvre la fiche de 2 lancers après un tir raté + faute", async () => {
    const user = userEvent.setup();
    renderCombos();

    await user.click(screen.getByRole("button", { name: /2 lancers/ }));

    await waitFor(() => {
      expect(useMatchStore.getState().sheet).toBe("free-throws");
    });
    expect(useMatchStore.getState().pendingFreeThrows).toBe(2);
  });

  it("ouvre la fiche de 3 lancers après un tir à 3 pts raté + faute", async () => {
    const user = userEvent.setup();
    renderCombos();

    await user.click(screen.getByRole("button", { name: /3 lancers/ }));

    await waitFor(() => {
      expect(useMatchStore.getState().pendingFreeThrows).toBe(3);
    });
  });

  it("n'écrit pas de tentative pour le tir raté + faute", async () => {
    const user = userEvent.setup();
    renderCombos();

    await user.click(screen.getByRole("button", { name: /2 lancers/ }));

    await waitFor(async () => {
      expect(await repos.actions.countByMatch(matchId)).toBe(1);
    });

    // Règle non-FIBA assumée (PLAN.md §1) : le tir n'existe pas dans les stats,
    // seule la faute est comptée.
    const actions = await repos.actions.listByMatch(matchId);
    expect(actions[0]?.made).toBe(false);
    const { aggregateFor } = await import("@/domain/stats");
    const stats = aggregateFor(actions, "p1");
    expect(stats.fouls).toBe(1);
    expect(stats.fga2).toBe(0);
    expect(stats.points).toBe(0);
  });

  it("rattache les lancers au groupe de la faute", async () => {
    const user = userEvent.setup();
    renderCombos();

    await user.click(screen.getByRole("button", { name: /2 lancers/ }));
    const sheetGroupId = useMatchStore.getState().sheetGroupId;

    const written = await useMatchStore.getState().record(
      [
        {
          kind: "free_throw",
          playerId: "p1",
          quarter: 1,
          groupId: sheetGroupId ?? "",
          made: true,
        },
      ],
      "made",
    );

    expect(written[0]?.groupId).toBe(sheetGroupId);
  });
});

// ---------------------------------------------------------------------------

describe("ActionGrid — limite de fautes", () => {
  function renderGrid(fouls = 0) {
    return render(
      <ActionGrid
        playerId="p1"
        playerFouls={fouls}
        onRecord={async (drafts) => {
          await recordThrough(drafts);
        }}
      />,
    );
  }

  it("reste actif tant que le joueur n'est pas sorti", () => {
    renderGrid(4);
    expect(screen.getByRole("button", { name: "Faute 5 sur 5" })).toBeEnabled();
  });

  it("se bloque à la cinquième faute", () => {
    renderGrid(5);
    // Le coach ne peut pas commettre une sixième faute : le bouton est mort,
    // sinon le décompte compterait une faute impossible.
    expect(screen.getByRole("button", { name: /joueur sorti/ })).toBeDisabled();
  });

  it("annonce pourquoi le bouton est bloqué", () => {
    renderGrid(5);
    // Sans motif explicite, le coach conclut que l'app a planté.
    expect(
      screen.getByRole("button", {
        name: "Faute — 5 fautes, joueur sorti",
      }),
    ).toBeDisabled();
  });

  it("n'écrit aucune faute au-delà de la limite", async () => {
    const user = userEvent.setup();
    renderGrid(5);

    await user.click(screen.getByRole("button", { name: /joueur sorti/ }));

    expect(await repos.actions.countByMatch(matchId)).toBe(0);
  });

  it("garde les autres cibles actives quand la faute est bloquée", () => {
    renderGrid(5);
    // Seule la faute est impossible : le joueur peut encore tirer.
    expect(screen.getByRole("button", { name: /2 points/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Lancer libre/ })).toBeEnabled();
  });

  it("affiche le compteur de fautes sur le bouton", () => {
    renderGrid(2);
    expect(screen.getByText("3/5")).toBeInTheDocument();
  });
});
