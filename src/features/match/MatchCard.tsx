import Link from "next/link";
import type { MatchRow } from "@/data/schema";
import { MatchStatus } from "@/domain/types";
import { formatDate } from "@/features/match/formatDate";
import { DeleteMatchButton } from "@/features/match/DeleteMatchButton";

/**
 * Carte pilule d'un match — l'accueil et l'historique.
 *
 * Reprend la maquette (PLAN.md §12) : rayon 40, fond `--surface-raised`, statut
 * en Abel muted, adversaire en Alexandria, date en Abel. La corbeille est le
 * bouton de suppression — elle est portée ici pour que l'accueil et l'historique
 * ne dupliquent pas la même disposition.
 *
 * Toute la carte est un lien ; le bouton de suppression reste un bouton.
 */

export interface MatchCardProps {
  match: MatchRow;
  /** Où mène la carte (saisie ou détail). */
  href: string;
  actionCount: number;
  /**
   * Évaluation du match (`undefined` = pas de pastille).
   *
   * Optionnelle parce qu'elle n'a de sens que sur un match terminé : l'accueil,
   * qui affiche aussi des matchs en cours, ne la passe pas.
   */
  rating?: number;
  onDeleted: () => void;
}

const STATUS_LABEL: Record<MatchStatus, string> = {
  draft: "Brouillon",
  live: "Match en cours",
  finished: "Match terminé",
};

/**
 * Teinte de la pastille d'évaluation.
 *
 * Le vert et le rouge sont déjà le vocabulaire de la saisie (`made` / `foul`) :
 * réutilisés tels quels, l'évaluation se lit sans légende. Une évaluation nulle
 * reste neutre — un match « moyen » n'est pas un match à signalement.
 */
function ratingClass(value: number): string {
  if (value > 0) return "bg-made-subtle text-made";
  if (value < 0) return "bg-foul-subtle text-foul";
  return "bg-missed-subtle text-muted";
}

export function MatchCard({
  match,
  href,
  actionCount,
  rating,
  onDeleted,
}: MatchCardProps) {
  return (
    <li className="flex items-center gap-2">
      <Link
        href={href}
        aria-label={`${STATUS_LABEL[match.status]} contre ${match.opponentName}, le ${formatDate(match.date)}`}
        className="flex min-h-tap-min flex-1 items-center rounded-[40px] bg-raised px-6 py-3.5"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="font-label text-[13px] uppercase tracking-wide text-muted">
            {STATUS_LABEL[match.status]}
          </span>
          <span className="truncate font-brand text-sm text-primary">
            vs {match.opponentName}
          </span>
          <span className="tabular font-label text-[13px] text-muted">
            {formatDate(match.date)}
          </span>
        </span>
        {rating !== undefined && (
          <span
            className={`tabular ml-3 shrink-0 rounded-full px-2.5 py-1 font-label text-[13px] font-semibold ${ratingClass(rating)}`}
            aria-label={`Évaluation du match : ${rating > 0 ? "+" : ""}${rating}`}
          >
            {rating > 0 ? "+" : ""}
            {rating}
          </span>
        )}
      </Link>
      <DeleteMatchButton
        match={match}
        actionCount={actionCount}
        onDeleted={onDeleted}
      />
    </li>
  );
}
