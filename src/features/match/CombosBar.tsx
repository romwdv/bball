"use client";

import { awardedFreeThrows } from "@/domain/rules";
import type { ActionDraft } from "@/domain/rules";
import type { ActionRow } from "@/data/schema";
import type { Quarter } from "@/domain/types";
import { useMatchStore } from "@/features/match/store";
import { usePress } from "@/ui/usePress";
import type { HapticKind } from "@/features/match/store";

/**
 * Bandeau de combos (PLAN.md §4).
 *
 * Quatre boutons : `2P+F`, `3P+F`, `R+F+2LF`, `R+F+3LF`.
 *
 * `2P+F` et `3P+F` sont **un seul geste**, pas deux appuis. C'est la seule façon
 * d'enregistrer un and-1 correctement : deux appuis successifs laisseraient un
 * instant intermédiaire où le panier est compté sans la faute, et un coach qui
 * regarde le terrain à ce moment-là ne le verrait pas.
 *
 * Les quatre ouvrent la mini-sheet de lancers, y compris `2P+F` et `3P+F` : un
 * and-1 laisse **un** lancer à entrer. Sans ça, le coach devait passer par le
 * bouton `LF` de la grille, et ce lancer n'était lié à rien — l'annulation
 * groupée ne le regroupait pas avec le panier et la faute qu'il sanctionnait.
 *
 * `R+F+2LF` et `R+F+3LF` : le tir raté n'est pas compté en tentative (règle
 * non-FIBA assumée, PLAN.md §1) ; seule la faute l'est. Le nombre de lancers vient
 * de `awardedFreeThrows()`, jamais d'une constante écrite ici.
 *
 * Chaque combo écrit **une seule action** : l'annulation groupée vient du
 * domaine (`undoScope`), ce composant n'a pas à s'en préoccuper.
 */

export interface CombosBarProps {
  playerId: string | null;
  disabled: boolean;
  onRecord: (
    drafts: readonly ActionDraft[],
    kind: HapticKind,
  ) => Promise<readonly ActionRow[]>;
}

interface ComboDefinition {
  label: string;
  name: string;
  build: (playerId: string, quarter: Quarter) => readonly ActionDraft[];
  haptic: HapticKind;
}

/**
 * Aucun combo n'a de « nombre de lancers » : il est **déduit de l'action écrite**
 * par `awardedFreeThrows`. Écrire `1` en dur sur `2P+F` et `2` sur `R+F+2LF`
 * créerait deux vérités qui divergeraient le jour où la règle change.
 */
const COMBOS: readonly ComboDefinition[] = [
  {
    label: "2P+F",
    name: "Panier 2 points + faute + 1 lancer",
    haptic: "combo",
    build: (playerId, quarter) => [
      {
        kind: "shot",
        playerId,
        quarter,
        value: 2,
        made: true,
        fouled: true,
      },
    ],
  },
  {
    label: "3P+F",
    name: "Panier 3 points + faute + 1 lancer",
    haptic: "combo",
    build: (playerId, quarter) => [
      {
        kind: "shot",
        playerId,
        quarter,
        value: 3,
        made: true,
        fouled: true,
      },
    ],
  },
  {
    label: "R+F+2LF",
    name: "Tir raté + faute + 2 lancers",
    haptic: "combo",
    build: (playerId, quarter) => [
      {
        kind: "shot",
        playerId,
        quarter,
        value: 2,
        made: false,
        fouled: true,
      },
    ],
  },
  {
    label: "R+F+3LF",
    name: "Tir raté + faute + 3 lancers",
    haptic: "combo",
    build: (playerId, quarter) => [
      {
        kind: "shot",
        playerId,
        quarter,
        value: 3,
        made: false,
        fouled: true,
      },
    ],
  },
];

export function CombosBar({ playerId, disabled, onRecord }: CombosBarProps) {
  // La période vient du store, comme dans la grille d'actions : une seule
  // source, sinon le header afficherait Q3 pendant que l'action part en Q2.
  const quarter = useMatchStore((state) => state.quarter);
  const openFreeThrowSheet = useMatchStore((state) => state.openFreeThrowSheet);

  return (
    <div className="scroll-x-touch flex gap-2 px-4">
      {COMBOS.map((combo) => (
        <ComboButton
          key={combo.label}
          definition={combo}
          playerId={playerId}
          quarter={quarter}
          disabled={disabled}
          onRecord={onRecord}
          openFreeThrowSheet={openFreeThrowSheet}
        />
      ))}
    </div>
  );
}

interface ComboButtonProps {
  definition: ComboDefinition;
  playerId: string | null;
  quarter: Quarter;
  disabled: boolean;
  onRecord: CombosBarProps["onRecord"];
  openFreeThrowSheet: (groupId: string, due: number) => void;
}

function ComboButton({
  definition,
  playerId,
  quarter,
  disabled,
  onRecord,
  openFreeThrowSheet,
}: ComboButtonProps) {
  const { handlers, isPressed } = usePress({
    onTap: () => void run(),
  });

  async function run() {
    if (playerId === null || disabled) return;

    const written = await onRecord(
      definition.build(playerId, quarter),
      definition.haptic,
    );

    // Le nombre de lancers est relu sur l'action **écrite** via
    // `awardedFreeThrows`, jamais déduit du bouton pressé. Si la règle métier
    // change un jour, la fiche affichera le bon nombre sans qu'un seul bouton
    // de ce fichier soit touché.
    const fouled = written.find((action) => awardedFreeThrows(action) !== null);
    if (fouled === undefined) return;

    const due = awardedFreeThrows(fouled) ?? 0;
    if (due > 0) openFreeThrowSheet(fouled.groupId ?? "", due);
  }

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={definition.name}
      className={`min-h-tap-min shrink-0 rounded-lg border px-4 text-sm font-semibold transition-colors ${
        isPressed
          ? "border-accent bg-accent-subtle"
          : "border-edge-strong bg-raised"
      } ${disabled ? "opacity-40" : ""}`}
      style={{ touchAction: "none" }}
      {...handlers}
    >
      {definition.label}
    </button>
  );
}
