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
  /**
   * Nombre d'actions **actives** par match, indexé par `matchId`.
   *
   * Lu pour la confirmation de suppression : « 40 actions seront perdues » est
   * le seul énoncé qui permet au coach de vérifier qu'il choisit le bon match.
   * Un nom d'adversaire seul ne le permet pas — deux matchs contre la même
   * équipe sont courants dans une saison.
   *
   * Toutes les actions sont lées en une requête via `listByMatches`, puis
   * regroupées en mémoire : une lecture par match ferait vingt requêtes pour une
   * saison.
   */
  actionCounts: ReadonlyMap<string, number>;
}

/**
 * @param revision Incrémenté par l'appelant pour forcer une relecture.
 *
 * Indispensable après une suppression : `useAsyncData` ne se rejoue pas tout seul,
 * donc le matchEffacé resterait à l'écran — le pire rendu possible pour un
 * bouton « Supprimer ».
 */
export function useHistoryData(revision = 0): HistoryData & {
  loading: boolean;
} {
  const read = useCallback(async (): Promise<HistoryData> => {
    const store = repos();
    const team = await store.teams.ensureLocal();
    const [matches, roster] = await Promise.all([
      store.matches.listByTeam(team.id),
      store.players.listByTeam(team.id),
    ]);

    // Aucune action si aucun match : `listByMatches([])` renvoie `[]` sans
    // requête, donc l'appel est gratuit dans le cas le plus fréquent — un
    // téléphone neuf.
    const actions =
      matches.length === 0
        ? []
        : await store.actions.listByMatches(
            matches.map((match) => match.id),
            { includeVoided: false },
          );

    const actionCounts = new Map<string, number>();
    for (const action of actions) {
      actionCounts.set(
        action.matchId,
        (actionCounts.get(action.matchId) ?? 0) + 1,
      );
    }

    return {
      matches,
      finished: matches.filter((match) => match.status === "finished"),
      inProgress: matches.filter((match) => match.status !== "finished"),
      roster,
      // Un match en cours compte aussi : les stats cumulées le reflètent,
      // puisqu'elles sont lues sur les actions présentes.
      matchCount: matches.length,
      actionCounts,
    };
  }, []);

  const { data, loading } = useAsyncData<HistoryData>(read, [read, revision]);
  const empty = useMemo<HistoryData>(
    () => ({
      matches: [],
      finished: [],
      inProgress: [],
      roster: [],
      matchCount: 0,
      actionCounts: new Map(),
    }),
    [],
  );

  return { ...(data ?? empty), loading };
}
