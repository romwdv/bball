"use client";

import type { ActionDraft } from "@/domain/rules";
import { FOUL_LIMIT, type Quarter, type ShotValue } from "@/domain/types";
import { usePress } from "@/ui/usePress";
import { useMatchStore } from "@/features/match/store";
import type { HapticKind } from "@/features/match/store";

/**
 * Grille d'actions (PLAN.md §12).
 *
 * La maquette sépare les gestes en rangées de tailles différentes : les tirs et
 * la faute en haut (cibles de 88 px), les stats rapides en dessous (44 px). La
 * disposition reprend la maquette, les **tailles** reprennent la garantie
 * produit : les quatre gestes principaux restent à 88 px (`--tap-target-action`),
 * les gestes rares à 44 px.
 *
 * Le geste unique — tap = réussi, appui 400 ms = raté — est factorisé par
 * `usePress`, donc implémenté une seule fois dans tout le projet.
 *
 * Les drafts produits ici ne portent **pas** de `groupId` : `append()` le
 * remplit, garantissant qu'un geste = un groupe annulable d'un seul coup.
 */

export interface ActionGridProps {
  playerId: string;
  /**
   * Fautes déjà commises par le joueur suivi, sur **le match entier**.
   *
   * Pas sur la période affichée : la limite à cinq est par rencontre. Un
   * compteur par période laisserait un joueur sorti en Q1 reprendre le terrain
   * en prenant cinq fautes de plus.
   */
  playerFouls?: number;
  onRecord: (drafts: readonly ActionDraft[], kind: HapticKind) => Promise<void>;
  /** Vrai tant que le joueur suivi n'est pas connu. */
  disabled?: boolean;
}

/**
 * La période vient du store, jamais d'une prop — deux sources divergeraient un
 * jour, et l'action atterrirait dans le mauvais quart temps sans aucun signal.
 */
export function ActionGrid({
  playerId,
  playerFouls = 0,
  onRecord,
  disabled = false,
}: ActionGridProps) {
  const quarter = useMatchStore((state) => state.quarter);

  // Un joueur sorti pour 5 fautes ne peut pas en commettre une sixième : le
  // bouton est désactivé plutôt que de laisser le coach enregistrer une faute
  // impossible. Le compteur affiché permet de voir qu'il est arrivé à 5.
  const foulsOut = playerFouls >= FOUL_LIMIT;

  return (
    <div className="flex flex-col gap-2 px-4">
      <div className="grid grid-cols-2 gap-2">
        <ShotButton
          playerId={playerId}
          quarter={quarter}
          value={2}
          onRecord={onRecord}
          disabled={disabled}
        />
        <ShotButton
          playerId={playerId}
          quarter={quarter}
          value={3}
          onRecord={onRecord}
          disabled={disabled}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <FoulButton
          playerId={playerId}
          quarter={quarter}
          fouls={playerFouls}
          onRecord={onRecord}
          disabled={disabled || foulsOut}
        />
        <FreeThrowButton
          playerId={playerId}
          quarter={quarter}
          onRecord={onRecord}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

interface CellProps {
  playerId: string;
  quarter: Quarter;
  onRecord: ActionGridProps["onRecord"];
  disabled: boolean;
}

function ShotButton({
  playerId,
  quarter,
  value,
  onRecord,
  disabled,
}: CellProps & { value: ShotValue }) {
  const { handlers, isPressed } = usePress({
    onTap: () =>
      onRecord(
        [{ kind: "shot", playerId, quarter, value, made: true }],
        "made",
      ),
    onLongPress: () =>
      onRecord(
        [{ kind: "shot", playerId, quarter, value, made: false }],
        "missed",
      ),
  });

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`${value} points — tap réussi, appui 400 ms raté`}
      className={`flex min-h-tap-action flex-col items-center justify-center rounded-[10px] transition-colors ${
        isPressed ? "border-2 border-made bg-made-subtle" : "bg-white"
      } ${disabled ? "opacity-40" : ""}`}
      style={{ touchAction: "none" }}
      {...handlers}
    >
      <span className="font-display text-[19px] font-light text-primary">
        {value} PTS
      </span>
      <span className="font-label text-[13px] font-semibold text-muted">
        Tap / 400ms
      </span>
    </button>
  );
}

function FoulButton({
  playerId,
  quarter,
  fouls,
  onRecord,
  disabled,
}: CellProps & { fouls: number }) {
  const { handlers, isPressed } = usePress({
    onTap: () => onRecord([{ kind: "foul", playerId, quarter }], "neutral"),
  });

  const out = fouls >= FOUL_LIMIT;

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={
        out
          ? `Faute — ${FOUL_LIMIT} fautes, joueur sorti`
          : `Faute ${fouls + 1} sur ${FOUL_LIMIT}`
      }
      className={`flex min-h-tap-action flex-col items-center justify-center rounded-[10px] transition-colors ${
        isPressed ? "opacity-70" : ""
      } ${disabled ? "opacity-40" : ""}`}
      style={{ touchAction: "none", backgroundColor: "#ec5151" }}
      {...handlers}
    >
      <span className="font-display text-[19px] font-light text-inverse">
        FAUTE
      </span>
      <span className="tabular font-label text-[13px] font-semibold text-inverse/80">
        {Math.min(fouls + 1, FOUL_LIMIT)}/{FOUL_LIMIT}
      </span>
    </button>
  );
}

function FreeThrowButton({ playerId, quarter, onRecord, disabled }: CellProps) {
  const { handlers, isPressed } = usePress({
    onTap: () =>
      onRecord([{ kind: "free_throw", playerId, quarter, made: true }], "made"),
    onLongPress: () =>
      onRecord(
        [{ kind: "free_throw", playerId, quarter, made: false }],
        "missed",
      ),
  });

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label="Lancer libre — tap réussi, appui 400 ms raté"
      className={`flex min-h-tap-action flex-col items-center justify-center rounded-[10px] transition-colors ${
        isPressed ? "border-2 border-made bg-made-subtle" : "bg-white"
      } ${disabled ? "opacity-40" : ""}`}
      style={{ touchAction: "none" }}
      {...handlers}
    >
      <span className="font-display text-[19px] font-light text-primary">
        LF
      </span>
      <span className="font-label text-[13px] font-semibold text-muted">
        Tap / 400ms
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Stats rapides
// ---------------------------------------------------------------------------

interface AdvancedButton {
  label: string;
  name: string;
  build: (playerId: string, quarter: Quarter) => ActionDraft[];
}

/**
 * Libellés de la maquette (PLAN.md §12) : RD, RO, PD, BP, CTR, INT.
 */
const ADVANCED: readonly AdvancedButton[] = [
  {
    label: "RD",
    name: "Rebond défensif",
    build: (playerId, quarter) => [
      { kind: "rebound", playerId, quarter, side: "defensive" },
    ],
  },
  {
    label: "RO",
    name: "Rebond offensif",
    build: (playerId, quarter) => [
      { kind: "rebound", playerId, quarter, side: "offensive" },
    ],
  },
  {
    label: "PD",
    name: "Passe décisive",
    build: (playerId, quarter) => [{ kind: "assist", playerId, quarter }],
  },
  {
    label: "BP",
    name: "Perte de balle",
    build: (playerId, quarter) => [{ kind: "turnover", playerId, quarter }],
  },
  {
    label: "CTR",
    name: "Contre",
    build: (playerId, quarter) => [{ kind: "block", playerId, quarter }],
  },
  {
    label: "INT",
    name: "Interception",
    build: (playerId, quarter) => [{ kind: "steal", playerId, quarter }],
  },
];

/**
 * Bandeau des stats rapides.
 *
 * Cibles de 44 px et non 88 : ces gestes sont bien plus rares qu'un tir, et un
 * joueur y passe plus de temps. Les mélanger aux cibles de 88 px aplatirait la
 * hiérarchie visuelle de la maquette.
 */
export interface AdvancedStatsBarProps {
  playerId: string;
  onRecord: (drafts: readonly ActionDraft[], kind: HapticKind) => Promise<void>;
  disabled?: boolean;
}

export function AdvancedStatsBar({
  playerId,
  onRecord,
  disabled = false,
}: AdvancedStatsBarProps) {
  const quarter = useMatchStore((state) => state.quarter);

  return (
    <div className="grid grid-cols-6 gap-1.5 px-4">
      {ADVANCED.map((definition) => (
        <AdvancedCell
          key={definition.label}
          definition={definition}
          onRecord={onRecord}
          playerId={playerId}
          quarter={quarter}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

interface AdvancedCellProps extends CellProps {
  definition: AdvancedButton;
}

function AdvancedCell({
  definition,
  playerId,
  quarter,
  onRecord,
  disabled,
}: AdvancedCellProps) {
  const { handlers, isPressed } = usePress({
    onTap: () => onRecord(definition.build(playerId, quarter), "neutral"),
  });

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={definition.name}
      className={`min-h-tap-min rounded-[10px] font-display text-[19px] font-light text-primary transition-colors ${
        isPressed ? "bg-accent-subtle" : "bg-white"
      } ${disabled ? "opacity-40" : ""}`}
      style={{ touchAction: "none" }}
      {...handlers}
    >
      {definition.label}
    </button>
  );
}
