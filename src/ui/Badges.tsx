"use client";

import { FOUL_LIMIT } from "@/domain/types";
import type { PlayerStats } from "@/domain/stats";
import {
  fieldGoalsAttempted,
  fieldGoalsMade,
  totalRebounds,
} from "@/domain/stats";

/**
 * Pastilles de fautes (PLAN.md §12).
 *
 * Le compteur est une pastille par faute, pas un nombre : le coach voit « il en
 * reste une » d'un coup d'œil en gymnase, ce qu'un « 3/5 » en police normale ne
 * permet pas. Couleurs de la maquette : remplies `#f0980b`, vides `#b3b3b3`.
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
          pour les lecteurs d'écran. */}
      <span className="flex items-center gap-0.5" aria-hidden="true">
        {Array.from({ length: FOUL_LIMIT }, (_, index) => (
          <span
            key={index}
            className={`h-2 w-2 rounded-full ${
              index < fouls ? "bg-dot-filled" : "bg-dot-empty"
            }`}
          />
        ))}
      </span>
      <span className="sr-only tabular text-xs text-secondary">
        {fouls} faute{fouls > 1 ? "s" : ""} sur {FOUL_LIMIT}
      </span>
      {showCount && (
        <span className="tabular ml-1 text-xs text-muted">
          {fouls} / {FOUL_LIMIT}
        </span>
      )}
    </span>
  );
}

/** Statistiques live du joueur, dans la carte de saisie. */
export interface PlayerBadgesProps {
  stats: PlayerStats | undefined;
}

/**
 * Résumé compact du joueur, au format de la maquette : `17pts 4/5 2R 4P`.
 *
 * Les tirs sont affichés en `réussis/tentés` — donc `4/5` — et c'est ce qui rend
 * un tir raté **visible**. Sans eux, un appui long n'était visible nulle part :
 * le score ne bouge pas et aucune pastille ne change.
 *
 * Chaque grandeur est affichée dès qu'elle est non nulle, sauf les points qui
 * le sont toujours.
 */
export function PlayerBadges({ stats }: PlayerBadgesProps) {
  if (stats === undefined) {
    return <span className="tabular text-sm text-muted">—</span>;
  }

  const attempts = fieldGoalsAttempted(stats);

  return (
    <span className="tabular flex flex-wrap items-center gap-x-2 text-sm text-primary">
      <span className="font-medium">{stats.points}pts</span>
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
