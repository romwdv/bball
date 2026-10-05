"use client";

import { QUARTERS, type Quarter } from "@/domain/types";
import type { MatchRow } from "@/data/schema";
import type { PlayerStats } from "@/domain/stats";
import { useMatchStore } from "@/features/match/store";
import { formatDate } from "@/features/match/formatDate";

/**
 * Header compact : période, score, annulations, synchronisation.
 *
 * Tout est sur une seule ligne de 44 px. Un header qui prend le tiers de l'écran
 * sur un téléphone de 6 pouces vole la place aux actions, qui sont le seul contenu
 * qui compte ici.
 *
 * Le sélecteur de période est là plutôt que dans un menu : passer de Q2 à Q3
 * arrive quelques fois par match, et un tap sur « Q3 » coûte une seconde alors
 * qu'un menu en coûte quatre.
 */

export interface MatchHeaderProps {
  match: MatchRow;
  statsByPlayer: ReadonlyMap<string, PlayerStats>;
}

export function MatchHeader({ match, statsByPlayer }: MatchHeaderProps) {
  const quarter = useMatchStore((state) => state.quarter);
  const setQuarter = useMatchStore((state) => state.setQuarter);
  const undoLast = useMatchStore((state) => state.undoLast);
  const pendingFreeThrows = useMatchStore((state) => state.pendingFreeThrows);

  // Score de l'équipe = somme des points du roster, sur la période courante.
  // Recalculé à chaque rendu à partir des actions : c'est le domaine qui sait
  // additionner, l'écran ne fait que lire.
  let score = 0;
  for (const stats of statsByPlayer.values()) score += stats.points;

  return (
    <header className="flex items-center gap-2 border-b border-edge px-(--padding-safe-l) pt-(--padding-safe-t) pb-(--padding-safe-r)">
      <button
        type="button"
        onClick={() => {
          void undoLast({ text: "Dernière action annulée" });
        }}
        aria-label="Annuler la dernière action"
        className="min-h-tap-min shrink-0 rounded-lg border border-edge px-3 text-sm"
      >
        ↶
      </button>

      <div
        role="tablist"
        aria-label="Période"
        className="flex shrink-0 overflow-hidden rounded-lg border border-edge"
      >
        {QUARTERS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={value === quarter}
            onClick={() => setQuarter(value as Quarter)}
            className={`tabular min-h-tap-min w-8 text-sm font-semibold transition-colors ${
              value === quarter
                ? "bg-accent text-inverse"
                : "bg-raised text-secondary"
            }`}
          >
            {value}
          </button>
        ))}
      </div>

      <span className="tabular flex-1 text-center text-2xl font-bold">
        {score}
        <span className="text-sm font-normal text-muted">
          {" "}
          · vs {match.opponentName}
        </span>
      </span>

      <span
        className="shrink-0 text-xs"
        title={`${formatDate(match.date)} · ${match.status}`}
      >
        {pendingFreeThrows > 0 ? (
          <span className="rounded-full bg-warning-subtle px-2 py-1 text-warning">
            LF {pendingFreeThrows}
          </span>
        ) : (
          <span className="text-muted">⚡</span>
        )}
      </span>
    </header>
  );
}
