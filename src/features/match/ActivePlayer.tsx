"use client";

import { useCallback } from "react";
import { repos } from "@/data";
import {
  aggregateFor,
  fieldGoalsAttempted,
  fieldGoalsMade,
  playerLabel,
  teamTotals,
  totalRebounds,
  type PlayerStats,
} from "@/domain/stats";
import type { MatchRow, PlayerRow } from "@/data/schema";
import { FoulDots } from "@/ui/Badges";
import { useAsyncData } from "@/ui/useAsyncData";
import { useMatchStore } from "@/features/match/store";

/**
 * Carte du joueur suivi (PLAN.md §11 et §12).
 *
 * C'était le bandeau de saisie. La maquette en fait une **carte** : prénom,
 * score total du match, stats de la période, pastilles de fautes. C'est aussi
 * l'emplacement du score — le chiffre que le coach annonce au banc, qui n'avait
 * plus de place dans le header refondu.
 *
 * Deux portées, et pourquoi elles ne se mélangent pas :
 *
 * **Le score (`score`) est un cumul du match entier.** Il ne doit pas se
 * remettre à zéro en changeant de période, sinon le coach annoncerait un mauvais
 * chiffre au banc. C'est la même règle que pour l'ancien header, déplacée ici.
 *
 * **Les tirs, rebonds et passes (`stats`) sont ceux de la période affichée.**
 * « Combien a-t-il mis ce quart-ci » est la question du coach pendant une
 * période ; le cumul de match est ce qu'il regarde entre les périodes.
 *
 * **Les fautes (`fouls`) sont cumulées sur tout le match.** La limite à cinq est
 * *par rencontre* : un joueur éliminable en Q1 le reste en Q2.
 */

export interface ActivePlayerProps {
  /** Le joueur suivi. `null` tant que la base n'a pas répondu. */
  player: PlayerRow | null;
  /** Score du match entier, toutes périodes confondues. */
  score: number;
  /** Points et tirs du joueur sur la période affichée. */
  stats: PlayerStats | undefined;
  /** Fautes cumulées sur le match entier. */
  fouls: number;
}

export function ActivePlayer({
  player,
  score,
  stats,
  fouls,
}: ActivePlayerProps) {
  if (player === null) return null;

  const attempts = stats === undefined ? 0 : fieldGoalsAttempted(stats);

  return (
    <div className="mx-auto w-full max-w-[280px] rounded-[10px] border border-primary/20 bg-raised px-5 py-3">
      <span className="text-sm text-primary">{playerLabel(player)}</span>

      <div className="tabular mt-1 flex flex-wrap items-baseline gap-x-2 text-sm text-primary">
        <span className="text-base font-semibold">
          {/* `data-testid` : le score est la valeur que les tests et le coach
            ciblent ; le texte visible suffit comme libellé accessible. */}
          <span data-testid="score">{score}</span>pts
        </span>
        {attempts > 0 && stats !== undefined && (
          <span title="tirs réussis / tentés de la période">
            {fieldGoalsMade(stats)}/{attempts}
          </span>
        )}
        {stats !== undefined && totalRebounds(stats) > 0 && (
          <span>{totalRebounds(stats)}R</span>
        )}
        {stats !== undefined && stats.assists > 0 && (
          <span>{stats.assists}P</span>
        )}
      </div>

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
  /** Points et tirs de la période affichée. */
  stats: PlayerStats | undefined;
  /** Fautes cumulées sur le match entier. */
  fouls: number;
  /** Score du match entier, toutes périodes confondues. */
  totalPoints: number;
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

    // Les points de la période sont filtrés ; les fautes ne le sont pas — la
    // règle des cinq fautes est par rencontre.
    const inQuarter = actions.filter((action) => action.quarter === quarter);

    return {
      match: found ?? null,
      player,
      stats: player === null ? undefined : aggregateFor(inQuarter, player.id),
      fouls: player === null ? 0 : aggregateFor(actions, player.id).fouls,
      // Cumul du match, calculé sur les actions et non sur les points affichés :
      // une action dont le joueur aurait quitté le roster ne doit pas disparaître
      // du score.
      totalPoints: teamTotals(actions).points,
    };
  }, [matchId, quarter]);

  const { data, loading } = useAsyncData<MatchData>(read, [read, revision]);

  return { ...(data ?? EMPTY), loading };
}

const EMPTY: MatchData = {
  match: null,
  player: null,
  stats: undefined,
  fouls: 0,
  totalPoints: 0,
};
