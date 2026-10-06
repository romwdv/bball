"use client";

import { useSyncExternalStore } from "react";
import {
  onSyncStatus,
  syncNow,
  syncStatus,
  type SyncStatus,
} from "@/sync/engine";

/**
 * Abonnement à l'état de synchronisation.
 *
 * `useSyncExternalStore` plutôt qu'un store Zustand supplémentaire : le moteur
 * est déjà une source d'état externe, et lui ajouter une copie dans un store
 * créerait deux vérités à tenir en cohérence. Le store d'authentification, lui,
 * existe parce que ses actions pilotent des écrans.
 *
 * `onSyncStatus` appelle l'abonné immédiatement à l'abonnement : le composant
 * affiche donc le bon état dès le premier rendu, sans le « ⚡ » par défaut qui
 * mentirait pendant une frame.
 */

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(onSyncStatus, syncStatus, syncStatus);
}

/**
 * Relance immédiate, en ignorant le backoff.
 *
 * Le retry manuel existe parce que le backoff est optimiste pour le coach et
 * pessimiste pour lui : jusqu'à 5 minutes d'attente quand le téléphone a retrouvé
 * le signal sans que l'événement `online` ne soit émis (sortie de sac en
 * gymnase, trampoline vers une autre antenne). Un tap sur le voyant règle la
 * question en une seconde.
 */
export function retrySyncNow(): void {
  void syncNow({ force: true });
}
