"use client";

import { retrySyncNow, useSyncStatus } from "@/features/sync/useSyncStatus";

/**
 * Voyant de synchronisation — le seul endroit où la sync est visible.
 *
 * Il tient dans le header du match, à la place qu'occupait un « ⚡ » décoratif.
 * Le libellé est un mot, pas une icône : en bord de terrain, on lit entre deux
 * quarts et une pictogramme demande un effort de déchiffrement.
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
 */

const LABELS: Record<string, string> = {
  idle: "synchronisé",
  syncing: "sync…",
  offline: "hors-ligne",
  error: "erreur",
};

export function SyncIndicator() {
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
      className={`tabular min-h-tap-min shrink-0 rounded-full px-2 text-xs ${tone}`}
    >
      {label}
    </button>
  );
}
