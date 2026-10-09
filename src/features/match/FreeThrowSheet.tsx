"use client";

import { useState } from "react";
import { combos } from "@/domain/rules";
import type { Quarter } from "@/domain/types";
import { Sheet } from "@/ui/Sheet";
import { CheckIcon, CrossIcon } from "@/ui/icons";
import { useMatchStore } from "@/features/match/store";

/**
 * Mini-sheet de saisie des lancers (PLAN.md §12).
 *
 * Panneau sombre, comme la maquette : une ligne par lancer avec deux gros
 * boutons ✓ / ✗, puis « Valider » en orange et « Fermer » en blanc.
 *
 * Les compteurs sont cliquables et les boutons ✓ / ✗ enregistrent un lancer
 * **à la fois**. Enregistrer toute la série d'un coup serait tentant, mais sur
 * une série le coach change d'avis à chaque ballon. Un geste par ballon est le
 * seul granulaire qui reste utilisable.
 *
 * Le nombre de lancers dus vient du store (`pendingFreeThrows`), alimenté par
 * `awardedFreeThrows()` au moment de la faute — jamais d'un décompte maison.
 */

export interface FreeThrowSheetProps {
  /** Joueur concerné, pour l'en-tête. */
  playerId: string;
  quarter: Quarter;
  /** Groupe parent : les lancers s'y rattachent pour être annulables ensemble. */
  parentGroupId: string;
}

export function FreeThrowSheet({
  playerId,
  quarter,
  parentGroupId,
}: FreeThrowSheetProps) {
  const due = useMatchStore((state) => state.pendingFreeThrows);
  const closeSheet = useMatchStore((state) => state.closeSheet);
  const record = useMatchStore((state) => state.record);

  // Résultats de la série en cours, uniquement pour l'affichage. La vérité est
  // la base : au rechargement, les compteurs se reconstruisent seuls.
  const [results, setResults] = useState<(boolean | undefined)[]>(() =>
    Array.from({ length: due }, () => undefined),
  );

  async function save(index: number, made: boolean) {
    // Le groupe parent relie le lancer à la faute qui l'a déclenché : un undo
    // groupe les retire tous, ce qui est le seul comportement acceptable quand la
    // série est fautive.
    await record(
      [combos.freeThrow(playerId, quarter, parentGroupId, made)[0]],
      made ? "made" : "missed",
    );
    setResults((current) => {
      const next = [...current];
      next[index] = made;
      return next;
    });
  }

  const remaining = results.filter((value) => value === undefined).length;

  return (
    <Sheet
      open
      title={`Lancers libres · ${remaining} à jouer`}
      onClose={closeSheet}
      variant="dark"
      footer={
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={closeSheet}
            className="min-h-tap-action w-full rounded-[10px] bg-accent font-display text-2xl font-light text-inverse"
          >
            Valider
          </button>
          <button
            type="button"
            onClick={closeSheet}
            className="min-h-tap-action w-full rounded-[10px] bg-white font-display text-2xl font-light text-primary"
          >
            Fermer
          </button>
        </div>
      }
    >
      <ol className="flex flex-col gap-2">
        {results.map((value, index) => (
          <li
            key={index}
            className="flex h-[52px] items-center gap-2 rounded-[10px] border border-[#e8e8e8] bg-overlay px-3"
          >
            <span className="w-8 shrink-0 text-sm text-inverse">
              LF{index + 1}
            </span>

            <button
              type="button"
              aria-label={`Lancer ${index + 1} réussi`}
              aria-pressed={value === true}
              onClick={() => void save(index, true)}
              className={`flex h-9 flex-1 items-center justify-center rounded-[10px] border border-[#e8e8e8] transition-colors ${
                value === true ? "bg-made text-inverse" : "text-[#b3b3b3]"
              }`}
            >
              <CheckIcon className="h-6 w-6" />
            </button>

            <button
              type="button"
              aria-label={`Lancer ${index + 1} raté`}
              aria-pressed={value === false}
              onClick={() => void save(index, false)}
              className={`flex h-9 flex-1 items-center justify-center rounded-[10px] border border-[#e8e8e8] transition-colors ${
                value === false ? "bg-missed text-inverse" : "text-[#b3b3b3]"
              }`}
            >
              <CrossIcon className="h-6 w-6" />
            </button>
          </li>
        ))}
      </ol>
    </Sheet>
  );
}
