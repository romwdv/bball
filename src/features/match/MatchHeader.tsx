"use client";

import { QUARTERS, type Quarter } from "@/domain/types";
import type { MatchRow } from "@/data/schema";
import type { PlayerStats } from "@/domain/stats";
import { useMatchStore } from "@/features/match/store";
import { formatDate } from "@/features/match/formatDate";
import { SyncIndicator } from "@/features/sync/SyncIndicator";

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
        className="min-h-tap-min min-w-tap-min shrink-0 rounded-lg border border-edge px-3 text-sm"
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
            // `w-11` = 44 px : la largeur du sélecteur de période est mesurée, pas
          // supposée. En `w-8` (32 px) les quatre onglets ne respectaient pas la
          // cible tactile minimale, alors que c'est le seul élément du header
          // réellement pressé en match — passer de Q1 à Q2 arrive quelques fois
          // par rencontre.
          className={`tabular min-h-tap-min w-11 text-sm font-semibold transition-colors ${
              value === quarter
                ? "bg-accent text-inverse"
                : "bg-raised text-secondary"
            }`}
          >
            {value}
          </button>
        ))}
      </div>

      {/* `data-testid` plutôt qu'un libellé accessible : la valeur est déjà du
        texte visible et lisible, l'attribut ne sert qu'à cibler le nombre
        exactement, sans attraper le « 2 » d'un numéro de maillot voisin. */}
      <span
        className="tabular flex flex-1 items-baseline justify-center gap-1 text-center"
        // La date et le statut n'ont pas de place dans le header : ils restent
        // accessibles au survol, où le coach les cherche s'il reprend un match
        // d'il y a trois semaines.
        title={`${formatDate(match.date)} · ${match.status}`}
      >
        {/* Score et adversaire dans des nœuds séparés : le score est la valeur
          que le coach lit en premier, et un test ne doit pas avoir à découper
          « 2 · vs BC Nuit » pour la retrouver. */}
        <span data-testid="score" className="text-2xl font-bold">
          {score}
        </span>
        <span className="text-sm font-normal text-muted">
          · vs {match.opponentName}
        </span>
      </span>

      {/* Le compteur de lancers dus ne disparaît jamais : il signale une fiche de
          saisie ouverte, qui bloque le reste de la grille. */}
      {pendingFreeThrows > 0 && (
        <span className="shrink-0 rounded-full bg-warning-subtle px-2 py-1 text-xs text-warning">
          LF {pendingFreeThrows}
        </span>
      )}

      <SyncIndicator />
    </header>
  );
}
