import type { SVGProps } from "react";

/**
 * Icônes de l'application, écrites à la main — aucune dépendance d'icônes.
 *
 * Les tracés reprennent les bibliothèques utilisées dans la maquette Penpot
 * (PLAN.md §12) : `formkit:add`, `mdi:delete-circle`, `mynaui:undo`,
 * `material-symbols-light:history`, `mage:dashboard-chart`, `lets-icons:check-fill`,
 * `ix:error-filled`, `streamline-plump:ball-solid`. Recopier un tracé SVG connu
 * vaut mieux qu'ajouter un paquet de 4000 icônes pour en utiliser sept.
 *
 * Chaque icône prend `currentColor` par défaut : la couleur vient de la classe
 * du parent, et le composant n'a pas à la connaître.
 */

type IconProps = SVGProps<SVGSVGElement>;

/** Ballon de basket — le logo (maquette `streamline-plump:ball-solid`). */
export function BallIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        fill="currentColor"
        d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm7.93 9H14.6c.1-1.6.7-3 1.7-4.2A8.05 8.05 0 0 1 19.93 11ZM12 4c1.5 0 2.7.5 3.6 1.3-1 1.2-1.7 2.8-1.8 4.7H10.2c-.1-1.9-.8-3.5-1.8-4.7C9.3 4.5 10.5 4 12 4Zm-5.3 2.8A9.9 9.9 0 0 1 8.4 11H4.07a8.05 8.05 0 0 1 2.63-4.2ZM4 12h4.4c0 2-.6 3.7-1.6 5A8 8 0 0 1 4 12Zm2 6.2c.9-1.2 1.6-2.9 1.8-4.7h4.4c.1 1.8.8 3.5 1.8 4.7A7.96 7.96 0 0 1 6 18.2ZM12 20c-1.5 0-2.7-.5-3.6-1.3 1-1.2 1.7-2.8 1.8-4.7h3.6c.1 1.9.8 3.5 1.8 4.7-.9.8-2.1 1.3-3.6 1.3Zm5.3-2.8c-1-1.2-1.7-2.9-1.8-4.7H20a8.06 8.06 0 0 1-2.7 4.7Z"
      />
    </svg>
  );
}

/** Signe plus — le bouton « Ajouter un match » (maquette `formkit:add`). */
export function PlusIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Corbeille dans un cercle — suppression d'un match (maquette `mdi:delete-circle`). */
export function DeleteIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4 6.5v1.2h-.8l-.7 8.8c-.05.8-.6 1.3-1.5 1.3H11c-.9 0-1.45-.5-1.5-1.3l-.7-8.8H8V8.5h8Zm-4.9 2.2h1.8l.1 7h-1.9l.1-7Zm3.4 0h1.8l-.1 7h-1.8l.1-7Z" />
    </svg>
  );
}

/** Retour arrière — navigation des écrans secondaires (maquette `ph:arrow-left`). */
export function BackIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M19 12H5m0 0 6-6m-6 6 6 6"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Annulation — bouton undo de la saisie (maquette `mynaui:undo`). */
export function UndoIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M9 14 4 9l5-5"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 9h10a6 6 0 0 1 0 12h-3"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Historique — nav bas de l'accueil (maquette `material-symbols-light:history`). */
export function HistoryIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M12 3a9 9 0 0 0-7.9 4.6L2.4 6v5h5l-2-2A7 7 0 1 1 5 17l-1.6 1.3A9 9 0 1 0 12 3Zm0 5v5l3.4 2 .9-1.5L13 12.5V8h-1Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Graphique — nav bas « Cumul stats » (maquette `mage:dashboard-chart`). */
export function ChartIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <rect x="3.5" y="10" width="4" height="10" rx="1.2" fill="currentColor" />
      <rect x="10" y="5" width="4" height="15" rx="1.2" fill="currentColor" />
      <rect x="16.5" y="13" width="4" height="7" rx="1.2" fill="currentColor" />
    </svg>
  );
}

/** Coche — bouton réussi des lancers (maquette `lets-icons:check-fill`). */
export function CheckIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="m5 12.5 4.5 4.5L19 7.5"
        stroke="currentColor"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Croix — bouton raté des lancers (maquette `ix:error-filled`). */
export function CrossIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="m6.5 6.5 11 11m0-11-11 11"
        stroke="currentColor"
        strokeWidth={2.6}
        strokeLinecap="round"
      />
    </svg>
  );
}
