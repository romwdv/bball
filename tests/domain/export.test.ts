import { describe, expect, it } from "vitest";
import {
  activeActions,
  matchFilename,
  matchToCsv,
  matchToJson,
  type MatchExportInput,
} from "@/domain/export";
import { expand } from "./helpers";
import { combos } from "@/domain/rules";
import type { Action, Match, Player } from "@/domain/types";

/**
 * Export CSV et JSON.
 *
 * Le CSV sert au coach le soir du match, le JSON à la réimportation. Le format
 * CSV est là pour être ouvert dans Excel **sans manipulation** — d'où le
 * séparateur `;`, le BOM et les fins de ligne CRLF, qui sont des contraintes
 * d'Excel et non des choix esthétiques.
 */

function makeMatch(overrides: Partial<Match> = {}): Match {
  return {
    id: "m1",
    teamId: "local",
    opponentName: "BC Nuit",
    date: "2026-10-05",
    playerIds: ["p1", "p2"],
    status: "finished",
    createdAt: 1,
    finishedAt: 2,
    ...overrides,
  };
}

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: "p1",
    teamId: "local",
    firstName: "Ada",
    lastName: "Lovelace",
    number: 4,
    ...overrides,
  };
}

function makeInput(): MatchExportInput {
  const actions: Action[] = [
    // Panier 2 pts réussi → 2 pts, 1/1 à 2 pts
    ...expand(combos.twoMade("p1", 1, "g1")),
    // Tir 2 pts raté → 0/1 à 2 pts
    ...expand(combos.missed("p1", 1, "g2", 2)),
    // Panier 3 pts réussi → 1/1 à 3 pts, 3 pts
    ...expand(combos.threeMade("p1", 2, "g3")),
    // Tir 3 pts raté + faute → ni le tir ni la faute ne sont comptés
    // (règle non-FIBA ; la faute est celle de l'adversaire).
    ...expand(combos.missedAndFouled("p1", 3, "g4", 3)),
    // 2 lancers : 1 réussi, 1 raté → 1/2
    ...expand(combos.freeThrow("p1", 3, "g4", true)),
    ...expand(combos.freeThrow("p1", 3, "g4", false)),
    ...expand(combos.assist("p1", 2, "g5")),
    ...expand(combos.rebound("p1", 4, "g6", "offensive")),
    ...expand(combos.rebound("p1", 4, "g6", "defensive")),
    ...expand(combos.turnover("p1", 4, "g7")),
    ...expand(combos.steal("p1", 4, "g8")),
    ...expand(combos.block("p1", 4, "g9")),
    ...expand(combos.foul("p1", 4, "g10")),
    // Le joueur p2 a été entré au roster mais n'a rien fait : sa ligne doit
    // exister, à zéro.
    // Action annulée : ne doit apparaître dans AUCUN compteur du CSV.
    {
      id: "a-void",
      matchId: "m1",
      playerId: "p1",
      seq: 99,
      quarter: 1,
      kind: "shot",
      value: 2,
      made: true,
      voidedAt: 500,
    },
  ];

  return {
    match: makeMatch(),
    players: [
      makePlayer(),
      makePlayer({
        id: "p2",
        firstName: "Grace",
        lastName: "Hopper",
        number: 7,
      }),
    ],
    actions,
  };
}

// ---------------------------------------------------------------------------

describe("matchToCsv", () => {
  it("commence par un BOM pour qu'Excel lise l'UTF-8", () => {
    const csv = matchToCsv(makeInput());
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("utilise le point-virgule, séparateur qu'Excel FR attend", () => {
    const csv = matchToCsv(makeInput());
    expect(csv).toContain("N°;Prénom;Nom;Pts");
    // Une virgule dans l'en-tête prouverait que le séparateur est mauvais.
    expect(csv).not.toContain("N°,Prénom");
  });

  it("finit les lignes par CRLF, comme Excel les attend", () => {
    expect(matchToCsv(makeInput())).toContain("\r\n");
  });

  it("écrit l'en-tête du match", () => {
    const csv = matchToCsv(makeInput());
    expect(csv).toContain("Match;BC Nuit");
    expect(csv).toContain("Date;2026-10-05");
    expect(csv).toContain("Statut;finished");
    expect(csv).toContain("Score;6");
  });

  it("compte correctement les colonnes d'un joueur", () => {
    const csv = matchToCsv(makeInput());
    const row = csv
      .split("\r\n")
      .find((line) => line.startsWith("4;Ada;Lovelace"));
    expect(row).toBeDefined();
    // 17 colonnes : N°, Prénom, Nom, Pts, 2P R/T, 3P R/T, LF R/T, Fautes,
    // R Off/Déf, Passes, Pertes, Contres, Interceptions.
    expect(row?.split(";")).toHaveLength(17);
  });

  it("compte 2 points, 1/1 à 2 pts, 1/1 à 3 pts, 1/2 aux lancers", () => {
    const csv = matchToCsv(makeInput());
    const row = csv
      .split("\r\n")
      .find((line) => line.startsWith("4;Ada;Lovelace"));
    // 6 points = 2 (panier 2 pts) + 3 (panier 3 pts) + 1 (lancer réussi).
    // 1 seule faute : le tir raté + faute n'en compte aucune, la faute simple
    // en compte une.
    expect(row).toBe("4;Ada;Lovelace;6;1;2;1;1;1;2;1;1;1;1;1;1;1");
  });

  it("exclut le tir raté + faute des tentatives", () => {
    // Règle non-FIBA assumée (PLAN.md §1) : ce tir n'existe pas dans les stats.
    // S'il était compté, `2P T` vaudrait 3 et non 2.
    const csv = matchToCsv(makeInput());
    const row = csv
      .split("\r\n")
      .find((line) => line.startsWith("4;Ada;Lovelace"));
    // Colonnes 4 et 5 : `2P R` puis `2P T` — l'index 3 est les points.
    const [, fga2] = row!.split(";").slice(4, 6);
    expect(fga2).toBe("2");
  });

  it("exclut les actions annulées des compteurs", () => {
    const csv = matchToCsv(makeInput());
    // Le tir annulé vaudrait 2 pts s'il était compté : le total resterait 5.
    expect(csv).toContain("Score;6");
  });

  it("affiche une ligne à zéro pour un joueur du roster sans action", () => {
    const csv = matchToCsv(makeInput());
    const row = csv
      .split("\r\n")
      .find((line) => line.startsWith("7;Grace;Hopper"));
    // Sans cette ligne, le coach croirait à une omission du document.
    expect(row).toBe("7;Grace;Hopper;0;0;0;0;0;0;0;0;0;0;0;0;0;0");
  });

  it("termine par une ligne Total", () => {
    const csv = matchToCsv(makeInput());
    const lines = csv.split("\r\n");
    // Une seule fois « Total » : trois fois passerait pour trois joueurs.
    expect(lines[lines.length - 2]).toBe("Total;;;6;1;2;1;1;1;2;1;1;1;1;1;1;1");
  });

  it("échappe un nom contenant un point-virgule", () => {
    const csv = matchToCsv({
      ...makeInput(),
      match: makeMatch({ opponentName: 'BC;Nuit "A"' }),
    });
    // Sans échappement, le nom casserait la colonne suivante en silence.
    expect(csv).toContain('"BC;Nuit ""A"""');
  });

  it("échappe un nom contenant un guillemet", () => {
    const csv = matchToCsv({
      ...makeInput(),
      players: [makePlayer({ lastName: 'L"Ovelace' })],
    });
    expect(csv).toContain('"L""Ovelace"');
  });

  it("gère un joueur sans numéro", () => {
    const csv = matchToCsv({
      ...makeInput(),
      players: [makePlayer({ number: null })],
    });
    // Champ vide plutôt que « null » : le fichier est lu par un humain.
    expect(csv).toContain(";Ada;Lovelace;6;");
  });
});

// ---------------------------------------------------------------------------

describe("matchToJson", () => {
  it("écrit le score par période", () => {
    const json = matchToJson(makeInput());
    const parsed = JSON.parse(json) as {
      score: { total: number; byQuarter: Record<string, number> };
    };
    expect(parsed.score.total).toBe(6);
    // Q1 : panier 2 pts. Q2 : panier 3 pts. Q3 : lancer réussi.
    expect(parsed.score.byQuarter).toEqual({ 1: 2, 2: 3, 3: 1, 4: 0 });
  });

  it("contient toutes les actions, annulées comprises", () => {
    const json = matchToJson(makeInput());
    const parsed = JSON.parse(json) as { actions: Action[] };
    // Le CSV exclut les annulées des compteurs ; l'export machine doit permettre
    // de reconstruire l'historique exact, y compris ce qui a été défait.
    const voided = parsed.actions.filter((action) => action.voidedAt !== null);
    expect(voided).toHaveLength(1);
  });

  it("recalcule les stats, jamais lues depuis un stockage", () => {
    const json = matchToJson(makeInput());
    const parsed = JSON.parse(json) as {
      stats: { playerId: string; points: number }[];
    };
    expect(parsed.stats).toHaveLength(2);
    expect(parsed.stats[0]?.points).toBe(6);
  });

  it("n'inclut que le roster du match", () => {
    const json = matchToJson(makeInput());
    const parsed = JSON.parse(json) as { players: Player[] };
    expect(parsed.players.map((player) => player.id)).toEqual(["p1", "p2"]);
  });

  it("date l'export", () => {
    const json = matchToJson(makeInput());
    const parsed = JSON.parse(json) as { exportedAt: string };
    expect(parsed.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("est formaté pour être relu par un humain", () => {
    // L'export sert à déboguer, pas à économiser des octets.
    expect(matchToJson(makeInput())).toContain('\n  "match"');
  });
});

// ---------------------------------------------------------------------------

describe("matchFilename", () => {
  it("commence par la date, pour trier par chronologie", () => {
    const name = matchFilename(makeMatch(), "csv");
    expect(name).toBe("2026-10-05-vs-bc-nuit.csv");
  });

  it("retire les accents", () => {
    const name = matchFilename(
      makeMatch({ opponentName: "Étoile Béziers" }),
      "csv",
    );
    expect(name).toBe("2026-10-05-vs-etoile-beziers.csv");
  });

  it("remplace les caractères interdits", () => {
    const name = matchFilename(
      makeMatch({ opponentName: "US/Nuit: Ré" }),
      "json",
    );
    expect(name).toBe("2026-10-05-vs-us-nuit-re.json");
  });

  it("replie sur « adversaire » si le nom est vide", () => {
    const name = matchFilename(makeMatch({ opponentName: "///" }), "csv");
    expect(name).toBe("2026-10-05-vs-adversaire.csv");
  });
});

// ---------------------------------------------------------------------------

describe("activeActions", () => {
  it("exclut les annulées et trie par seq", () => {
    const { actions } = makeInput();
    const active = activeActions(actions);
    const voided = actions.find((action) => action.voidedAt !== null);
    expect(active.map((action) => action.id)).not.toContain(voided?.id);
    const seqs = active.map((action) => action.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
  });
});
