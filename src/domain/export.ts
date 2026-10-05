import type { Action, Match, Player, Quarter } from "./types";
import { QUARTERS } from "./types";
import {
  aggregateFor,
  emptyPlayerStats,
  type PlayerStats,
  pointsByQuarter,
} from "./stats";
import { filterActions } from "./stats";

/**
 * Export d'un match en CSV et JSON.
 *
 * **Pur et sans dépendance à IndexedDB** : les fonctions reçoivent les données et
 * renvoient une chaîne. C'est ce qui rend l'export testable sans base, et ce qui
 * permettra un jour d'exporter depuis un tirage cloud sans réécrire le format.
 *
 * Deux formats, deux publics :
 * - **CSV** pour le coach qui ouvre le fichier dans Excel ou Numbers le soir du
 *   match. Séparateur `;` et BOM UTF-8 : c'est ce qu'Excel FR attend, un CSV à
 *   virgules s'ouvre en une seule colonne et le coach ne saura jamais pourquoi ;
 * - **JSON** pour la réimportation et l'audit. Il contient **toutes** les actions,
 *   y compris les annulées, parce que le but est de ne rien perdre — les
 *   statistiques, elles, ne sont calculées que sur les actions actives.
 */

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** Colonnes de la feuille, dans l'ordre où le coach les lit sur le terrain. */
const CSV_COLUMNS = [
  "N°",
  "Prénom",
  "Nom",
  "Pts",
  "2P R",
  "2P T",
  "3P R",
  "3P T",
  "LF R",
  "LF T",
  "Fautes",
  "R Off",
  "R Déf",
  "Passes",
  "Pertes",
  "Contres",
  "Intercept",
] as const;

/**
 * Échappe une valeur CSV.
 *
 * Le nom de l'adversaire est saisi librement : « BC;Nuit » casserait silencieusement
 * la colonne suivante, et personne ne le verrait avant d'ouvrir le fichier.
 */
function csvField(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  return /[";\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvRow(cells: readonly (string | number | null)[]): string {
  return cells.map(csvField).join(";");
}

/**
 * Ligne de statistiques, dans l'ordre de `CSV_COLUMNS`.
 *
 * `label` remplace les trois premières colonnes (N°, Prénom, Nom) pour la ligne
 * Total : y réécrire « Total;Total;Total » passerait pour trois joueurs.
 */
function csvStatsRow(
  player: Player | undefined,
  stats: PlayerStats,
  label?: string,
): (string | number | null)[] {
  if (label !== undefined) {
    return [
      label,
      "",
      "",
      stats.points,
      stats.fgm2,
      stats.fga2,
      stats.fgm3,
      stats.fga3,
      stats.ftm,
      stats.fta,
      stats.fouls,
      stats.reboundsOffensive,
      stats.reboundsDefensive,
      stats.assists,
      stats.turnovers,
      stats.steals,
      stats.blocks,
    ];
  }

  return [
    player?.number ?? null,
    player?.firstName ?? "",
    player?.lastName ?? "",
    stats.points,
    stats.fgm2,
    stats.fga2,
    stats.fgm3,
    stats.fga3,
    stats.ftm,
    stats.fta,
    stats.fouls,
    stats.reboundsOffensive,
    stats.reboundsDefensive,
    stats.assists,
    stats.turnovers,
    stats.steals,
    stats.blocks,
  ];
}

function addStats(a: PlayerStats, b: PlayerStats): PlayerStats {
  return {
    playerId: a.playerId,
    points: a.points + b.points,
    fgm2: a.fgm2 + b.fgm2,
    fga2: a.fga2 + b.fga2,
    fgm3: a.fgm3 + b.fgm3,
    fga3: a.fga3 + b.fga3,
    ftm: a.ftm + b.ftm,
    fta: a.fta + b.fta,
    fouls: a.fouls + b.fouls,
    reboundsOffensive: a.reboundsOffensive + b.reboundsOffensive,
    reboundsDefensive: a.reboundsDefensive + b.reboundsDefensive,
    assists: a.assists + b.assists,
    turnovers: a.turnovers + b.turnovers,
    steals: a.steals + b.steals,
    blocks: a.blocks + b.blocks,
  };
}

export interface MatchExportInput {
  match: Match;
  players: readonly Player[];
  /** Toutes les actions du match, annulées comprises. */
  actions: readonly Action[];
}

/**
 * Feuille de match au format CSV.
 *
 * Trois blocs : en-tête du match, ligne par joueur, ligne « Total ». Les
 * statistiques ne portent que sur les actions actives — une action annulée
 * n'existe pas dans les compteurs, c'est la règle du domaine depuis la phase 1.
 */
export function matchToCsv({
  match,
  players,
  actions,
}: MatchExportInput): string {
  const statsByPlayer = players.map((player) => ({
    player,
    stats: aggregateFor(actions, player.id),
  }));

  const total = statsByPlayer.reduce(
    (sum, { stats }) => addStats(sum, stats),
    emptyPlayerStats("total"),
  );

  const lines = [
    csvRow(["Match", match.opponentName]),
    csvRow(["Date", match.date]),
    csvRow(["Statut", match.status]),
    csvRow(["Score", total.points]),
    "",
    csvRow([...CSV_COLUMNS]),
    ...statsByPlayer.map(({ player, stats }) =>
      csvRow(csvStatsRow(player, stats)),
    ),
    csvRow(csvStatsRow(undefined, total, "Total")),
  ];

  // Le BOM est indispensable : sans lui, Excel FR lit l'UTF-8 en latin-1 et
  // « Lovelace » s'affiche « LovelacÃ© ».
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

export interface MatchExportJson {
  /** Date d'export, au format ISO. C'est le seul champ produit à l'export. */
  exportedAt: string;
  match: Match;
  score: {
    total: number;
    byQuarter: Record<Quarter, number>;
  };
  /** Uniquement le roster du match, pas l'équipe entière. */
  players: readonly Player[];
  /** Statistiques recalculées à l'export, jamais stockées. */
  stats: readonly PlayerStats[];
  /**
   * Toutes les actions, annulées comprises.
   *
   * C'est la différence avec le CSV : l'export machine doit permettre de
   * reconstruire l'historique exact du match, y compris ce qui a été défait.
   */
  actions: readonly Action[];
}

export function matchToJson({
  match,
  players,
  actions,
}: MatchExportInput): string {
  const score = pointsByQuarter(actions, QUARTERS);

  const payload: MatchExportJson = {
    exportedAt: new Date().toISOString(),
    match,
    score: {
      total: score.reduce((sum, entry) => sum + entry.points, 0),
      byQuarter: Object.fromEntries(
        score.map(({ quarter, points }) => [quarter, points]),
      ) as Record<Quarter, number>,
    },
    players,
    stats: players.map((player) => aggregateFor(actions, player.id)),
    actions,
  };

  // `null, 2` plutôt qu'une chaîne compacte : l'export sert à être relu par un
  // humain qui débogue, pas à économiser des octets.
  return `${JSON.stringify(payload, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Nom de fichier
// ---------------------------------------------------------------------------

/**
 * Nom de fichier du match, sans caractères interdits.
 *
 * L'adversaire est saisi librement (« BC/Nuit » casserait le chemin) et les
 * accents posent problème sur certains systèmes de fichiers. On garde la date en
 * tête : trier les fichiers par nom les range par chronologie, ce qui est
 * précisément ce qu'un coach cherche dans son dossier de fin de saison.
 */
export function matchFilename(match: Match, extension: "csv" | "json"): string {
  const slug = match.opponentName
    .toLowerCase()
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${match.date}-vs-${slug || "adversaire"}.${extension}`;
}

/** Actions actives d'un match, triées par `seq`. Aide à l'export comme à l'affichage. */
export function activeActions(actions: readonly Action[]): Action[] {
  return filterActions(actions).sort((a, b) => a.seq - b.seq);
}
