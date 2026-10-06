"use client";

import { useCallback, useMemo } from "react";
import { repos } from "@/data";
import type { MatchRow, PlayerRow } from "@/data/schema";
import { useAsyncData } from "@/ui/useAsyncData";

/**
 * Données de l'écran d'historique.
 *
 * Charge **tous** les matchs de l'équipe, terminés ou non : un match en cours
 * figure dans l'historique avec son score du moment, ce qui est exactement ce
 * que le coach veut voir en.allant relire la semaine précédente.
 *
 * Le roster est chargé en parallèle, et non déduit des matchs : un joueur qui
 * n'a joué aucun match n'apparaît nulle part ailleurs, et l'export des stats
 * cumulées a besoin de le nommer correctement même avec une ligne à zéro.
 */

export interface HistoryData {
  /** Matchs triés du plus récent au plus ancien. */
  matches: MatchRow[];
  finished: MatchRow[];
  inProgress: MatchRow[];
  roster: PlayerRow[];
  matchCount: number;
}

export function useHistoryData(): HistoryData & { loading: boolean } {
  const read = useCallback(async (): Promise<HistoryData> => {
    const store = repos();
    const team = await store.teams.ensureLocal();
    const [matches, roster] = await Promise.all([
      store.matches.listByTeam(team.id),
      store.players.listByTeam(team.id),
    ]);

    return {
      matches,
      finished: matches.filter((match) => match.status === "finished"),
      inProgress: matches.filter((match) => match.status !== "finished"),
      roster,
      // Un match en cours compte aussi : les stats cumulées le reflètent,
      // puisqu'elles sont lues sur les actions présentes.
      matchCount: matches.length,
    };
  }, []);

  const { data, loading } = useAsyncData<HistoryData>(read, [read]);
  const empty = useMemo<HistoryData>(
    () => ({
      matches: [],
      finished: [],
      inProgress: [],
      roster: [],
      matchCount: 0,
    }),
    [],
  );

  return { ...(data ?? empty), loading };
}
