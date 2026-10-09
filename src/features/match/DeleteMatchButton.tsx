"use client";

import { useState } from "react";
import { repos } from "@/data";
import { Sheet } from "@/ui/Sheet";
import { DeleteIcon } from "@/ui/icons";
import type { MatchRow } from "@/data/schema";

/**
 * Confirmation de suppression d'un match.
 *
 * ## Pourquoi une confirmation, et aussi longue
 *
 * Une suppression est le seul geste de l'application qui **détruit** des données.
 * Tout le reste — y compris une annulation d'action — est réversible : les actions
 * sont soft-deleted et un second tap les restaure.
 *
 * La confirmation est donc explicite sur ce qui part : le nombre d'actions
 * saisies. Un coach qui a saisi 40 actions voit « 40 actions seront perdues » et
 * peut encore revenir en arrière. Sans ce chiffre, il ne verrait qu'un nom
 * d'adversaire — et « est-ce que j'ai bien choisi le bon match ? » n'a pas de
 * réponse.
 *
 * ## Pourquoi pas de « Annuler » après coup
 *
 * Une corbeille serait plus accueillante, mais elle pose deux problèmes ici. La
 * première est la synchronisation : garder une action supprimée en attendant
 * vingt-quatre heures exige un état supplémentaire dans l'outbox, donc un cas de
 * résolution de plus dans un module déjà complexe. La seconde est l'apparence : une
 * corbeille vide qui ne se vide jamais ressemble à un bug.
 *
 * Le stockage local n'a pas la même contrainte : IndexedDB conserve un match
 * supprimé pendant des mois. Un téléphone perdu avec sa base ne les
 * recuperera pas.
 *
 * ## Le bouton « Supprimer » est petit, et c'est volontaire
 *
 * Il vit à côté du match, pas dans une barre d'action. Un bouton destructif de
 * 88 px dans la liste des matchs serait une cible de accident à un doigt de
 * distance du match lui-même. Ici, un tap ajoute un second geste — ce qui est
 * exactement le comportement voulu pour une action irréversible.
 */

export interface DeleteMatchButtonProps {
  match: MatchRow;
  /** Nombre d'actions saisies — affiché dans la confirmation. */
  actionCount: number;
  /** Appelé après la suppression effective. */
  onDeleted: (matchId: string) => void;
}

export function DeleteMatchButton({
  match,
  actionCount,
  onDeleted,
}: DeleteMatchButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (deleting) return;
    setDeleting(true);
    setError(null);

    try {
      await repos().matches.delete(match.id);
      setConfirming(false);
      onDeleted(match.id);
    } catch (caught) {
      // Le match reste affiché et la fiche se referme : le coach doit pouvoir
      // réessayer, et surtout comprendre que rien n'a été supprimé.
      setError(
        caught instanceof Error ? caught.message : "Suppression impossible.",
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label={`Supprimer le match contre ${match.opponentName}`}
        className="grid min-h-tap-min min-w-tap-min shrink-0 place-items-center rounded-full text-accent"
      >
        <DeleteIcon className="h-7 w-7" />
      </button>

      <Sheet
        open={confirming}
        title="Supprimer ce match ?"
        onClose={() => setConfirming(false)}
        footer={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={deleting}
              className="min-h-tap-action flex-1 rounded-[10px] bg-white font-display text-lg font-light text-primary disabled:opacity-40"
            >
              Garder
            </button>
            <button
              type="button"
              onClick={() => {
                void confirm();
              }}
              disabled={deleting}
              className="min-h-tap-action flex-1 rounded-[10px] bg-foul font-display text-lg font-light text-inverse disabled:opacity-50"
            >
              {deleting ? "Suppression…" : "Supprimer"}
            </button>
          </div>
        }
      >
        <p className="text-sm text-secondary">
          Le match{" "}
          <span className="font-medium text-primary">
            vs {match.opponentName}
          </span>{" "}
          du {formatLongDate(match.date)} sera supprimé, ainsi que{" "}
          {actionCount === 0 ? (
            <span className="text-warning">
              ses actions — il n&rsquo;en a aucune
            </span>
          ) : (
            <>
              ses{" "}
              <span className="font-medium text-primary">
                {actionCount} action{actionCount > 1 ? "s" : ""}
              </span>
            </>
          )}
          .
        </p>

        {actionCount > 0 && (
          <p className="mt-3 text-sm text-secondary">
            Cette action est définitive : il n&rsquo;y a pas de corbeille.
          </p>
        )}

        {error !== null && (
          <p
            role="alert"
            className="mt-3 rounded-xl border border-foul/40 bg-foul-subtle px-4 py-3 text-sm text-foul"
          >
            {error}
          </p>
        )}
      </Sheet>
    </>
  );
}

/** Date en toutes lettres — la forme courte serait ambiguë dans une confirmation. */
function formatLongDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  const months = [
    "janvier",
    "février",
    "mars",
    "avril",
    "mai",
    "juin",
    "juillet",
    "août",
    "septembre",
    "octobre",
    "novembre",
    "décembre",
  ];
  const index = Number(month) - 1;
  const name = months[index] ?? month;
  return `${Number(day)} ${name} ${year}`;
}
