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

/** Ballon de basket — le logo. */
export function BallIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" {...props}>
      <g
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 24c0 11.598 9.402 21 21 21s21-9.402 21-21S35.598 3 24 3S3 12.402 3 24" />
        <path d="M44.975 25.024c-10.782.518-19.433 9.169-19.95 19.951M38.75 9.25l-29.5 29.5m0-29.5l29.5 29.5M22.974 3.024c-.52 10.782-9.168 19.43-19.95 19.95" />
      </g>
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

/** Corbeille dans un cercle — suppression d'un match. */
export function DeleteIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 2c5.53 0 10 4.47 10 10s-4.47 10-10 10S2 17.53 2 12S6.47 2 12 2m5 5h-2.5l-1-1h-3l-1 1H7v2h10zM9 18h6a1 1 0 0 0 1-1v-7H8v7a1 1 0 0 0 1 1" />
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

/** Historique — nav bas de l'accueil. */
export function HistoryIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 21q-3.45 0-6.012-2.287T3.05 13H5.1q.35 2.6 2.313 4.3T12 19q2.925 0 4.963-2.037T19 12t-2.037-4.962T12 5q-1.725 0-3.225.8T6.25 8H9v2H3V4h2v2.35q1.275-1.6 3.113-2.475T12 3q1.875 0 3.513.713t2.85 1.924t1.925 2.85T21 12t-.712 3.513t-1.925 2.85t-2.85 1.925T12 21m2.8-4.8L11 12.4V7h2v4.6l3.2 3.2z" />
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
