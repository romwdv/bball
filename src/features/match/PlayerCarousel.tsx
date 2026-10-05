"use client";

import { useCallback } from "react";
import { repos } from "@/data";
import {
  aggregateFor,
  playerShortName,
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
 * Les stats affichées sont celles de la **période courante**, pas du match
 * entier. C'est un choix qui mérite d'être justifié : en cours de quart temps,
 * ce qui intéresse le coach est « combien a-t-il mis ce quart-ci ». Afficher le
 * cumul de match ferait passer un joueur à 12 points pour un tireur de 6.
 */

export interface PlayerCarouselProps {
  players: readonly PlayerRow[];
  /** Statistiques par joueur pour la période sélectionnée. */
  statsByPlayer: ReadonlyMap<string, PlayerStats>;
  /** Allumage visuel du joueur verrouillé. */
  onSelect: (playerId: string) => void;
}

export function PlayerCarousel({
  players,
  statsByPlayer,
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
            <FoulDots
              fouls={statsByPlayer.get(player.id)?.fouls ?? 0}
              showCount
            />
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
  statsByPlayer: Map<string, PlayerStats>;
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

    // Filtre par période ici, et pas dans `aggregateFor` : la fonction du
    // domaine est déjà correcte, c'est l'écran qui décide de ce qu'il montre.
    const inQuarter = actions.filter((action) => action.quarter === quarter);
    const statsByPlayer = new Map<string, PlayerStats>();
    for (const player of roster) {
      statsByPlayer.set(player.id, aggregateFor(inQuarter, player.id));
    }

    return { match: found ?? null, players: roster, statsByPlayer };
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
};
