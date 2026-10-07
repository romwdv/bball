import { type Action, ActionSchema } from "@/domain/types";
import { type ActionDraft, combos } from "@/domain/rules";
import { sumDeltas } from "@/domain/stats";
import {
  activeCount,
  applyUndo,
  groupOf,
  isWellFormed,
  lastAction,
  redoHint,
  redoScope,
  undoScope,
  voidActions,
} from "@/domain/undo";

let counter = 0;

function expand(drafts: readonly ActionDraft[]): Action[] {
  return drafts.map((draft, index) => {
    counter += 1;
    return ActionSchema.parse({
      id: `u${counter}`,
      matchId: "m1",
      seq: counter + index,
      voidedAt: null,
      ...(draft as object),
    });
  });
}

beforeEach(() => {
  counter = 0;
});

describe("lastAction", () => {
  it("renvoie null sur une liste vide", () => {
    expect(lastAction([])).toBeNull();
  });

  it("renvoie l'action de plus haut seq, pas la dernière du tableau", () => {
    // L'ordre du tableau n'est pas garanti : seul `seq` fait foi.
    const a = { ...expand(combos.twoMade("p1", 1, "g"))[0]!, seq: 5 };
    const b = { ...expand(combos.threeMade("p1", 1, "g"))[0]!, seq: 9 };
    const c = { ...expand(combos.foul("p1", 1, "g"))[0]!, seq: 7 };
    expect(lastAction([a, c, b])?.seq).toBe(9);
  });

  it("ignore l'ordre d'insertion", () => {
    const actions = expand([
      ...combos.twoMade("p1", 1, "g"),
      ...combos.foul("p1", 1, "g"),
    ]);
    expect(lastAction(actions)?.kind).toBe("foul");
  });
});

describe("undoScope", () => {
  it("renvoie une liste vide s'il n'y a rien à défaire", () => {
    expect(undoScope([])).toEqual([]);
  });

  it("retire la seule dernière action si elle n'a pas de groupe", () => {
    // Deux `groupId` distincts : sinon les deux actions formeraient un groupe.
    const actions = expand([
      ...combos.twoMade("p1", 1, "gA"),
      ...combos.foul("p1", 1, "gB"),
    ]);
    expect(undoScope(actions)).toHaveLength(1);
    expect(undoScope(actions)[0]!.kind).toBe("foul");
  });

  it("retire tout le groupe quand la dernière action est groupée", () => {
    const actions = expand([
      ...combos.madeAndFouled("p1", 1, "gA", 2),
      ...combos.twoMade("p1", 1, "gB"),
    ]);
    const scope = undoScope(actions);
    expect(scope).toHaveLength(1);
    expect(scope[0]!.groupId).toBe("gB");
  });

  it("retire toutes les actions d'un même groupId", () => {
    // Un and-1 suivi de son lancer : même groupe, deux actions, annulées ensemble.
    const actions = expand([
      ...combos.madeAndFouled("p1", 1, "gA", 3),
      ...combos.freeThrow("p1", 1, "gA", true),
    ]);
    expect(actions).toHaveLength(2);
    expect(undoScope(actions)).toHaveLength(2);
  });

  it("ne prend qu'un seul groupe à la fois", () => {
    const all = [
      ...expand(combos.madeAndFouled("p1", 1, "g1", 2)),
      ...expand(combos.twoMade("p1", 1, "g2")),
    ];
    expect(undoScope(all)).toHaveLength(1);
    expect(undoScope(all)[0]!.groupId).toBe("g2");
  });

  it("saute les actions déjà annulées", () => {
    // Un double undo ne doit pas défaire l'avant-dernière action : le coach
    // comprendrait que l'annulation est cassée.
    const actions = expand([
      ...combos.twoMade("p1", 1, "gA"),
      ...combos.threeMade("p1", 1, "gB"),
      ...combos.foul("p1", 1, "gC"),
    ]);
    const afterFirst = applyUndo(actions, 1000);
    expect(activeCount(afterFirst)).toBe(2);

    const scope = undoScope(afterFirst);
    expect(scope).toHaveLength(1);
    expect(scope[0]!.groupId).toBe("gB");
  });

  it("ne confond pas un groupe déjà partiellement annulé", () => {
    // Le lancer du groupe A est annulé, seul l'and-1 reste actif.
    // Un undo doit viser le groupe B, pas ré-activer le groupe A.
    const group = [
      ...expand(combos.madeAndFouled("p1", 1, "gA", 2)),
      ...expand(combos.freeThrow("p1", 1, "gA", true)),
    ];
    const other = expand(combos.foul("p1", 1, "gB"));
    const partial = [group[0]!, voidActions([group[1]!], 1000)[0]!, ...other];

    const scope = undoScope(partial);
    expect(scope).toHaveLength(1);
    expect(scope[0]!.id).toBe(other[0]!.id);
  });
});

describe("voidActions", () => {
  it("ne mute pas le tableau d'origine", () => {
    const actions = expand(combos.twoMade("p1", 1, "g"));
    voidActions(actions, 1000);
    expect(actions[0]!.voidedAt).toBeNull();
  });

  it("ne ré-annule pas une action déjà annulée", () => {
    const actions = expand(combos.twoMade("p1", 1, "g"));
    const once = voidActions(actions, 1000);
    const twice = voidActions(once, 2000);
    expect(twice[0]!.voidedAt).toBe(1000);
  });

  it("utilise un horodatage par défaut si aucun n'est fourni", () => {
    const actions = expand(combos.twoMade("p1", 1, "g"));
    expect(voidActions(actions)[0]!.voidedAt).toBeTypeOf("number");
  });
});

describe("applyUndo", () => {
  it("retire exactement le périmètre de undoScope", () => {
    const actions = expand([
      ...combos.twoMade("p1", 1, "gA"),
      ...combos.threeMade("p1", 1, "gB"),
      ...combos.foul("p1", 1, "gC"),
    ]);
    const result = applyUndo(actions, 1000);
    expect(activeCount(result)).toBe(2);
    expect(result.find((a) => a.groupId === "gC")!.voidedAt).toBe(1000);
  });

  it("ne change rien quand il n'y a rien à défaire", () => {
    expect(applyUndo([], 1000)).toEqual([]);
  });

  it("les statistiques baissent du montant exact du groupe annulé", () => {
    // C'est le test qui garantit qu'undo et statistiques ne divergent pas.
    const before = expand([
      // Une faute simple, avant le groupe annulé : seule celle-là compte au
      // joueur. Elle est posée avant pour survivre à l'annulation de `gC`.
      ...combos.foul("p1", 1, "gA"),
      ...combos.twoMade("p1", 1, "gB"),
      ...combos.madeAndFouled("p1", 1, "gC", 3),
    ]);
    const after = applyUndo(before, 1000);
    const beforeDelta = sumDeltas(before);
    const afterDelta = sumDeltas(after);
    expect(beforeDelta.points).toBe(5);
    expect(afterDelta.points).toBe(2);
    // L'and-1 ne compte aucune faute : `beforeDelta.fouls` vient de `gC` seul.
    expect(beforeDelta.fouls).toBe(1);
    expect(afterDelta.fouls).toBe(1);
  });

  it("ne rend pas les points quand on annule un tir raté", () => {
    const before = expand(combos.missed("p1", 1, "gA", 2));
    const after = applyUndo(before, 1000);
    expect(sumDeltas(after).fga2).toBe(0);
    expect(sumDeltas(after).points).toBe(0);
  });

  it("conserve les actions non annulées à l'identique", () => {
    const actions = expand([
      ...combos.twoMade("p1", 1, "gA"),
      ...combos.foul("p1", 1, "gB"),
    ]);
    const after = applyUndo(actions, 1000);
    const kept = after.find((a) => a.groupId === "gA")!;
    // Même référence logique : rien ne doit être réécrit au-delà du strict nécessaire,
    // sinon Dexie réécrirait des enregistrements inchangés.
    expect(kept).toEqual(actions[0]!);
    expect(kept.voidedAt).toBeNull();
  });

  it("utilise l'horodatage courant par défaut", () => {
    const actions = expand(combos.twoMade("p1", 1, "gA"));
    const before = Date.now();
    const after = applyUndo(actions);
    expect(after[0]!.voidedAt!).toBeGreaterThanOrEqual(before);
  });
});

describe("redoHint", () => {
  it("décrit la dernière action à refaire", () => {
    const actions = expand(combos.threeMade("p2", 3, "g"));
    expect(redoHint(actions)).toEqual({
      kind: "shot",
      playerId: "p2",
      quarter: 3,
    });
  });

  it("renvoie null s'il n'y a rien à refaire", () => {
    expect(redoHint([])).toBeNull();
    expect(
      redoHint(applyUndo(expand(combos.twoMade("p1", 1, "g")), 1000)),
    ).toBeNull();
  });

  it("reprend la première action du groupe annulé", () => {
    const actions = expand(combos.madeAndFouled("p1", 2, "gA", 3));
    expect(redoHint(actions)?.kind).toBe("shot");
  });
});

describe("redoScope", () => {
  it("renvoie les actions dans l'ordre chronologique", () => {
    const undone = applyUndo(
      expand(combos.madeAndFouled("p1", 1, "gA", 2)),
      1000,
    );
    const seqs = redoScope([], undone).map((a) => a.seq);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
  });
});

describe("groupOf", () => {
  it("ne renvoie que les actions du groupe demandé", () => {
    const actions = expand([
      ...combos.madeAndFouled("p1", 1, "gA", 2),
      ...combos.foul("p1", 1, "gB"),
    ]);
    expect(groupOf(actions, "gA")).toHaveLength(1);
    expect(groupOf(actions, "gB")).toHaveLength(1);
    expect(groupOf(actions, "inconnu")).toHaveLength(0);
  });
});

describe("activeCount", () => {
  it("compte uniquement les actions non annulées", () => {
    const actions = expand([
      ...combos.twoMade("p1", 1, "gA"),
      ...combos.foul("p1", 1, "gB"),
      ...combos.threeMade("p1", 1, "gC"),
    ]);
    expect(activeCount(actions)).toBe(3);
    expect(activeCount(applyUndo(actions, 1000))).toBe(2);
  });
});

describe("isWellFormed", () => {
  it("valide une action issue du domaine", () => {
    expect(isWellFormed(expand(combos.twoMade("p1", 1, "g"))[0]!)).toBe(true);
  });

  it("refuse une action corrompue", () => {
    const broken = { ...expand(combos.twoMade("p1", 1, "g"))[0]!, quarter: 9 };
    expect(isWellFormed(broken as Action)).toBe(false);
  });
});
