"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Distinguer « tap » et « appui long » sur un même bouton.
 *
 * C'est le geste central de l'écran de saisie (PLAN.md §4) : un tap enregistre
 * un tir réussi, un appui de 400 ms enregistre un tir raté. Réduire l'UI à deux
 * boutons par type de tir rendrait la grille illisible en bord de terrain.
 *
 * Pourquoi pas `onClick` + `onContextMenu` : sur iOS, le clic long ouvre le menu
 * contextuel et la détection du maintien n'est pas fiable. Un minuteur posé à
 * `pointerdown` est le seul comportement identique sur les deux plateformes.
 *
 * Règles appliquées :
 * - l'appui long **annule** le tap : sans ça, un appui de 600 ms enregistrerait
 *   les deux, un panier et un raté, et le score serait faux ;
 * - le pointeur qui quitte la cible annule le minuteur : un glissement pour scroller
 *   ne doit pas valider un tir ;
 * - `touch-action: none` est posé par l'appelant, pas ici, pour ne pas casser le
 *   défilement des composants parents.
 */

/** Durée d'appui qui bascule en « manqué ». 400 ms : assez long pour être voulu. */
export const LONG_PRESS_MS = 400;

export interface PressHandlers {
  /** Appui court : tir réussi. */
  onTap?: () => void;
  /** Appui maintenu 400 ms : tir raté. */
  onLongPress?: () => void;
}

export interface PressHandlersBag {
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerUp: (event: React.PointerEvent) => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
  /** Neutralise le menu contextuel iOS, qui avalerait l'appui long. */
  onContextMenu: (event: React.MouseEvent) => void;
}

export interface UsePressResult extends PressHandlers {
  handlers: PressHandlersBag;
  /** L'élément est-il pressé ? Sert au retour visuel. */
  isPressed: boolean;
}

export function usePress({
  onTap,
  onLongPress,
}: PressHandlers): UsePressResult {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFired = useRef(false);
  /** Un appui est-il en cours ? Empêche un tap orphelin au relâchement. */
  const pressing = useRef(false);
  const [isPressed, setIsPressed] = useState(false);

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const handlers: PressHandlersBag = {
    onPointerDown: (event: React.PointerEvent) => {
      // Ignore les pointeurs secondaires (stylet, second doigt) : un second
      // contact simultané ne doit pas créer d'action fantôme.
      if (!event.isPrimary) return;
      // Un bouton désactivé ne doit rien enregistrer, même si l'environnement
      // lui délivre quand même l'événement. Les navigateurs ne dispatchent pas
      // de pointer events sur un élément désactivé, mais s'y fier laisserait la
      // garantie dépendre du navigateur — et un `disabled` qui n'empêche rien
      // d'écrire est le genre d'incohérence qui ne se voit qu'en match.
      if (isDisabled(event.currentTarget)) return;
      longFired.current = false;
      pressing.current = true;
      setIsPressed(true);
      if (onLongPress === undefined) return;
      timer.current = setTimeout(() => {
        longFired.current = true;
        timer.current = null;
        onLongPress();
      }, LONG_PRESS_MS);
    },
    onPointerUp: (event: React.PointerEvent) => {
      setIsPressed(false);
      cancel();
      const wasPressed = pressing.current && !isDisabled(event.currentTarget);
      pressing.current = false;
      // Deux cas où rien ne doit être enregistré : l'appui long a déjà consommé
      // le geste, et un relâchement sans appui précédent n'est pas un tap. Sans
      // cette seconde garde, un `pointerup` isolé enregistrait une action.
      if (longFired.current || !wasPressed) return;
      onTap?.();
    },
    onPointerLeave: () => {
      setIsPressed(false);
      pressing.current = false;
      cancel();
    },
    onPointerCancel: () => {
      setIsPressed(false);
      pressing.current = false;
      cancel();
    },
    onContextMenu: (event: React.MouseEvent) => {
      event.preventDefault();
    },
  };

  // Un démontage pendant l'attente (navigation) ne doit pas laisser un minuteur
  // en vol : il déclencherait un tir raté dans un composant mort.
  useEffect(() => cancel, [cancel]);

  return { onTap, onLongPress, handlers, isPressed };
}

/** L'élément est-il explicitement désactivé ? */
function isDisabled(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target as HTMLButtonElement & { disabled?: boolean }).disabled === true
  );
}
