"use client";

import { useCallback } from "react";
import { repos } from "@/data";
import {
  aggregateFor,
  playerShortName,
  teamTotals,
  type PlayerStats,
} from "@/domain/stats";
import type { PlayerRow } from "@/data/schema";
import type { MatchRow } from "@/data/schema";
import { FoulDots, PlayerBadges } from "@/ui/Badges";
import { useAsyncData } from "@/ui/useAsyncData";
import { useMatchStore } from "@/features/match/store";

/**
 * Carrousel des joueurs (PLAN.md §4).
 *
 * Le joueur verrouillé reste actif après sélection : c'est ce qui rend rapide
 * une série de paniers du même joueur, qui est le geste le plus fréquent d'un
 * match. Sans verrouillage, chaque panier coûterait deux taps.
 *
 * ## Deux portées, et pourquoi
 *
 * Le carrousel affiche **deux** jeux de chiffres, qui ne se cumulent pas de la
 * même façon. C'est la règle métier qui l'impose, pas un choix d'affichage.
 *
 * **Les fautes sont cumulées sur tout le match.** La limite est à 5 fautes
 * *par joueur et par rencontre* : un joueur Eliminable en Q1 le reste en Q2. Si
 * le compteur repartait à zéro chaque période, un joueur sorti en première
 * période pourrait prendre cinq fautes de plus — et l'écran de fin de match
 * compterait dix fautes là où la règle en compte cinq. C'est le bug que
 * `foulsByPlayer` corrige.
 *
 * **Les points sont ceux de la période affichée.** « Combien a-t-il mis
 * ce quart-ci » est la question du coach pendant une période ; le cumul de match
 * est ce qu'il regarde entre les périodes, et il est dans le header. Afficher le
 * cumul dans le carrousel ferait passer un joueur à 12 points pour un tireur de 6
 * au deuxième quart.
 *
 * Le score du header, lui, est un **cumul de match** : c'est le chiffre que le
 * coach annonce au banc, et il ne doit jamais disparaître en changeant de
 * période.
 */

export interface PlayerCarouselProps {
  players: readonly PlayerRow[];
  /** Points et tirs du joueur sur la période affichée. */
  statsByPlayer: ReadonlyMap<string, PlayerStats>;
  /**
   * Fautes cumulées sur le match entier, par joueur.
   *
   * Séparé de `statsByPlayer` parce que la règle des 5 fautes est par
   * rencontre. Les mélanger en un seul objet obligerait l'écran à recalculer le
   * match entier à chaque tap, pour n'en utiliser qu'une pastille.
   */
  foulsByPlayer: ReadonlyMap<string, number>;
  /** Allumage visuel du joueur verrouillé. */
  onSelect: (playerId: string) => void;
}

export function PlayerCarousel({
  players,
  statsByPlayer,
  foulsByPlayer,
  onSelect,
}: PlayerCarouselProps) {
  const lockedId = useMatchStore((state) => state.playerId);

  if (players.length === 0) {
    return (
      <p className="px-4 py-3 text-sm text-muted">
        Aucun joueur sélectionné pour ce match.
      </p>
    );
  }

  return (
    <div
      className="scroll-x-touch flex gap-2 px-4 py-2"
      role="tablist"
      aria-label="Joueurs du match"
    >
      {players.map((player) => {
        const locked = player.id === lockedId;
        return (
          <button
            key={player.id}
            type="button"
            role="tab"
            aria-selected={locked}
            onClick={() => onSelect(player.id)}
            className={`flex min-h-tap-min w-24 shrink-0 snap-start flex-col justify-center gap-1 rounded-xl border px-2 py-1.5 text-left transition-colors ${
              locked
                ? "border-accent bg-accent-subtle"
                : "border-edge bg-raised"
            }`}
          >
            <span className="flex items-baseline gap-1">
              <span className="tabular text-xs text-muted">
                {player.number ?? "—"}
              </span>
              <span className="truncate text-sm font-medium">
                {playerShortName(player)}
              </span>
            </span>
            <PlayerBadges stats={statsByPlayer.get(player.id)} />
            {/* Fautes du match entier, pas de la période : voir la justification
                en tête de fichier. C'est aussi ce qui alimente le blocage à
                cinq fautes dans `ActionGrid`. */}
            <FoulDots fouls={foulsByPlayer.get(player.id) ?? 0} showCount />
          </button>
        );
      })}
    </div>
  );
}

/**
 * Charge les joueurs d'un match et leurs statistiques pour la période courante.
 *
 * Le rechargement est déclenché par `revision` : chaque écriture du store
 * l'incrémente, donc le carrousel se remet à jour sans que le composant ait à
 * connaître la nature de l'écriture. C'est volontairement indirect — l'écran
 * n'a pas à savoir si l'action vient d'un tir, d'un undo ou d'une série de LF.
 */
export interface MatchData {
  match: MatchRow | null;
  players: PlayerRow[];
  /** Points et tirs de la période affichée. */
  statsByPlayer: Map<string, PlayerStats>;
  /** Fautes cumulées sur le match entier. */
  foulsByPlayer: Map<string, number>;
  /** Score du match entier, toutes périodes confondues. */
  totalPoints: number;
}

export function useMatchData(matchId: string | null): MatchData & {
  loading: boolean;
} {
  const quarter = useMatchStore((state) => state.quarter);
  const revision = useMatchStore((state) => state.revision);

  const read = useCallback(async (): Promise<MatchData> => {
    if (matchId === null) return EMPTY;

    const store = repos();
    const [found, roster, actions] = await Promise.all([
      store.matches.get(matchId),
      // Le roster vient du match, pas des actions : un joueur entré sans rien
      // faire doit apparaître dans la feuille avec une ligne à zéro, sinon il
      // disparaîtrait du document et le coach croirait à une omission.
      store.matches.rosterOf(matchId),
      store.actions.listByMatch(matchId, { includeVoided: false }),
    ]);

    // Les points sont filtrés par période ; les fautes ne le sont pas. La
    // distinction vient de la règle métier, pas d'une commodité — voir la
    // justification en tête de fichier.
    const inQuarter = actions.filter((action) => action.quarter === quarter);

    const statsByPlayer = new Map<string, PlayerStats>();
    const foulsByPlayer = new Map<string, number>();
    for (const player of roster) {
      statsByPlayer.set(player.id, aggregateFor(inQuarter, player.id));
      // Agrégation sur `actions` entier, pas sur `inQuarter`.
      foulsByPlayer.set(player.id, aggregateFor(actions, player.id).fouls);
    }

    // Cumul du match, calculé sur les actions et non sur la somme des joueurs
    // affichés : une action dont le joueur aurait quitté le roster ne doit pas
    // disparaître du score.
    const totalPoints = teamTotals(actions).points;

    return {
      match: found ?? null,
      players: roster,
      statsByPlayer,
      foulsByPlayer,
      totalPoints,
    };
  }, [matchId, quarter]);

  // `revision` entre dans le tableau de dépendances : il n'est pas lu dans
  // `read`, c'est exactement son rôle — forcer une relecture.
  const { data, loading } = useAsyncData<MatchData>(read, [read, revision]);

  return { ...(data ?? EMPTY), loading };
}

const EMPTY: MatchData = {
  match: null,
  players: [],
  statsByPlayer: new Map(),
  foulsByPlayer: new Map(),
  totalPoints: 0,
};
