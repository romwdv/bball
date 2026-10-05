/**
 * Retours haptiques.
 *
 * Le coach regarde le terrain, pas l'écran. Sans retour vibrant, il doit lever
 * les yeux après chaque panier pour savoir si le tir est rentré — c'est le pire
 * des modes d'échec sur un écran tactile.
 *
 * Durées issues des motifs Android/iOS : un « clic » net pour la réussite, un
 * motif long et grave pour l'échec, un motif moyen pour les combos.
 */

type Pattern = number | number[];

const SUCCESS: Pattern = 15;
const MISSED: Pattern = 40;
const COMBO: Pattern = [20, 40, 20];
/** Vibration distinctive d'une annulation : courte, sèche, « on recule ». */
const UNDO: Pattern = [10, 30, 10];

function buzz(pattern: Pattern): void {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.vibrate !== "function"
  ) {
    return;
  }
  try {
    navigator.vibrate(pattern);
  } catch {
    // iOS Safari expose `vibrate` mais ne fait rien ; certains navigateurs
    // lèvent si la page n'est pas visible. Un retour haptique n'est jamais
    // critique : une exception ici ne doit pas interrompre la saisie.
  }
}

/** Tir réussi, lancer réussi. */
export function hapticMade(): void {
  buzz(SUCCESS);
}

/** Tir raté, lancer raté. */
export function hapticMissed(): void {
  buzz(MISSED);
}

/** Combo : panier + faute, tir foulé. Motif distinct du simple panier. */
export function hapticCombo(): void {
  buzz(COMBO);
}

/** Annulation. */
export function hapticUndo(): void {
  buzz(UNDO);
}

/** Action neutre (rebond, passe) : retour minimal, l'action est moins critique. */
export function hapticNeutral(): void {
  buzz(10);
}
