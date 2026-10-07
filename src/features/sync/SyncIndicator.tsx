"use client";

import { retrySyncNow, useSyncStatus } from "@/features/sync/useSyncStatus";

/**
 * Voyant de synchronisation.
 *
 * Le libellé est un mot, pas une icône : en bord de terrain, on lit entre deux
 * quarts, et un pictogramme demande un effort de déchiffrement.
 *
 * ## Où il apparaît, et pourquoi partout
 *
 * Sur les trois écrans où une donnée peut changer : le **header du match**, le
 * **bandeau de suppression** de l'accueil, et l'**historique**. Il n'était
 * qu'au header, sur le seul écran où l'on ne prend pas de décision — ce qui est
 * l'inverse de là où l'attente compte.
 *
 * La raison est concrète : la suppression d'un match est **immédiate en local et
 * différée sur le réseau**. Le coach voit le match disparaître et n'a aucun moyen
 * de savoir s'il est parti. Sur l'accueil et l'historique, un « 3 en attente » est
 * la seule information qui le dise — et sans elle, une suppression en attente est
 * indiscernable d'une suppression réussie.
 *
 *   - **synchronisé** : rien à dire, l'état par défaut est discret.
 *   - **n en attente** : la file locale n'est pas vide, quel que soit l'état.
 *     Attendre est normal, et c'est l'information que le coach cherche.
 *   - **hors-ligne** : information, pas alarme. Le mode avion est l'état
 *     normal en gymnase ; une couleur rouge apprendrait au coach à ignorer le
 *     voyant.
 *   - **erreur** : seule couleur d'alerte, et c'est la seule qui mérite un tap.
 *
 * Dans tous les cas, un tap relance : `retrySyncNow` passe outre le backoff.
 *
 * ## Ce que le voyant ne fait pas
 *
 * Il n'empêche rien. Une suppression reste possible hors-ligne, et desirable :
 * refuser d'effacer un match parce que le réseau manque obligerait le coach à
 * garder une saisie qu'il ne veut plus, dans un gymnase où le réseau manque une
 * fois sur deux. Le moteur enverra l'entrée `delete` à la première occasion.
 */

const LABELS: Record<string, string> = {
  idle: "synchronisé",
  syncing: "sync…",
  offline: "hors-ligne",
  error: "erreur",
};

export interface SyncIndicatorProps {
  /**
   * `banner` — pleine largeur, sur son propre fond, avec l'état détaillé.
   *   Pour l'accueil et l'historique, où il doit être vu sans lecture d'un
   *   header.
   *
   * `chip` — la pastille compacte actuelle, pour le header du match où la
   *   hauteur est comptée en pixels.
   */
  variant?: "banner" | "chip";
}

export function SyncIndicator({ variant = "chip" }: SyncIndicatorProps = {}) {
  const { state, pending, error } = useSyncStatus();

  // Priorité du libellé : `erreur` d'abord, puis le compte d'attente, puis l'état.
  //
  // L'erreur passe en premier parce qu'elle est la seule qui demande une action :
  // un nombre d'attente la ferait passer inaperçue, et le coach ne verrait jamais
  // pourquoi ses matchs ne remontent pas. Le compte d'attente prime ensuite sur
  // « hors-ligne » ou « synchronisé », qui ne disent pas si des actions sont
  // en attente — l'information que le coach cherche en permanence.
  const label =
    state === "error"
      ? (LABELS[state] ?? state)
      : pending > 0
        ? `${pending} en attente`
        : (LABELS[state] ?? state);

  const tone =
    state === "error"
      ? "text-foul"
      : state === "offline"
        ? "text-warning"
        : state === "syncing"
          ? "text-accent"
          : pending > 0
            ? "text-secondary"
            : "text-muted";

  const banner = variant === "banner";

  return (
    <button
      type="button"
      // Le libellé est déjà visible ; `aria-label` ajoute le contexte et la
      // raison d'un tap, sans le dupliquer dans le texte rendu.
      aria-label={`Synchronisation : ${label}. Toucher pour réessayer.`}
      title={error ?? label}
      onClick={retrySyncNow}
      data-testid="sync-indicator"
      data-state={state}
      className={
        banner
          ? `flex min-h-tap-min w-full items-center justify-between gap-2 rounded-xl border border-edge bg-raised px-4 py-2 text-left text-sm ${tone}`
          : `tabular min-h-tap-min shrink-0 rounded-full px-2 text-xs ${tone}`
      }
    >
      <span className={banner ? "" : "tabular"}>{label}</span>
      {banner && pending > 0 && (
        // LeRetry manuel est ce que le coach fera en cas d'échec réseau : il doit
        // être atteignable sans deviner où il est.
        <span className="shrink-0 text-xs text-muted">Réessayer</span>
      )}
    </button>
  );
}
