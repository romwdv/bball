"use client";

import type { ActionDraft } from "@/domain/rules";
import { FOUL_LIMIT, type Quarter, type ShotValue } from "@/domain/types";
import { usePress } from "@/ui/usePress";
import { useMatchStore } from "@/features/match/store";
import type { HapticKind } from "@/features/match/store";

/**
 * Grille d'actions (PLAN.md §4).
 *
 * Chaque cible principale fait 88 px (`--tap-target-action`) : en gymnase, avec
 * un téléphone tenu à une main et le regard sur le terrain, une cible plus petite
 * se rate. Le coach n'a pas le temps de viser.
 *
 * Le geste unique — tap = réussi, appui 400 ms = raté — est factorisé par
 * `usePress`, donc implémenté une seule fois dans tout le projet. C'est ce qui
 * rend ce comportement testable à un seul endroit.
 *
 * Les drafts produits ici ne portent **pas** de `groupId`. Le champ est optionnel
 * dans le schéma du domaine, et `append()` le remplit : c'est la seule façon de
 * garantir qu'un geste = un groupe annulable d'un seul coup. Les `combos.*` du
 * domaine l'exigent parce qu'ils servent à composer un lot déjà groupé ; ici on
 * écrit un seul geste à la fois, donc le champ n'a pas lieu d'être.
 */

export interface ActionGridProps {
  playerId: string;
  /**
   * Fautes déjà commises par le joueur suivi, sur **le match entier**.
   *
   * Pas sur la période affichée : la limite à cinq est par rencontre, et c'est ce
   * qui déclenche le blocage du bouton. Un compteur par période laisserait un
   * joueur sorti en Q1 reprendre le terrain en prenant cinq fautes de plus.
   */
  playerFouls?: number;
  onRecord: (drafts: readonly ActionDraft[], kind: HapticKind) => Promise<void>;
  /** Vrai tant que le joueur suivi n'est pas connu. */
  disabled?: boolean;
}

/**
 * La période vient du store, jamais d'une prop.
 *
 * Le sélecteur Q1–Q4 du header et l'écriture en base doivent partager la même
 * valeur ; deux sources (prop + store) finiraient un jour par diverger, et
 * l'action atterrirait dans le mauvais quart temps sans aucun signal.
 */
export function ActionGrid({
  playerId,
  playerFouls = 0,
  onRecord,
  disabled = false,
}: ActionGridProps) {
  const quarter = useMatchStore((state) => state.quarter);
  const [value2, value3] = [2, 3] as const;

  // Un joueur sorti pour 5 fautes ne peut pas en commettre une sixième : le
  // bouton est désactivé plutôt que de laisser le coach enregistrer une faute
  // impossible et de fausser le décompte. Le compteur affiché sur le bouton
  // permet de voir qu'il est arrivé à 5 sans regarder le carrousel.
  const foulsOut = playerFouls >= FOUL_LIMIT;

  return (
    <div className="grid grid-cols-2 gap-2 px-4">
      <ShotButton
        playerId={playerId}
        quarter={quarter}
        value={value2}
        onRecord={onRecord}
        disabled={disabled}
      />
      <ShotButton
        playerId={playerId}
        quarter={quarter}
        value={value3}
        onRecord={onRecord}
        disabled={disabled}
      />
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
        [
          {
            kind: "shot",
            playerId,
            quarter,
            value,
            made: true,
          },
        ],
        "made",
      ),
    onLongPress: () =>
      onRecord(
        [
          {
            kind: "shot",
            playerId,
            quarter,
            value,
            made: false,
          },
        ],
        "missed",
      ),
  });

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`${value} points — tap réussi, appui 400 ms raté`}
      className={`flex min-h-tap-action flex-col items-center justify-center rounded-xl border transition-colors ${
        isPressed ? "border-made bg-made/25" : "border-edge-strong bg-raised"
      } ${disabled ? "opacity-40" : ""}`}
      style={{ touchAction: "none" }}
      {...handlers}
    >
      <span className="text-xl font-bold">{value} PTS</span>
      <span className="text-xs text-muted">tap / 400 ms</span>
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
      // L'intitulé annonce *pourquoi* le bouton est mort, sinon le coach
      // conclut que l'app a planté et il tape plus fort.
      aria-label={
        out
          ? `Faute — ${FOUL_LIMIT} fautes, joueur sorti`
          : `Faute ${fouls + 1} sur ${FOUL_LIMIT}`
      }
      className={`flex min-h-tap-action flex-col items-center justify-center rounded-xl border text-lg font-semibold transition-colors ${
        isPressed
          ? "border-foul bg-foul/25"
          : "border-foul/40 bg-foul-subtle text-foul"
      } ${disabled ? "opacity-40" : ""}`}
      style={{ touchAction: "none" }}
      {...handlers}
    >
      FAUTE
      <span className="tabular text-xs font-normal opacity-80">
        {Math.min(fouls + 1, FOUL_LIMIT)}/{FOUL_LIMIT}
      </span>
    </button>
  );
}

function FreeThrowButton({ playerId, quarter, onRecord, disabled }: CellProps) {
  const { handlers, isPressed } = usePress({
    onTap: () =>
      onRecord(
        [
          {
            kind: "free_throw",
            playerId,
            quarter,
            made: true,
          },
        ],
        "made",
      ),
    onLongPress: () =>
      onRecord(
        [
          {
            kind: "free_throw",
            playerId,
            quarter,
            made: false,
          },
        ],
        "missed",
      ),
  });

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label="Lancer libre — tap réussi, appui 400 ms raté"
      className={`flex min-h-tap-action flex-col items-center justify-center rounded-xl border transition-colors ${
        isPressed ? "border-made bg-made/25" : "border-edge-strong bg-raised"
      } ${disabled ? "opacity-40" : ""}`}
      style={{ touchAction: "none" }}
      {...handlers}
    >
      <span className="text-xl font-bold">LF</span>
      <span className="text-xs text-muted">tap / 400 ms</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Stats avancées
// ---------------------------------------------------------------------------

interface AdvancedButton {
  label: string;
  name: string;
  build: (playerId: string, quarter: Quarter) => ActionDraft[];
}

const ADVANCED: readonly AdvancedButton[] = [
  {
    label: "RB",
    name: "Rebond offensif",
    build: (playerId, quarter) => [
      { kind: "rebound", playerId, quarter, side: "offensive" },
    ],
  },
  {
    label: "RB+",
    name: "Rebond défensif",
    build: (playerId, quarter) => [
      { kind: "rebound", playerId, quarter, side: "defensive" },
    ],
  },
  {
    label: "P",
    name: "Passe décisive",
    build: (playerId, quarter) => [{ kind: "assist", playerId, quarter }],
  },
  {
    label: "PD",
    name: "Perte de balle",
    build: (playerId, quarter) => [{ kind: "turnover", playerId, quarter }],
  },
  {
    label: "CT",
    name: "Contre",
    build: (playerId, quarter) => [{ kind: "block", playerId, quarter }],
  },
  {
    label: "IC",
    name: "Interception",
    build: (playerId, quarter) => [{ kind: "steal", playerId, quarter }],
  },
];

/**
 * Bandeau des stats avancées.
 *
 * Cibles de 44 px et non 88 : ces gestes sont bien plus rares qu'un tir, et un
 * joueur y passe plus de temps. Les mélanger aux cibles de 88 px aplatirait la
 * hiérarchie visuelle du plan §4 ; les mettre en dessous la préserve.
 *
 * Un seul geste, pas de tap/appui long : ces actions n'ont pas d'état binaire,
 * donc le geste long n'aurait aucun sens à déclencher.
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
      className={`min-h-tap-min rounded-lg border text-sm font-semibold transition-colors ${
        isPressed ? "border-accent bg-accent-subtle" : "border-edge bg-raised"
      } ${disabled ? "opacity-40" : ""}`}
      style={{ touchAction: "none" }}
      {...handlers}
    >
      {definition.label}
    </button>
  );
}
