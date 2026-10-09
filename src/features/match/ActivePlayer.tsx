"use client";

import { useCallback } from "react";
import { repos } from "@/data";
import {
  aggregateFor,
  fieldGoalsAttempted,
  fieldGoalsMade,
  filterActions,
  playerLabel,
  playerStatsFrom,
  totalRebounds,
  type PlayerStats,
} from "@/domain/stats";
import type { MatchRow, PlayerRow } from "@/data/schema";
import { QUARTERS } from "@/domain/types";
import { FoulDots } from "@/ui/Badges";
import { useAsyncData } from "@/ui/useAsyncData";
import { useMatchStore } from "@/features/match/store";

/**
 * Carte du joueur suivi (PLAN.md §11 et §12).
 *
 * L'app suit **un seul joueur** : il n'y a pas de score d'équipe. Le gros chiffre
 * est donc son total sur le match — c'est le nombre que le coach annonce au banc.
 *
 * Les lignes de stats portent deux portées, et le coach pose les deux questions :
 *
 * **La période affichée.** « Combien a-t-il mis ce quart-ci », pendant qu'il se
 * passe. C'est la ligne du haut.
 *
 * **Le cumul des périodes jouées.** Ce qu'il regarde entre les périodes. N'apparaît
 * qu'à partir de la Q2 : en Q1, la période et le cumul sont la même chose, donc
 * la ligne serait un doublon littéral — deux rangées identiques sous un joueur qui
 * n'a qu'un quart dans les jambes.
 *
 * Les fautes restent cumulées sur tout le match et séparées : la limite à cinq est
 * *par rencontre*, un joueur éliminable en Q1 le reste en Q2. Les mélanger aux
 * stats de période ferait croire à un décompte qui repart.
 */

export interface ActivePlayerProps {
  /** Le joueur suivi. `null` tant que la base n'a pas répondu. */
  player: PlayerRow | null;
  /** Points du joueur sur le match entier, toutes périodes confondues. */
  points: number;
  /** Stats de la période affichée. */
  quarterStats: PlayerStats | undefined;
  /**
   * Stats cumulées des périodes **jouées** (celles qui précèdent la période
   * affichée). `null` en première période : rien à cumuler.
   */
  previousStats: PlayerStats | null;
  /** Fautes cumulées sur le match entier. */
  fouls: number;
}

/**
 * Une rangée de pastilles.
 *
 * Le rendu est identique pour la période et pour le cumul : mêmes stats, même
 * ordre. La différence tient à l'étiquette seule, pas à deux listes de
 * conditions — deux listes divergeraient à la première stat ajoutée.
 */
function StatRow({ label, stats }: { label: string; stats: PlayerStats }) {
  const attempts = fieldGoalsAttempted(stats);

  return (
    <div className="tabular flex flex-wrap items-baseline gap-x-2 text-sm text-primary">
      {/* Largeur fixe : sans elle, « Cumul » (plus long que « Q ») décalerait
          toutes les pastilles de la ligne par rapport à celles du dessus. */}
      <span className="w-12 shrink-0 text-xs text-primary/50">{label}</span>
      {attempts > 0 && (
        <span title="tirs réussis / tentés">
          {fieldGoalsMade(stats)}/{attempts}
        </span>
      )}
      {totalRebounds(stats) > 0 && (
        <span title="rebonds">{totalRebounds(stats)}R</span>
      )}
      {stats.assists > 0 && <span title="passes">{stats.assists}P</span>}
      {stats.steals > 0 && <span title="interceptions">{stats.steals}INT</span>}
      {stats.blocks > 0 && <span title="contres">{stats.blocks}C</span>}
      {stats.turnovers > 0 && (
        <span title="balles perdues">{stats.turnovers}BP</span>
      )}
    </div>
  );
}

export function ActivePlayer({
  player,
  points,
  quarterStats,
  previousStats,
  fouls,
}: ActivePlayerProps) {
  if (player === null) return null;

  return (
    <div className="mx-auto mb-8 w-full max-w-[280px] rounded-[10px] border border-primary/20 bg-raised px-5 py-3">
      <span className="text-sm text-primary">{playerLabel(player)}</span>

      <div className="tabular mt-1 flex items-baseline gap-x-2 text-sm text-primary">
        {/* `data-testid` : c'est la valeur que les tests et le coach ciblent ; le
          texte visible suffit comme libellé accessible. */}
        <span className="text-xl font-semibold">
          <span data-testid="points">{points}</span>pts
        </span>
      </div>

      {quarterStats !== undefined && <StatRow label="Q" stats={quarterStats} />}
      {previousStats !== null && (
        <StatRow label="Cumul" stats={previousStats} />
      )}

      <div className="mt-1.5">
        <FoulDots fouls={fouls} showCount />
      </div>
    </div>
  );
}

/**
 * Charge le match, son joueur et ses statistiques pour la période courante.
 *
 * Le rechargement est déclenché par `revision` : chaque écriture du store
 * l'incrémente, donc la carte se remet à jour sans que le composant ait à
 * connaître la nature de l'écriture.
 *
 * `quarter` est une **dépendance** de `read` et non un champ d'état : le
 * sélecteur de période ne passe pas par `revision`, donc sans cette clé les
 * points resteraient figés sur la période précédente.
 */
export interface MatchData {
  match: MatchRow | null;
  /** Le joueur suivi, ou `null` si le match n'a pas de roster. */
  player: PlayerRow | null;
  /** Stats de la période affichée. */
  quarterStats: PlayerStats | undefined;
  /**
   * Stats cumulées des périodes jouées, `null` en Q1. Le joueur inconnu ne se
   * distingue pas ici : le composant rend `null` avant de lire cette valeur.
   */
  previousStats: PlayerStats | null;
  /** Fautes cumulées sur le match entier. */
  fouls: number;
  /** Points du joueur sur le match entier. */
  points: number;
}

export function useMatchData(matchId: string | null): MatchData & {
  loading: boolean;
} {
  const quarter = useMatchStore((state) => state.quarter);
  const revision = useMatchStore((state) => state.revision);

  const read = useCallback(async (): Promise<MatchData> => {
    if (matchId === null) return EMPTY;

    const store = repos();
    const [found, roster, actions] = await Promise.all([
      store.matches.get(matchId),
      store.matches.rosterOf(matchId),
      store.actions.listByMatch(matchId, { includeVoided: false }),
    ]);

    const player = roster[0] ?? null;
    if (player === null) return { ...EMPTY, match: found ?? null };

    // Un seul calcul sur les actions du match entier sert aux fautes et au total
    // de points : les deux sont cumulés, donc filtrer par période ici afficherait
    // « 0 » après un changement de période.
    const totals = aggregateFor(actions, player.id);

    // Les périodes déjà jouées : celles strictement antérieures à la période
    // affichée. La Q1 n'en a aucune, d'où `null` — et pas un cumul vide, que la
    // carte afficherait comme une seconde ligne de zéros.
    const played = QUARTERS.filter((q) => q < quarter);
    const previousStats =
      played.length === 0
        ? null
        : playerStatsFrom(
            filterActions(actions, { playerId: player.id }).filter((action) =>
              played.includes(action.quarter),
            ),
            player.id,
          );

    return {
      match: found ?? null,
      player,
      quarterStats: aggregateFor(actions, player.id, { quarter }),
      previousStats,
      fouls: totals.fouls,
      points: totals.points,
    };
  }, [matchId, quarter]);

  const { data, loading } = useAsyncData<MatchData>(read, [read, revision]);

  return { ...(data ?? EMPTY), loading };
}

const EMPTY: MatchData = {
  match: null,
  player: null,
  quarterStats: undefined,
  previousStats: null,
  fouls: 0,
  points: 0,
};
