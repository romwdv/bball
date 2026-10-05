"use client";

import { useEffect, useRef } from "react";

/**
 * Maintient l'écran allumé pendant un match.
 *
 * Un téléphone en verrouillage au milieu d'un quart temps oblige à le déverrouiller
 * d'une main, ce qui est à la fois imprécis et gênant en plein jeu. Le Wake Lock
 * est **réacquis à chaque retour de visibilité** : le navigateur le rend dès que
 * l'onglet passe en arrière-plan, un `reacquire` sur `visibilitychange` est donc
 * nécessaire, pas optionnel.
 *
 * `requestWakeLock` est derrière un test : Safari ne l'a exposé qu'à partir de
 * 16.4 et l'appelle `navigator.wakeLock`. Sans garde, l'app lèverait sur les
 * versions antérieures.
 */

interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
}

interface WakeLockLike {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}

function wakeLock(): WakeLockLike | undefined {
  const candidate = (navigator as Navigator & { wakeLock?: WakeLockLike })
    .wakeLock;
  return candidate;
}

export function useWakeLock(enabled: boolean): void {
  const sentinel = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const api = wakeLock();
    if (api === undefined) return;
    const lock = api;

    let cancelled = false;

    async function acquire() {
      try {
        const held = await lock.request("screen");
        if (cancelled) {
          await held.release();
          return;
        }
        sentinel.current = held;
        // Le système reprend le verrou sans prévenir (appel entrant,
        // navigation) : on relâche, le callback rend la main.
        held.addEventListener("release", () => {
          sentinel.current = null;
        });
      } catch {
        // Échec typique : batterie faible, onglet caché, permission refusée.
        // L'app reste utilisable, l'écran s'éteindra simplement.
      }
    }

    function onVisible() {
      if (document.visibilityState === "visible" && sentinel.current === null) {
        void acquire();
      }
    }

    void acquire();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel.current?.release();
      sentinel.current = null;
    };
  }, [enabled]);
}
