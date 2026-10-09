"use client";

import { QUARTERS, type Quarter } from "@/domain/types";
import { useMatchStore } from "@/features/match/store";

/**
 * Sélecteur de période de l'écran de saisie (PLAN.md §12).
 *
 * Quatre boutons en rangée, la période active en orange. Reprend la maquette :
 * le sélecteur vit hors du header, dans sa propre rangée, pour que le header ne
 * porte que le contexte du match.
 *
 * `role="tab"` : la période est une vue parmi quatre, exactement comme un jeu
 * d'onglets — et c'est ce que les lecteurs d'écran annoncent.
 */

export function PeriodSelector() {
  const quarter = useMatchStore((state) => state.quarter);
  const setQuarter = useMatchStore((state) => state.setQuarter);

  return (
    <div
      role="tablist"
      aria-label="Période"
      className="flex items-center justify-center gap-[22px]"
    >
      {QUARTERS.map((value) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={value === quarter}
          onClick={() => setQuarter(value as Quarter)}
          className={`min-h-tap-min w-11 rounded-[10px] font-display text-[19px] font-light transition-colors ${
            value === quarter
              ? "bg-accent text-inverse"
              : "bg-white text-primary"
          }`}
        >
          {value}
        </button>
      ))}
    </div>
  );
}
