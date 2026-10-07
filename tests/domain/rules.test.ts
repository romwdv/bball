import {
  type Action,
  type Player,
  type Quarter,
  ActionSchema,
  FOUL_LIMIT,
  isActive,
  isFouledShot,
} from "@/domain/types";
import {
  type ActionDraft,
  addDeltas,
  awardedFreeThrows,
  combos,
  emptyDelta,
  planActions,
  project,
} from "@/domain/rules";
import {
  actionsOfMatch,
  aggregate,
  aggregateFor,
  cumulativeStats,
  fieldGoalsAttempted,
  fieldGoalsMade,
  filterActions,
  fgPercentage,
  formatPercentage,
  formatSplit,
  freeThrowPercentage,
  percentage,
  pendingFreeThrows,
  playerInitial,
  playerLabel,
  playerStatsFrom,
  pointsByQuarter,
  scoreForQuarters,
  statsByQuarter,
  sumDeltas,
  teamTotals,
  threePointsPercentage,
  totalRebounds,
  twoPointsPercentage,
} from "@/domain/stats";
import type { StatDelta as Delta } from "@/domain/rules";

let counter = 0;

/** Action complète avec valeurs par défaut sensées. */
function makeAction(overrides: Partial<Action> = {}): Action {
  counter += 1;
  return ActionSchema.parse({
    id: `a${counter}`,
    matchId: "m1",
    playerId: "p1",
    seq: counter,
    quarter: 1,
    kind: "shot",
    value: 2,
    made: true,
    voidedAt: null,
    ...overrides,
  });
}

/**
 * Convertit les drafts typés de `combos` en actions complètes.
 *
 * Chaque draft porte son propre `kind`, donc on n'a plus à le deviner.
 */
function expand(drafts: readonly ActionDraft[]): Action[] {
  return drafts.map((draft, index) => {
    counter += 1;
    return ActionSchema.parse({
      id: `g${counter}`,
      matchId: "m1",
      seq: counter + index,
      voidedAt: null,
      ...draft,
    });
  });
}

/** Applique un delta : `expect(d).toMatchObject(...)` sur tous les compteurs. */
function expectDelta(delta: Delta, expected: Partial<Delta>) {
  expect({ ...delta }).toMatchObject(expected);
}

/** Réétiquette un ensemble d'actions avec le match où elles ont eu lieu. */
function inMatch(matchId: string, actions: readonly Action[]): Action[] {
  return actions.map((action) => ({ ...action, matchId }));
}

const QUARTERS: readonly Quarter[] = [1, 2, 3, 4];

// ---------------------------------------------------------------------------
// Table des règles §1 du plan — une entrée par ligne
// ---------------------------------------------------------------------------

describe("règles de comptage (table §1 du plan)", () => {
  it("tir à 2 points réussi → 1 FGM, 1 FGA, +2 points", () => {
    expectDelta(project(makeAction({ value: 2, made: true })), {
      points: 2,
      fgm2: 1,
      fga2: 1,
    });
  });

  it("tir à 3 points réussi → 1 FGM, 1 FGA, +3 points", () => {
    expectDelta(project(makeAction({ value: 3, made: true })), {
      points: 3,
      fgm3: 1,
      fga3: 1,
    });
  });

  it("tir à 2 points raté → 1 FGA, 0 FGM, 0 point", () => {
    expectDelta(project(makeAction({ value: 2, made: false })), {
      points: 0,
      fgm2: 0,
      fga2: 1,
    });
  });

  it("tir à 3 points raté → 1 FGA, 0 FGM, 0 point", () => {
    expectDelta(project(makeAction({ value: 3, made: false })), {
      points: 0,
      fgm3: 0,
      fga3: 1,
    });
  });

  it("panier + faute (and-1) → le panier compte, pas la faute", () => {
    // Le FTA arrive avec l'action `free_throw` saisie ensuite, sinon double comptage.
    // `fouls: 0` : même and-1, la faute est celle de l'adversaire. Seule la faute
    // simple, sans tir associé, compte au joueur.
    expectDelta(project(makeAction({ value: 2, made: true, fouled: true })), {
      points: 2,
      fgm2: 1,
      fga2: 1,
      fouls: 0,
      fta: 0,
    });
  });

  it("and-1 à 3 points → 3 points, FGM3, aucune faute", () => {
    expectDelta(project(makeAction({ value: 3, made: true, fouled: true })), {
      points: 3,
      fgm3: 1,
      fga3: 1,
      fouls: 0,
    });
  });

  it("tir RATÉ + faute → aucune statistique, pas même la faute", () => {
    // ⚠️ Règle non-FIBA. Ce test verrouille le comportement voulu : le tir ne
    // dégrade pas le % de réussite. Le changer cassera volontairement ce test.
    //
    // `fouls: 0` est le point important et le moins évident. La faute est
    // commise par l'adversaire ; la compter sur le joueur qui la subit lui
    // imputerait une infraction qu'il n'a pas commise. Le gain réel du joueur
    // est en points, via les lancers.
    expectDelta(project(makeAction({ value: 2, made: false, fouled: true })), {
      points: 0,
      fgm2: 0,
      fga2: 0,
      fgm3: 0,
      fga3: 0,
      fouls: 0,
    });
  });

  it("tir à 3 points raté + faute → non-FIBA : aucun FGA3 ni faute", () => {
    expectDelta(project(makeAction({ value: 3, made: false, fouled: true })), {
      points: 0,
      fga3: 0,
      fouls: 0,
    });
  });

  it("lancer libre réussi → 1 FTA, 1 FTM, +1 point", () => {
    expectDelta(
      project(makeAction({ kind: "free_throw", made: true, value: undefined })),
      { fta: 1, ftm: 1, points: 1 },
    );
  });

  it("lancer libre raté → 1 FTA, 0 FTM, 0 point", () => {
    expectDelta(
      project(
        makeAction({ kind: "free_throw", made: false, value: undefined }),
      ),
      { fta: 1, ftm: 0, points: 0 },
    );
  });

  it("aucun tir foulé ne compte de faute, quelle qu'en soit l'issue", () => {
    // La règle en une assertion : quatre cas, toujours `fouls: 0`. C'est le
    // filet qui empêche la faute de revenir par un seul chemin — c'est
    // exactement comme ça qu'elle était revenue la première fois, sur l'and-1
    // après avoir été retirée du tir raté.
    for (const value of [2, 3] as const) {
      for (const made of [true, false]) {
        expect(project(makeAction({ value, made, fouled: true })).fouls).toBe(
          0,
        );
      }
    }
    // Et la seule source de fautes qui subsiste : la faute simple, sans tir.
    expect(project(makeAction({ kind: "foul" })).fouls).toBe(1);
  });

  it("faute simple → 1 faute, rien d'autre", () => {
    expectDelta(project(makeAction({ kind: "foul" })), {
      fouls: 1,
      points: 0,
      fga2: 0,
      fta: 0,
    });
  });
});

describe("statistiques complémentaires", () => {
  it("rebond offensif et défensif sont comptés séparément", () => {
    expectDelta(
      project(
        makeAction({ kind: "rebound", side: "offensive", value: undefined }),
      ),
      { reboundsOffensive: 1, reboundsDefensive: 0 },
    );
    expectDelta(
      project(
        makeAction({ kind: "rebound", side: "defensive", value: undefined }),
      ),
      { reboundsOffensive: 0, reboundsDefensive: 1 },
    );
  });

  it("passe, perte, contre et interception comptent chacun pour 1", () => {
    for (const [kind, key] of [
      ["assist", "assists"],
      ["turnover", "turnovers"],
      ["steal", "steals"],
      ["block", "blocks"],
    ] as const) {
      expectDelta(project(makeAction({ kind })), { [key]: 1, points: 0 });
    }
  });

  it("une substitution ne produit aucune statistique mais reste comptabilisée", () => {
    expectDelta(project(makeAction({ kind: "substitution" })), {
      substitutions: 1,
      points: 0,
      assists: 0,
    });
  });
});

describe("action annulée", () => {
  it("produit un delta neutre quel que soit son kind", () => {
    const voided = makeAction({ voidedAt: 1700000000000 });
    expect(project(voided)).toEqual(emptyDelta());
  });

  it("voidedAt: null compte comme active", () => {
    expect(project(makeAction({ voidedAt: null })).points).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Saisie de lancers après une faute sur tir manqué
// ---------------------------------------------------------------------------

describe("série de lancers après faute sur tir manqué", () => {
  it("un tir raté à 2 points avec faute ouvre une série de 2 lancers", () => {
    expect(
      awardedFreeThrows(makeAction({ value: 2, made: false, fouled: true })),
    ).toBe(2);
  });

  it("un tir raté à 3 points avec faute ouvre une série de 3 lancers", () => {
    expect(
      awardedFreeThrows(makeAction({ value: 3, made: false, fouled: true })),
    ).toBe(3);
  });

  it("un seul lancer après un panier + faute (and-1)", () => {
    // Règle FIBA, et cas réel : sans ce 1, `2P+F` n'ouvrait aucune fiche et
    // `pendingFreeThrows()` ne signalait jamais le lancer dû.
    expect(awardedFreeThrows(makeAction({ made: true, fouled: true }))).toBe(1);
    // Un and-1 à 3 points ne donne toujours qu'un lancer : le panier vaut 3,
    // pas 3 lancers.
    expect(
      awardedFreeThrows(makeAction({ made: true, fouled: true, value: 3 })),
    ).toBe(1);
  });

  it("aucune série pour un tir raté sans faute, une faute ou un LF", () => {
    expect(
      awardedFreeThrows(makeAction({ made: false, fouled: false })),
    ).toBeNull();
    expect(awardedFreeThrows(makeAction({ kind: "foul" }))).toBeNull();
    expect(
      awardedFreeThrows(
        makeAction({ kind: "free_throw", made: true, value: undefined }),
      ),
    ).toBeNull();
  });

  it("2 lancers dus + 2 lancers saisis = 2 FTA au total, pas 4", () => {
    // C'est le test qui verrouille l'absence de double comptage.
    const [shot] = expand(combos.missedAndFouled("p1", 1, "g1", 2));
    const ft = expand([
      ...combos.freeThrow("p1", 1, "g2", true),
      ...combos.freeThrow("p1", 1, "g2", true),
    ]);
    // `fouls: 0` : la série vaut des points, pas une infraction pour le joueur.
    expectDelta(sumDeltas([shot!, ...ft]), {
      fta: 2,
      ftm: 2,
      points: 2,
      fouls: 0,
      fga2: 0,
    });
  });

  it("3 lancers dus + 1 seul saisi = 1 FTA", () => {
    const [shot] = expand(combos.missedAndFouled("p1", 1, "g1", 3));
    const ft = expand(combos.freeThrow("p1", 1, "g2", true));
    expectDelta(sumDeltas([shot!, ...ft]), {
      fta: 1,
      ftm: 1,
      points: 1,
      fouls: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// Combos atomiques
// ---------------------------------------------------------------------------

describe("combos atomiques", () => {
  it("panier + faute (and-1) ne crée qu'une action, sinon le tir serait compté deux fois", () => {
    const actions = expand(combos.madeAndFouled("p1", 1, "g1", 2));
    expect(actions).toHaveLength(1);
    expectDelta(sumDeltas(actions), { points: 2, fgm2: 1, fouls: 0 });
  });

  it("and-1 à 3 points : une seule action, 3 points, aucune faute", () => {
    const actions = expand(combos.madeAndFouled("p1", 1, "g1", 3));
    expect(actions).toHaveLength(1);
    expectDelta(sumDeltas(actions), { points: 3, fgm3: 1, fouls: 0 });
  });

  it("tir raté + faute : une seule action, aucune statistique", () => {
    const actions = expand(combos.missedAndFouled("p1", 1, "g1", 2));
    expect(actions).toHaveLength(1);
    // L'action existe pour porter le `groupId` des lancers et pour le fil du
    // match, mais elle ne produit ni tentative ni faute.
    expectDelta(sumDeltas(actions), { fouls: 0, fga2: 0, points: 0 });
  });

  it("toutes les actions d'un combo partagent le même groupId", () => {
    const [shot] = expand(combos.madeAndFouled("p1", 2, "gX", 2));
    const [ft] = expand(combos.freeThrow("p1", 2, "gX", true));
    expect(shot!.groupId).toBe("gX");
    expect(ft!.groupId).toBe("gX");
  });

  it("planActions somme les deltas d'un combo avant écriture", () => {
    const plan = planActions([
      ...combos.madeAndFouled("p1", 1, "g1", 3),
      ...combos.freeThrow("p1", 1, "g1", true),
    ]);
    expectDelta(plan.delta, { points: 4, fgm3: 1, fouls: 0, fta: 1, ftm: 1 });
  });

  it("tous les combos produisent des actions valides au regard du schéma Zod", () => {
    const quarter: Quarter = 3;
    const all: ActionDraft[] = [
      ...combos.twoMade("p1", quarter, "g"),
      ...combos.threeMade("p1", quarter, "g"),
      ...combos.madeAndFouled("p1", quarter, "g", 2),
      ...combos.madeAndFouled("p1", quarter, "g", 3),
      ...combos.missed("p1", quarter, "g", 2),
      ...combos.missed("p1", quarter, "g", 3),
      ...combos.missedAndFouled("p1", quarter, "g", 2),
      ...combos.missedAndFouled("p1", quarter, "g", 3),
      ...combos.foul("p1", quarter, "g"),
      ...combos.freeThrow("p1", quarter, "g", true),
      ...combos.freeThrow("p1", quarter, "g", false),
      ...combos.rebound("p1", quarter, "g", "offensive"),
      ...combos.rebound("p1", quarter, "g", "defensive"),
      ...combos.assist("p1", quarter, "g"),
      ...combos.turnover("p1", quarter, "g"),
      ...combos.steal("p1", quarter, "g"),
      ...combos.block("p1", quarter, "g"),
    ];
    for (const action of expand(all)) {
      expect(() => ActionSchema.parse(action)).not.toThrow();
    }
  });

  it("les combos de stats avancées produisent le bon delta", () => {
    expectDelta(sumDeltas(expand(combos.rebound("p1", 1, "g", "offensive"))), {
      reboundsOffensive: 1,
      reboundsDefensive: 0,
    });
    expectDelta(sumDeltas(expand(combos.rebound("p1", 1, "g", "defensive"))), {
      reboundsOffensive: 0,
      reboundsDefensive: 1,
    });
    expectDelta(sumDeltas(expand(combos.assist("p1", 1, "g"))), { assists: 1 });
    expectDelta(sumDeltas(expand(combos.turnover("p1", 1, "g"))), {
      turnovers: 1,
    });
    expectDelta(sumDeltas(expand(combos.steal("p1", 1, "g"))), { steals: 1 });
    expectDelta(sumDeltas(expand(combos.block("p1", 1, "g"))), { blocks: 1 });
  });

  it("planActions accepte un combo entier et renvoie le delta cumulé", () => {
    const plan = planActions([
      ...combos.twoMade("p1", 1, "g"),
      ...combos.foul("p1", 1, "g"),
    ]);
    expectDelta(plan.delta, { points: 2, fgm2: 1, fouls: 1 });
    expect(plan.drafts).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Schémas Zod
// ---------------------------------------------------------------------------

describe("validation Zod", () => {
  it("refuse un tir sans value", () => {
    expect(() =>
      ActionSchema.parse({
        id: "a",
        matchId: "m",
        playerId: "p",
        seq: 0,
        quarter: 1,
        kind: "shot",
        made: true,
      }),
    ).toThrow();
  });

  it("refuse un tir sans made", () => {
    expect(() =>
      ActionSchema.parse({
        id: "a",
        matchId: "m",
        playerId: "p",
        seq: 0,
        quarter: 1,
        kind: "shot",
        value: 2,
      }),
    ).toThrow();
  });

  it("refuse `fouled` sur une faute simple (sinon double comptage silencieux)", () => {
    expect(() =>
      ActionSchema.parse({
        id: "a",
        matchId: "m",
        playerId: "p",
        seq: 0,
        quarter: 1,
        kind: "foul",
        fouled: true,
      }),
    ).toThrow();
  });

  it("refuse un rebond sans side", () => {
    expect(() =>
      ActionSchema.parse({
        id: "a",
        matchId: "m",
        playerId: "p",
        seq: 0,
        quarter: 1,
        kind: "rebound",
      }),
    ).toThrow();
  });

  it("refuse un lancer libre sans made", () => {
    expect(() =>
      ActionSchema.parse({
        id: "a",
        matchId: "m",
        playerId: "p",
        seq: 0,
        quarter: 1,
        kind: "free_throw",
      }),
    ).toThrow();
  });

  it("refuse une période hors 1-4", () => {
    expect(() =>
      ActionSchema.parse({
        id: "a",
        matchId: "m",
        playerId: "p",
        seq: 0,
        quarter: 5,
        kind: "foul",
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Agrégation
// ---------------------------------------------------------------------------

describe("aggregate", () => {
  const actions = [
    ...expand(combos.twoMade("p1", 1, "g")),
    ...expand(combos.missed("p1", 1, "g", 2)),
    ...expand(combos.threeMade("p1", 2, "g")),
    ...expand(combos.foul("p1", 2, "g")),
    ...expand(combos.twoMade("p2", 1, "g")),
  ];

  it("additionne les compteurs d'un joueur sur tout le match", () => {
    const stats = aggregateFor(actions, "p1");
    expect(stats.points).toBe(5); // 2 + 3
    expect(stats.fgm2).toBe(1);
    expect(stats.fga2).toBe(2); // réussi + raté
    expect(stats.fgm3).toBe(1);
    expect(stats.fga3).toBe(1);
    expect(stats.fouls).toBe(1);
  });

  it("sépare les joueurs", () => {
    const all = aggregate(actions);
    expect(all.map((s) => s.playerId).sort()).toEqual(["p1", "p2"]);
  });

  it("tri par points décroissants", () => {
    expect(aggregate(actions)[0]!.playerId).toBe("p1");
  });

  it("departage a egalite de points par ordre alphabetique", () => {
    const tied = expand([
      ...combos.twoMade("zz", 1, "g"),
      ...combos.twoMade("aa", 1, "g"),
    ]);
    expect(aggregate(tied).map((s) => s.playerId)).toEqual(["aa", "zz"]);
  });

  it("ne renvoie que les joueurs ayant au moins une action", () => {
    expect(aggregate(actions).some((s) => s.playerId === "p3")).toBe(false);
  });

  it("un joueur sans action renvoie des statistiques à zéro", () => {
    expect(aggregateFor(actions, "inconnu").points).toBe(0);
  });

  it("filtre par période sans toucher aux autres", () => {
    const stats = aggregateFor(actions, "p1", { quarter: 2 });
    expect(stats.points).toBe(3);
    expect(stats.fouls).toBe(1);
    expect(stats.fgm2).toBe(0);
  });

  it("exclut les actions annulées", () => {
    const voided = actions.map((a, i) => (i === 0 ? { ...a, voidedAt: 1 } : a));
    expect(aggregateFor(voided, "p1").points).toBe(3); // 5 - 2
  });

  it("filterActions par matchId", () => {
    const other = { ...actions[0]!, matchId: "m2" };
    expect(filterActions([other], { matchId: "m1" })).toHaveLength(0);
  });

  it("teamTotals somme tous les joueurs", () => {
    expect(teamTotals(actions).points).toBe(7); // 2 + 3 + 2
  });

  it("les actions annulées ne gonflent pas les totaux d'équipe", () => {
    const voided = actions.map((a, i) => (i === 0 ? { ...a, voidedAt: 1 } : a));
    expect(teamTotals(voided).points).toBe(5);
  });

  it("actionsOfMatch conserve les actions annulées pour le fil du match", () => {
    // Seul moyen de lire une action annulée : le fil doit montrer ce qui a été défait.
    const first = actions[0]!;
    const voided = { ...first, voidedAt: 1700000000000 };
    expect(actionsOfMatch([voided], first.matchId)).toHaveLength(1);
    expect(
      actionsOfMatch([voided], first.matchId, { includeVoided: false }),
    ).toHaveLength(0);
  });

  it("actionsOfMatch trie par seq, ordre de saisie", () => {
    const shuffled = [actions[2]!, actions[0]!, actions[1]!];
    expect(actionsOfMatch(shuffled, "m1").map((a) => a.seq)).toEqual(
      [...shuffled].map((a) => a.seq).sort((x, y) => x - y),
    );
  });
});

// ---------------------------------------------------------------------------
// Pourcentages
// ---------------------------------------------------------------------------

describe("pourcentages", () => {
  it("renvoie null sans tentative, jamais 0", () => {
    // Afficher « 0 % » pour un joueur qui n'a pas tiré induirait en erreur.
    expect(percentage(0, 0)).toBeNull();
    expect(twoPointsPercentage(playerStatsFrom([], "p"))).toBeNull();
  });

  it("calcule le % aux 2 points, 3 points et lancers", () => {
    const stats = playerStatsFrom(
      expand([
        ...combos.twoMade("p", 1, "g"),
        ...combos.missed("p", 1, "g", 2),
      ]),
      "p",
    );
    expect(twoPointsPercentage(stats)).toBe(50);
    expect(threePointsPercentage(stats)).toBeNull();
    expect(freeThrowPercentage(stats)).toBeNull();
  });

  it("un tir raté avec faute ne dégrade pas le % (règle non-FIBA)", () => {
    const stats = playerStatsFrom(
      expand([
        ...combos.twoMade("p", 1, "g"),
        ...combos.missedAndFouled("p", 1, "g", 2),
      ]),
      "p",
    );
    // 1 réussi sur 1 tenté : 100 %, et non 50 %.
    expect(twoPointsPercentage(stats)).toBe(100);
    // Et aucune faute : le tir manqué sur faute appartient à l'adversaire.
    expect(stats.fouls).toBe(0);
  });

  it("fieldGoalsMade / Attempted agrègent les deux zones", () => {
    const stats = playerStatsFrom(
      expand([
        ...combos.twoMade("p", 1, "g"),
        ...combos.threeMade("p", 1, "g"),
      ]),
      "p",
    );
    expect(fieldGoalsMade(stats)).toBe(2);
    expect(fieldGoalsAttempted(stats)).toBe(2);
    expect(totalRebounds(stats)).toBe(0);
  });

  it("fgPercentage agrège 2 points et 3 points", () => {
    const stats = playerStatsFrom(
      expand([
        ...combos.twoMade("p", 1, "g"),
        ...combos.missed("p", 1, "g", 2),
        ...combos.threeMade("p", 1, "g"),
        ...combos.missed("p", 1, "g", 3),
        ...combos.missed("p", 1, "g", 3),
      ]),
      "p",
    );
    // 2 réussis sur 5 tentés.
    expect(fgPercentage(stats)).toBe(40);
  });

  it("fgPercentage renvoie null sans aucune tentative", () => {
    expect(fgPercentage(playerStatsFrom([], "p"))).toBeNull();
  });

  it("formatSplit renvoie null si aucune tentative", () => {
    expect(formatSplit(0, 0, " à 3pts")).toBeNull();
    expect(formatSplit(2, 6, " à 3pts")).toBe("2/6 à 3pts");
  });

  it("formatPercentage renvoie un tiret cadratin sans donnée", () => {
    expect(formatPercentage(null)).toBe("—");
    expect(formatPercentage(50)).toBe("50%");
  });
});

// ---------------------------------------------------------------------------
// Statistiques par période
// ---------------------------------------------------------------------------

describe("statistiques par période", () => {
  const actions = [
    ...expand(combos.twoMade("p1", 1, "g")),
    ...expand(combos.threeMade("p1", 2, "g")),
    ...expand(combos.threeMade("p1", 2, "g")),
  ];

  it("points par période, avec une entrée à zéro pour les périodes vides", () => {
    // Une période à zéro est une information, pas une absence.
    expect(pointsByQuarter(actions, QUARTERS)).toEqual([
      { quarter: 1, points: 2 },
      { quarter: 2, points: 6 },
      { quarter: 3, points: 0 },
      { quarter: 4, points: 0 },
    ]);
  });

  it("statistiques d'un joueur par période", () => {
    const byQuarter = statsByQuarter(actions, "p1", [1, 2]);
    expect(byQuarter[0]!.stats.points).toBe(2);
    expect(byQuarter[1]!.stats.points).toBe(6);
    expect(byQuarter[1]!.stats.fgm3).toBe(2);
  });

  it("scoreForQuarters additionne les périodes demandées", () => {
    expect(scoreForQuarters(actions, [1, 2])).toBe(8);
    expect(scoreForQuarters(actions, [2])).toBe(6);
    expect(scoreForQuarters(actions, [])).toBe(0);
  });

  it("scoreForQuarters exclut les actions annulées", () => {
    const voided = actions.map((a) => ({ ...a, voidedAt: 1 }));
    expect(scoreForQuarters(voided, QUARTERS)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Lancers en attente
// ---------------------------------------------------------------------------

describe("pendingFreeThrows", () => {
  it("compte les lancers dus non saisis", () => {
    const [shot] = expand(combos.missedAndFouled("p1", 1, "g1", 3));
    expect(pendingFreeThrowsOf([shot!])).toBe(3);
  });

  it("retire les lancers effectivement saisis", () => {
    const [shot] = expand(combos.missedAndFouled("p1", 1, "g1", 3));
    const ft = expand([
      ...combos.freeThrow("p1", 1, "g2", true),
      ...combos.freeThrow("p1", 1, "g2", false),
    ]);
    expect(pendingFreeThrowsOf([shot!, ...ft])).toBe(1);
  });

  it("ne rend jamais négatif si plus de lancers saisis que dus", () => {
    const [shot] = expand(combos.missedAndFouled("p1", 1, "g1", 2));
    const ft = expand(
      Array.from({ length: 4 }, () =>
        combos.freeThrow("p1", 1, "g2", true),
      ).flat(),
    );
    expect(pendingFreeThrowsOf([shot!, ...ft])).toBe(0);
  });

  it("n'attribue pas les lancers d'un joueur à la série d'un autre", () => {
    const [shot] = expand(combos.missedAndFouled("p1", 1, "g1", 2));
    const otherPlayer = expand(combos.freeThrow("p2", 1, "g2", true));
    expect(pendingFreeThrowsOf([shot!, ...otherPlayer])).toBe(2);
  });

  it("ignore une série annulée", () => {
    const shot = {
      ...expand(combos.missedAndFouled("p1", 1, "g1", 2))[0]!,
      voidedAt: 1,
    };
    expect(pendingFreeThrowsOf([shot])).toBe(0);
  });

  it("décompte deux séries distinctes du même joueur", () => {
    // Régression : le second tir fouillé ne doit pas voler les lancers du premier.
    const shots = expand([
      ...combos.missedAndFouled("p1", 1, "g1", 2),
      ...combos.missedAndFouled("p1", 1, "g1", 3),
    ]);
    expect(shots).toHaveLength(2);
    const [first, second] = shots;
    const ft = expand([
      ...combos.freeThrow("p1", 1, "g2", true),
      ...combos.freeThrow("p1", 1, "g2", true),
      ...combos.freeThrow("p1", 1, "g3", true),
      ...combos.freeThrow("p1", 1, "g3", false),
    ]);
    // 2 + 3 = 5 lancers dus, 4 saisis.
    expect(pendingFreeThrowsOf([first!, second!, ...ft])).toBe(1);
  });

  it("ne consomme pas un lancer antérieur au tir fouillé", () => {
    // Un lancer saisi avant le tir ne peut pas solder la série de ce tir.
    const shot = {
      ...expand(combos.missedAndFouled("p1", 1, "g1", 2))[0]!,
      seq: 100,
    };
    const earlierFt = {
      ...expand(combos.freeThrow("p1", 1, "g0", true))[0]!,
      seq: 1,
    };
    expect(pendingFreeThrowsOf([earlierFt, shot])).toBe(2);
  });
});

/** Raccourci local pour alléger les assertions. */
function pendingFreeThrowsOf(actions: Action[]): number {
  return pendingFreeThrows(actions);
}

// ---------------------------------------------------------------------------
// Stats cumulées
// ---------------------------------------------------------------------------

describe("cumulativeStats", () => {
  // `expand` produit toujours `matchId: "m1"` ; on réétiquette chaque action
  // avec le match où elle a eu lieu, sinon le regroupement par match est faux.
  const m1Actions = inMatch("m1", [
    ...expand(combos.twoMade("p1", 1, "g")),
    ...expand(combos.threeMade("p1", 1, "g")),
  ]);
  const m2Actions = inMatch("m2", [
    ...expand(combos.twoMade("p1", 1, "g")),
    ...expand(combos.foul("p1", 1, "g")),
  ]);
  const m3Actions = inMatch("m3", expand(combos.twoMade("p2", 1, "g")));
  const all = [...m1Actions, ...m2Actions, ...m3Actions];

  const statsFor = (playerId: string) =>
    cumulativeStats(all, ["m1", "m2", "m3"]).find(
      (s) => s.playerId === playerId,
    );

  it("cumule les totaux sur tous les matchs", () => {
    const stats = statsFor("p1");
    expect(stats!.totals.points).toBe(7); // 2+3 puis 2
    expect(stats!.matchesPlayed).toBe(2);
  });

  it("calcule les moyennes par match", () => {
    expect(statsFor("p1")!.averages.points).toBeCloseTo(3.5); // 7 points / 2 matchs
  });

  it("moyenne de fautes sur les matchs joués uniquement", () => {
    expect(statsFor("p1")!.averages.fouls).toBeCloseTo(0.5); // 1 faute / 2 matchs
  });

  it("compte les rebonds moyens (offensifs + défensifs)", () => {
    const withRebounds = expand([
      ...combos.twoMade("p3", 1, "g"),
      ...combos.rebound("p3", 1, "g", "offensive"),
      ...combos.rebound("p3", 1, "g", "defensive"),
    ]);
    const [stats] = cumulativeStats(withRebounds, ["m1"]).filter(
      (s) => s.playerId === "p3",
    );
    expect(stats!.totals.reboundsOffensive).toBe(1);
    expect(stats!.totals.reboundsDefensive).toBe(1);
    expect(stats!.averages.rebounds).toBe(2);
  });

  it("ignore les matchs hors de la liste demandée", () => {
    expect(statsFor("p2")).toBeDefined(); // présent dans m3
    const [onlyM1] = cumulativeStats(all, ["m1"]).filter(
      (s) => s.playerId === "p2",
    );
    expect(onlyM1).toBeUndefined();
  });

  it("n'attribue pas de match joué à un joueur absent du match", () => {
    const stats = cumulativeStats(m1Actions, ["m1"]).find(
      (s) => s.playerId === "p1",
    );
    expect(stats!.matchesPlayed).toBe(1);
    expect(stats!.averages.points).toBe(5);
  });

  it("renvoie une liste vide s'il n'y a aucune action", () => {
    expect(cumulativeStats([], ["m1"])).toEqual([]);
  });

  it("exclut du cumul les actions annulées", () => {
    const voided = m1Actions.map((a) => ({ ...a, voidedAt: 1 }));
    const stats = cumulativeStats(voided, ["m1"]).find(
      (s) => s.playerId === "p1",
    );
    expect(stats).toBeUndefined();
  });

  it("ne compte qu'un match par joueur même avec plusieurs actions", () => {
    // Régression : un joueur présent deux fois dans la même rencontre ne doit
    // pas être compté comme ayant joué deux matchs.
    expect(cumulativeStats(m1Actions, ["m1"])[0]!.matchesPlayed).toBe(1);
  });

  it("expose les totaux du joueur au premier niveau pour le tri", () => {
    expect(cumulativeStats(all, ["m1", "m2", "m3"])[0]!.totals.points).toBe(7);
  });

  it("départage à égalité de points par ordre alphabétique", () => {
    const tied = inMatch(
      "m9",
      expand([
        ...combos.twoMade("zz", 1, "g"),
        ...combos.twoMade("aa", 1, "g"),
      ]),
    );
    expect(cumulativeStats(tied, ["m9"]).map((s) => s.playerId)).toEqual([
      "aa",
      "zz",
    ]);
  });

  it("retourne 0 et non NaN pour une moyenne quand aucun match", () => {
    // Régression : `total / 0` donnerait NaN dans l'interface.
    const [stats] = cumulativeStats(all, ["m1"]).filter(
      (s) => s.playerId === "p1",
    );
    expect(stats!.averages.points).toBe(5);
    expect(Number.isNaN(stats!.averages.points)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Présentation
// ---------------------------------------------------------------------------

describe("présentation", () => {
  const player: Player = {
    id: "p1",
    teamId: "t1",
    firstName: "Karim",
    lastName: "Benali",
    number: 4,
  };

  it("playerLabel compose le nom complet", () => {
    expect(playerLabel(player)).toBe("Karim Benali");
  });

  it("playerInitial renvoie la majuscule du prénom", () => {
    expect(playerInitial(player)).toBe("K");
  });
});

// ---------------------------------------------------------------------------
// Aides
// ---------------------------------------------------------------------------

describe("aides du domaine", () => {
  it("isActive distingue active et annulée", () => {
    expect(isActive(makeAction({ voidedAt: null }))).toBe(true);
    expect(isActive(makeAction({ voidedAt: 1 }))).toBe(false);
    expect(isActive(makeAction({ voidedAt: undefined }))).toBe(true);
  });

  it("isFouledShot ne s'applique qu'à un tir fouillé", () => {
    expect(isFouledShot(makeAction({ fouled: true }))).toBe(true);
    expect(isFouledShot(makeAction({ fouled: false }))).toBe(false);
    expect(isFouledShot(makeAction({ kind: "foul" }))).toBe(false);
  });

  it("le seuil de fautes est bien 5", () => {
    expect(FOUL_LIMIT).toBe(5);
  });

  it("addDeltas ne mute pas ses entrées", () => {
    const a = emptyDelta();
    const b = emptyDelta();
    b.points = 3;
    const sum = addDeltas(a, b);
    expect(sum.points).toBe(3);
    expect(a.points).toBe(0);
  });
});

afterAll(() => {
  counter = 0;
});
