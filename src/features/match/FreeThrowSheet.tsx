"use client";

import { useState } from "react";
import { combos } from "@/domain/rules";
import type { Quarter } from "@/domain/types";
import { Sheet } from "@/ui/Sheet";
import { useMatchStore } from "@/features/match/store";

/**
 * Mini-sheet de saisie des lancers.
 *
 * Ouverte par les combos `R+F+2LF` et `R+F+3LF`, c'est-à-dire quand un tir
 * manqué est suivi d'une faute. Le nombre de lancers dus vient de
 * `awardedFreeThrows()`, jamais d'un décompte maison : c'est la règle métier du
 * domaine, et la redéfinir dans l'UI créerait deux vérités.
 *
 * Les compteurs sont cliquables et les boutons ✓ / ✗ enregistrent un lancer
 * **à la fois**. Enregistrer toute la série d'un coup serait tentant, mais sur
 * une série le coach change d'avis à chaque ballon — il en rate un sur trois
 * très souvent. Un geste par ballon est le seul granulaire qui reste utilisable.
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
      footer={
        <button
          type="button"
          onClick={closeSheet}
          className="min-h-tap-action w-full rounded-xl bg-accent text-lg font-semibold text-inverse"
        >
          {remaining === 0 ? "Terminé" : "Terminer"}
        </button>
      }
    >
      <ol className="flex flex-col gap-3">
        {results.map((value, index) => (
          <li
            key={index}
            className="flex items-center gap-2 rounded-xl border border-edge bg-raised p-2"
          >
            <span className="tabular w-8 shrink-0 text-sm text-muted">
              LF{index + 1}
            </span>

            <button
              type="button"
              aria-label={`Lancer ${index + 1} réussi`}
              aria-pressed={value === true}
              onClick={() => void save(index, true)}
              className={`min-h-tap-min flex-1 rounded-lg border text-lg font-bold ${
                value === true
                  ? "border-made bg-made-subtle text-made"
                  : "border-edge-strong bg-raised text-secondary"
              }`}
            >
              ✓
            </button>

            <button
              type="button"
              aria-label={`Lancer ${index + 1} raté`}
              aria-pressed={value === false}
              onClick={() => void save(index, false)}
              className={`min-h-tap-min flex-1 rounded-lg border text-lg font-bold ${
                value === false
                  ? "border-missed bg-missed-subtle text-missed"
                  : "border-edge-strong bg-raised text-secondary"
              }`}
            >
              ✗
            </button>
          </li>
        ))}
      </ol>
    </Sheet>
  );
}
