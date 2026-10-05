"use client";

import type { ReactNode } from "react";

/**
 * Feuille modale qui remonte du bas de l'écran.
 *
 * Deux décisions dictées par le terrain, pas par l'esthétique :
 *
 * 1. **Rien d'autre ne bouge.** Un fond semi-transparent mais pas de `blur`
 *    derrière : sur un téléphone d'entrée de gamme, un `backdrop-filter` fait
 *    tomber la fluidité à 30 fps au moment précis où le coach valide un tir.
 * 2. **Les boutons sont dans le bas.** La fiche est ouverte par un geste au
 *    pouce, et validée par un autre geste au pouce. Reaching for the top of the
 *    screen to confirm is what breaks the flow.
 *
 * Fermeture par le bouton ou `Escape` : pas de fermeture au clic sur le fond.
 * Une annulation accidentelle en cours de saisie ferait perdre un combo entier,
 * et le coach ne le verrait pas tout de suite.
 */
export interface SheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Pied de fiche, typiquement la rangée de boutons d'action. */
  footer?: ReactNode;
}

export function Sheet({ open, title, onClose, children, footer }: SheetProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60" aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex max-h-[85dvh] flex-col rounded-t-2xl border-t border-edge-strong bg-raised pb-(--padding-safe-b)"
      >
        <header className="flex items-center justify-between gap-3 border-b border-edge px-4 py-3 pt-(--padding-safe-t)">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-tap-min min-w-tap-min rounded-lg text-sm text-secondary"
          >
            Fermer
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {children}
        </div>

        {footer !== undefined && (
          <div className="border-t border-edge px-4 py-3">{footer}</div>
        )}
      </div>
    </div>
  );
}
