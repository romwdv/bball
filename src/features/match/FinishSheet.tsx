"use client";

import { useMemo } from "react";
import type { Action, Match, Player } from "@/domain/types";
import { FOUL_LIMIT } from "@/domain/types";
import { aggregateFor, pendingFreeThrows, playerLabel } from "@/domain/stats";
import { repos } from "@/data";
import { Sheet } from "@/ui/Sheet";
import { hapticNeutral } from "@/ui/haptics";

/**
 * Confirmation de clôture d'un match.
 *
 * Une confirmation, pas un dialogue de politesse : la clôture est la **seule**
 * opération du projet qui rend une saisie impossible. Le plan §5 verrouille
 * l'écriture sur un match terminé — c'est ce qui garantit que les stats exportées
 * ne divergent jamais de ce que le coach vient de voir à l'écran. Une fausse
 * manœuvre se répare donc par « rouvrir », pas par « annuler ».
 *
 * La fiche montre ce qui reste dû **avant** de confirmer. Un lancer oublié
 * découvert après la clôture oblige à rouvrir, resaisir, refermer : autant
 * l'écrire ici, où le coach peut encore agir.
 *
 * Les données viennent des props, pas de la base : le composant ne charge rien,
 * il affiche ce que l'écran a déjà lu. Un composant qui lit lui-même la base est
 * un composant qu'on ne peut pas tester sans IndexedDB.
 */

export interface FinishSheetProps {
  match: Match;
  players: readonly Player[];
  /** Actions actives du match, déjà chargées par l'écran. */
  actions: readonly Action[];
  onCancel: () => void;
  onFinished: () => void;
}

export function FinishSheet({
  match,
  players,
  actions,
  onCancel,
  onFinished,
}: FinishSheetProps) {
  /** Lancers dûs mais jamais saisis — le seul écart réparable avant clôture. */
  const pending = useMemo(() => pendingFreeThrows(actions), [actions]);

  const foulsByPlayer = useMemo(() => {
    const map = new Map<string, number>();
    for (const player of players) {
      map.set(player.id, aggregateFor(actions, player.id).fouls);
    }
    return map;
  }, [players, actions]);

  const outOfTheGame = players.filter(
    (player) => (foulsByPlayer.get(player.id) ?? 0) >= FOUL_LIMIT,
  );

  const score = players.reduce(
    (sum, player) => sum + aggregateFor(actions, player.id).points,
    0,
  );

  async function finish() {
    hapticNeutral();
    await repos().matches.setStatus(match.id, "finished");
    onFinished();
  }

  return (
    <Sheet
      open
      title="Terminer le match"
      onClose={onCancel}
      footer={
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-tap-action rounded-[10px] bg-white font-display text-lg font-light text-primary"
          >
            Continuer
          </button>
          <button
            type="button"
            onClick={() => void finish()}
            className="min-h-tap-action rounded-[10px] bg-accent font-display text-lg font-light text-inverse"
          >
            Terminer
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <p>
          Score final : <span className="tabular font-semibold">{score}</span>{" "}
          pts contre {match.opponentName}.
        </p>

        {pending > 0 && (
          <p className="rounded-xl border border-warning/40 bg-warning-subtle px-3 py-2 text-warning">
            {pending} lancer{pending > 1 ? "s" : ""} libre
            {pending > 1 ? "s" : ""} dû{pending > 1 ? "s" : ""} mais jamais
            saisi{pending > 1 ? "s" : ""}. Les clôturer maintenant, ou les
            ignorer : ils disparaîtront des statistiques.
          </p>
        )}

        {outOfTheGame.length > 0 && (
          <p className="text-secondary">
            {outOfTheGame.length} joueur{outOfTheGame.length > 1 ? "s" : ""} à{" "}
            {FOUL_LIMIT} fautes :{" "}
            {outOfTheGame.map((player) => playerLabel(player)).join(", ")}.
          </p>
        )}

        <p className="text-secondary">
          Après la clôture, la saisie est bloquée. Pour corriger une erreur, il
          faudra rouvrir le match.
        </p>
      </div>
    </Sheet>
  );
}
