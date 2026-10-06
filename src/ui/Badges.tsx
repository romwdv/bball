"use client";

import { FOUL_LIMIT } from "@/domain/types";
import type { PlayerStats } from "@/domain/stats";
import {
  fieldGoalsAttempted,
  fieldGoalsMade,
  totalRebounds,
} from "@/domain/stats";

/**
 * Pastilles de fautes (PLAN.md §4).
 *
 * Le compteur est une pastille par faute, pas un nombre : le coach voit « il en
 * reste une » d'un coup d'œil en gymnase, ce qu'un « 3/5 » en police normale ne
 * permet pas. Passé `FOUL_LIMIT`, la pastille dépassée vire au rouge — c'est le
 * seuil d'élimination, et il doit être visible sans compter.
 *
 * Les fautes sont **cumulées sur le match entier**, jamais sur la période : la
 * limite à cinq est par rencontre. L'appelant est responsable de passer le
 * cumul — voir `useMatchData`.
 */

export interface FoulDotsProps {
  /** Fautes cumulées sur le match, pas sur la période affichée. */
  fouls: number;
  /** Affiche le compteur numérique en plus des pastilles. */
  showCount?: boolean;
}

export function FoulDots({ fouls, showCount = false }: FoulDotsProps) {
  return (
    <span className="flex items-center gap-0.5">
      {/* Les pastilles sont purement décoratives ; le nombre est annoncé une fois
          pour les lecteurs d'écran. Tout le composant ne peut pas être en
          `aria-hidden` : le compteur deviendrait invisible, alors que c'est
          précisément lui qui porte le seuil d'élimination. */}
      <span className="flex items-center gap-0.5" aria-hidden="true">
        {Array.from({ length: FOUL_LIMIT }, (_, index) => (
          <span
            key={index}
            className={`h-1.5 w-1.5 rounded-full ${
              index < fouls
                ? index >= FOUL_LIMIT - 1
                  ? "bg-foul"
                  : "bg-warning"
                : "bg-edge-strong"
            }`}
          />
        ))}
      </span>
      <span className="sr-only tabular text-xs text-secondary">
        {fouls} faute{fouls > 1 ? "s" : ""} sur {FOUL_LIMIT}
      </span>
      {showCount && (
        <span className="tabular ml-1 text-xs text-secondary">
          {fouls}/{FOUL_LIMIT}
        </span>
      )}
    </span>
  );
}

/** Statistiques live d'un joueur dans le carrousel. */
export interface PlayerBadgesProps {
  stats: PlayerStats | undefined;
}

/**
 * Résumé compact d'un joueur dans le carrousel : points, tirs, rebonds, passes.
 *
 * Les tirs sont affichés en `réussis/tentés` — donc `2/5` — et c'est ce qui rend
 * un tir raté **visible**. Sans eux, un appui long n'était visible nulle part :
 * le score ne bouge pas et aucune pastille ne change. Le coach ne pouvait pas
 * savoir si son geste était passé, et c'est le geste le plus ambigu de l'écran.
 *
 * Le ratio s'affiche dès la première tentative, pas seulement quand il y en a
 * beaucoup : « 0/1 » dit immédiatement que le tir est tombé.
 */
export function PlayerBadges({ stats }: PlayerBadgesProps) {
  if (stats === undefined) {
    return <span className="tabular text-xs text-muted">—</span>;
  }

  const attempts = fieldGoalsAttempted(stats);

  return (
    <span className="tabular flex items-center gap-2 text-xs text-secondary">
      <span className="font-semibold text-primary">{stats.points}</span>
      {attempts > 0 && (
        <span title="tirs réussis / tentés">
          {fieldGoalsMade(stats)}/{attempts}
        </span>
      )}
      {totalRebounds(stats) > 0 && <span>{totalRebounds(stats)}R</span>}
      {stats.assists > 0 && <span>{stats.assists}P</span>}
    </span>
  );
}
