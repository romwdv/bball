"use client";

import { useEffect, useState } from "react";

/**
 * Lecture d'une source externe (IndexedDB) vers un état React.
 *
 * Isolée dans un seul fichier, et le `setState` y est **toujours asynchrone** :
 * il n'y a aucun appel synchrone dans le corps de l'effet. Deux raisons.
 *
 * 1. La règle `react-hooks/set-state-in-effect` a raison : un effet qui écrit un
 *    état pendant son corps provoque un second rendu en cascade. Ici il n'y en a
 *    pas — l'écriture arrive dans la continuation d'une promesse, donc après la
 *    fin de l'effet. Le seul état synchronisé est `loading`, et il ne repasse
 *    jamais à `true` : cf. point 2.
 * 2. Ne pas remettre `loading` à `true` lors d'une relecture est un choix
 *    **d'ergonomie**, pas une Astuce pour CONTENTer le linter. Après un tir, le
 *    carrousel doit continuer à afficher les stats précédentes pendant la
 *    relecture IndexedDB ; faire clignoter « Chargement… » à chaque panier
 *    rendrait l'écran illisible en bord de terrain. `loading` ne sert donc
 *    qu'au tout premier rendu, avant que quoi que ce soit soit connu.
 */
export interface AsyncData<T> {
  data: T | null;
  /** Vrai tant que la toute première lecture n'a pas abouti. */
  loading: boolean;
  error: Error | null;
}

/**
 * @param load Lecture asynchrone. Doit être stable entre deux rendus.
 * @param deps Dépendances de relecture, comme pour `useCallback`.
 */
export function useAsyncData<T>(
  load: () => Promise<T>,
  deps: readonly unknown[],
): AsyncData<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    void load()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught : new Error(String(caught)));
        setLoading(false);
      });

    // Un démontage ne doit pas laisser un `setState` sur un composant mort :
    // React le signale, et l'écriture arrive de toute façon trop tard pour
    // servir à quoi que ce soit.
    return () => {
      cancelled = true;
    };
    // `deps` est fourni par l'appelant, exactement comme pour `useCallback`.
    // La règle ne peut pas le vérifier statiquement, et l'exiger ici obligerait
    // à recopier la liste dans le tableau — donc à pouvoir la faire diverger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error };
}
