"use client";

import { useEffect } from "react";
import { hapticUndo } from "@/ui/haptics";

/**
 * Toast d'annulation, avec son compteur de 4 secondes (PLAN.md §4).
 *
 * Le toast n'est pas une décoration : c'est le filet de sécurité de
 * l'appui long. Un tir raté est un geste ambigu (le coach a voulu un panier, ou
 * un raté ?), et sans issue visible pendant 4 secondes il resterait bloqué sur
 * son erreur au lieu de corriger et continuer. `Réfaire` est donc aussi important
 * que le compte à rebours lui-même.
 *
 * `duration` est une durée de **visibilité**, pas de vie : `role="status"` et
 * `aria-live="polite"` annoncent le texte au lecteur d'écran quand il apparaît.
 */

export interface ToastMessage {
  /** Identifiant, pour rejouer la même animation si le message est identique. */
  id: number;
  text: string;
  /** Action de rétablissement, absente si rien à rétablir. */
  onUndo?: () => void;
  undoLabel?: string;
}

export interface ToastProps {
  message: ToastMessage | null;
  duration?: number;
  onDismiss: () => void;
}

/** 4 s : assez pour lire et décider, assez court pour ne pas gêner la suite. */
export const UNDO_WINDOW_MS = 4000;

export function Toast({
  message,
  duration = UNDO_WINDOW_MS,
  onDismiss,
}: ToastProps) {
  // Le minuteur est le seul effet, et il ne fait qu'appeler `onDismiss` — donc
  // plus aucun `setState` dans un effet. `message === null` suffit à masquer le
  // toast : l'animateur est CSS.
  useEffect(() => {
    if (message === null) return;
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [message, duration, onDismiss]);

  if (message === null) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--tap-target-action)+var(--safe-bottom)+1rem)] z-40 flex justify-center px-4"
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-edge-strong bg-overlay px-4 py-2 shadow-lg">
        <span className="text-sm">{message.text}</span>
        {message.onUndo !== undefined && (
          <button
            type="button"
            onClick={() => {
              hapticUndo();
              message.onUndo?.();
              onDismiss();
            }}
            className="min-h-11 rounded-full bg-accent px-4 text-sm font-semibold text-inverse"
          >
            {message.undoLabel ?? "Réfaire"}
          </button>
        )}
      </div>
    </div>
  );
}
