"use client";

import { useEffect } from "react";

/**
 * Acquittement immédiat d'une saisie.
 *
 * Séparé du `Toast` d'annulation, qui est un **correctif** proposé au coach.
 * Ici c'est un **acquittement** : le coach vient d'appuyer, l'app confirme.
 *
 * La raison d'exister est le tir raté. Un appui long ne change ni le score, ni
 * les points du joueur, ni les pastilles de fautes — avant l'affichage des tirs
 * `réussis/tentés`, il n'était **strictement rien** de visible à l'écran. Le
 * coach ne pouvait pas distinguer « mon geste est passé » de « mon geste a été
 * ignoré », et le second cas l'amenait soit à recommencer, soit à passer au
 * joueur suivant en croyant le tir compté.
 *
 * Une seconde et demie : assez pour être lu en Peripheral, pas assez pour
 * masquer la grille d'actions. Pas de bouton — acquitter une saisie qui n'a pas
 * besoin d'être reprise n'a rien à offrir.
 *
 * `pointer-events-none` : la bannière ne doit jamais intercepter un appui sur les
 * cibles du dessous, sinon le coach raterait un panier en voulant le voir.
 */

export interface FlashMessage {
  id: number;
  text: string;
  /** Le geste a échoué : retour visuel plus fort. */
  missed: boolean;
}

export interface FlashProps {
  message: FlashMessage | null;
  duration?: number;
  onDismiss: () => void;
}

/** 1,1 s : lu d'un coup d'œil, gone avant la prochaine action. */
export const FLASH_MS = 1100;

export function Flash({ message, duration = FLASH_MS, onDismiss }: FlashProps) {
  useEffect(() => {
    if (message === null) return;
    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [message, duration, onDismiss]);

  if (message === null) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(var(--safe-top)+3rem)] z-40 flex justify-center px-4">
      <span
        key={message.id}
        // Le rôle est sur le texte et pas sur le conteneur : c'est le contenu
        // qui doit être annoncé, et le style qui le distingue est sur ce même
        // nœud.
        role="status"
        aria-live="polite"
        className={`rounded-full border px-4 py-1.5 text-sm font-semibold tabular ${
          message.missed
            ? "border-missed bg-missed-subtle text-missed"
            : "border-made/50 bg-made-subtle text-made"
        }`}
      >
        {message.text}
      </span>
    </div>
  );
}
