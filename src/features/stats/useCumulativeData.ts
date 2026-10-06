"use client";

import { useCallback, useMemo } from "react";
import { repos } from "@/data";
import type { MatchRow, PlayerRow } from "@/data/schema";
import { cumulativeStats, type CumulativeStats } from "@/domain/stats";
import { useAsyncData } from "@/ui/useAsyncData";

/**
 * Données de l'écran des stats cumulées.
 *
 * Un seul `listByMatches()` plutôt qu'une boucle sur les matchs : vingt lectures
 * pour une saison, contre une. C'est la raison d'être de cette méthode dans le
 * repository.
 *
 * Les actions annulées sont exclues : les statistiques sont les compteurs réels,
 * pas la trace de ce qui a été défait.
 */

export interface CumulativeData {
  stats: CumulativeStats[];
  roster: PlayerRow[];
  matches: MatchRow[];
  matchCount: number;
}

export function useCumulativeData(): CumulativeData & { loading: boolean } {
  const read = useCallback(async (): Promise<CumulativeData> => {
    const store = repos();
    const team = await store.teams.ensureLocal();
    const [matches, roster] = await Promise.all([
      store.matches.listByTeam(team.id),
      store.players.listByTeam(team.id),
    ]);

    const matchIds = matches.map((match) => match.id);
    const actions = await store.actions.listByMatches(matchIds);

    return {
      stats: cumulativeStats(actions, matchIds),
      roster,
      matches,
      matchCount: matchIds.length,
    };
  }, []);

  const { data, loading } = useAsyncData<CumulativeData>(read, [read]);
  const empty = useMemo<CumulativeData>(
    () => ({ stats: [], roster: [], matches: [], matchCount: 0 }),
    [],
  );

  return { ...(data ?? empty), loading };
}

/**
 * Colonnes triables de l'écran `/stats`.
 *
 * `value` est une fonction plutôt qu'un nom de clé : les colonnes affichent
 * soit un total, soit une moyenne, et la même en-tête doit trier sur la bonne
 * des deux. Écrire une fonction par colonne évite d'avoir à maintenir deux
 * listes de clés qui divergeraient.
 */

export type SortKey =
  | "name"
  | "matchesPlayed"
  | "points"
  | "twoPoints"
  | "threePoints"
  | "freeThrows"
  | "shooting"
  | "fouls"
  | "rebounds"
  | "assists"
  | "turnovers"
  | "steals"
  | "blocks";

export interface Column {
  key: SortKey;
  /** Intitulé court pour un en-tête de 44 px. */
  label: string;
  /** Intitulé complet, pour l'accessibilité. */
  title: string;
  /**
   * Valeur de tri. `player` est fourni pour la colonne « Joueur » : le nom
   * n'est pas dans les statistiques, qui ne portent que des identifiants.
   */
  value: (
    entry: CumulativeStats,
    player: PlayerRow | undefined,
  ) => number | string;
}

export const COLUMNS: readonly Column[] = [
  {
    key: "name",
    label: "Joueur",
    title: "Trier par nom",
    value: (_e, p) => sortName(p),
  },
  {
    key: "matchesPlayed",
    label: "M",
    title: "Trier par nombre de matchs joués",
    value: (entry) => entry.matchesPlayed,
  },
  {
    key: "points",
    label: "Pts",
    title: "Trier par points",
    value: (entry) => entry.totals.points,
  },
  {
    key: "twoPoints",
    label: "2P",
    title: "Trier par paniers à 2 points réussis",
    value: (entry) => entry.totals.fgm2,
  },
  {
    key: "threePoints",
    label: "3P",
    title: "Trier par paniers à 3 points réussis",
    value: (entry) => entry.totals.fgm3,
  },
  {
    key: "freeThrows",
    label: "LF",
    title: "Trier par lancers libres réussis",
    value: (entry) => entry.totals.ftm,
  },
  {
    key: "shooting",
    label: "% Tirs",
    title: "Trier par pourcentage de réussite",
    value: (entry) =>
      entry.totals.fga2 + entry.totals.fga3 === 0
        ? -1
        : (entry.totals.fgm2 + entry.totals.fgm3) /
          (entry.totals.fga2 + entry.totals.fga3),
  },
  {
    key: "fouls",
    label: "F",
    title: "Trier par fautes",
    value: (entry) => entry.totals.fouls,
  },
  {
    key: "rebounds",
    label: "R",
    title: "Trier par rebonds",
    value: (entry) =>
      entry.totals.reboundsOffensive + entry.totals.reboundsDefensive,
  },
  {
    key: "assists",
    label: "P",
    title: "Trier par passes",
    value: (entry) => entry.totals.assists,
  },
  {
    key: "turnovers",
    label: "PD",
    title: "Trier par pertes de balle",
    value: (entry) => entry.totals.turnovers,
  },
  {
    key: "steals",
    label: "IC",
    title: "Trier par interceptions",
    value: (entry) => entry.totals.steals,
  },
  {
    key: "blocks",
    label: "CT",
    title: "Trier par contres",
    value: (entry) => entry.totals.blocks,
  },
];

function sortName(player: PlayerRow | undefined): string {
  if (player === undefined) return "";
  // Nom de famille d'abord : c'est par là qu'on cherche un joueur dans une
  // liste, pas par son prénom.
  return `${player.lastName} ${player.firstName}`.toLowerCase();
}

export interface SortedRows {
  key: SortKey;
  descending: boolean;
  rows: readonly { entry: CumulativeStats; player: PlayerRow | undefined }[];
}

/**
 * Tri et filtre du tableau.
 *
 * Le tri est **extrait en fonction pure** plutôt que laissé au tableau : il est
 * alors testable sans DOM, et l'écran ne fait que boucler sur un résultat.
 */
export function sortAndFilter(
  stats: readonly CumulativeStats[],
  roster: readonly PlayerRow[],
  key: SortKey,
  descending: boolean,
  query: string,
): SortedRows {
  const byPlayer = new Map(roster.map((player) => [player.id, player]));
  const needle = query.trim().toLowerCase();

  const column = COLUMNS.find((entry) => entry.key === key) ?? COLUMNS[1]!;

  const rows = stats
    .map((entry) => ({ entry, player: byPlayer.get(entry.playerId) }))
    .filter(({ player }) => {
      if (needle === "") return true;
      if (player === undefined) return false;
      return `${player.firstName} ${player.lastName}`
        .toLowerCase()
        .includes(needle);
    });

  rows.sort((a, b) => {
    const left = column.value(a.entry, a.player);
    const right = column.value(b.entry, b.player);
    const comparison =
      typeof left === "string" && typeof right === "string"
        ? left.localeCompare(right, "fr")
        : Number(left) - Number(right);
    // Le tri par nom reste croissant même en tri décroissant : lire une liste
    // de noms à l'envers n'aide personne.
    const effective =
      key === "name" ? comparison : comparison * (descending ? -1 : 1);
    return effective !== 0
      ? effective
      : (a.player?.lastName ?? "").localeCompare(
          b.player?.lastName ?? "",
          "fr",
        );
  });

  return { key, descending, rows };
}
