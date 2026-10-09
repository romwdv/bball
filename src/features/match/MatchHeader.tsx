"use client";

import type { MatchRow } from "@/data/schema";
import { formatDate } from "@/features/match/formatDate";
import { SyncIndicator } from "@/features/sync/SyncIndicator";
import { useMatchStore } from "@/features/match/store";

/**
 * Ligne de contexte du match (PLAN.md §12).
 *
 * L'adversaire à gauche, le voyant de synchronisation à droite — c'est la
 * rangée qui dit « quel match je saisis et où en est la sync ». Le score total
 * et la période ont quitté ce header : le score est sur la carte du joueur,
 * la période dans sa propre rangée (`PeriodSelector`).
 *
 * Le compteur de lancers dus reste ici : il signale une fiche de saisie ouverte,
 * qui bloque le reste de la grille — il ne doit pas passer inaperçu.
 */

export interface MatchHeaderProps {
  match: MatchRow;
}

export function MatchHeader({ match }: MatchHeaderProps) {
  const pendingFreeThrows = useMatchStore((state) => state.pendingFreeThrows);

  return (
    <div className="flex items-center justify-between px-4 py-1">
      <span
        className="min-w-0 truncate font-display text-[19px] text-primary"
        title={`${formatDate(match.date)} · ${match.status}`}
      >
        vs {match.opponentName}
      </span>

      <span className="flex shrink-0 items-center gap-2">
        {match.status === "finished" && (
          <span className="rounded-full bg-raised px-2 py-1 text-xs font-medium text-muted">
            Terminé
          </span>
        )}
        {pendingFreeThrows > 0 && (
          <span className="rounded-full bg-warning-subtle px-2 py-1 text-xs text-warning">
            LF {pendingFreeThrows}
          </span>
        )}
        <SyncIndicator />
      </span>
    </div>
  );
}
