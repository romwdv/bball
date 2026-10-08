"use client";

import { useCallback } from "react";
import { repos } from "@/data";
import {
  aggregateFor,
  playerLabel,
  teamTotals,
  type PlayerStats,
} from "@/domain/stats";
import type { MatchRow, PlayerRow } from "@/data/schema";
import { FoulDots, PlayerBadges } from "@/ui/Badges";
import { useAsyncData } from "@/ui/useAsyncData";
import { useMatchStore } from "@/features/match/store";

/**
 * Bandeau du joueur suivi (PLAN.md §11).
 *
 * C'était un carrousel d'onglets, un par joueur, avec sélection et verrouillage.
 * L'application ne suit plus qu'**un seul joueur** : le bandeau devient une puce
 * qui n'a plus rien à décider. Deux défauts si on l'avait laissé tel quel — un
 * `role="tablist"` d'un seul onglet annonce au lecteur d'écran une liste de choix
 * qui n'en est pas une, et un bouton « verrouillé » sur lequel on peut appuyer
 * n'explique pas que rien ne se passe.
 *
 * Le contenu, lui, est **inchangé** — c'est le cœur de la valeur du bandeau :
 *
 * **Les fautes sont cumulées sur tout le match.** La limite est à 5 fautes *par
 * joueur et par rencontre* : un joueur éliminable en Q1 le reste en Q2. Si le
 * compteur repartait à zéro chaque période, un joueur sorti en première période
 * pourrait prendre cinq fautes de plus — et l'écran de fin de match en
 * compterait dix là où la règle en compte cinq. C'est ce que corrige `fouls`.
 *
 * **Les points sont ceux de la période affichée.** « Combien a-t-il mis ce
 * quart-ci » est la question du coach pendant une période ; le cumul de match est
 * ce qu'il regarde entre les périodes, et il est dans le header. Afficher le cumul
 * ici ferait passer un tireur de 6 points à 12 au deuxième quart.
 *
 * Le score du header, lui, est un **cumul de match** : c'est le chiffre que le
 * coach annonce au banc, et il ne doit jamais disparaître en changeant de période.
 */

export interface ActivePlayerProps {
  /** Le joueur suivi. `null` tant que la base n'a pas répondu. */
  player: PlayerRow | null;
  /** Points et tirs du joueur sur la période affichée. */
  stats: PlayerStats | undefined;
  /** Fautes cumulées sur le match entier. */
  fouls: number;
}

export function ActivePlayer({ player, stats, fouls }: ActivePlayerProps) {
  if (player === null) return null;

  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
        <span className="truncate text-sm font-medium">
          {playerLabel(player)}
        </span>
        <PlayerBadges stats={stats} />
      </div>
      {/* Fautes du match entier, pas de la période : voir la justification en
          tête de fichier. C'est aussi ce qui alimente le blocage à cinq fautes
          dans `ActionGrid`. */}
      <FoulDots fouls={fouls} showCount />
    </div>
  );
}

/**
 * Charge le match, son joueur et ses statistiques pour la période courante.
 *
 * Le rechargement est déclenché par `revision` : chaque écriture du store
 * l'incrémente, donc le bandeau se remet à jour sans que le composant ait à
 * connaître la nature de l'écriture. C'est volontairement indirect — l'écran
 * n'a pas à savoir si l'action vient d'un tir, d'un undo ou d'une série de LF.
 *
 * `quarter` est une **dépendance** de `read` et non un champ d'état : le sélecteur
 * de période ne passe pas par `revision` — il ne vient pas d'une écriture — donc
 * sans cette clé les points resteraient figés sur la période précédente.
 */
export interface MatchData {
  match: MatchRow | null;
  /** Le joueur suivi, ou `null` si le match n'a pas de roster. */
  player: PlayerRow | null;
  /** Points et tirs de la période affichée. */
  stats: PlayerStats | undefined;
  /** Fautes cumulées sur le match entier. */
  fouls: number;
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
      store.matches.rosterOf(matchId),
      store.actions.listByMatch(matchId, { includeVoided: false }),
    ]);

    // Un seul joueur est suivi, donc on prend le premier du roster. Le roster
    // vient du match et non des actions : un joueur qui n'a pas encore tiré doit
    // quand même apparaître, sinon le bandeau clignoterait en attendant son
    // premier panier.
    const player = roster[0] ?? null;

    // Les points sont filtrés par période ; les fautes ne le sont pas. La
    // distinction vient de la règle métier, pas d'une commodité — voir la
    // justification en tête de fichier.
    const inQuarter = actions.filter((action) => action.quarter === quarter);

    return {
      match: found ?? null,
      player,
      stats: player === null ? undefined : aggregateFor(inQuarter, player.id),
      // Agrégation sur `actions` entier, pas sur `inQuarter`.
      fouls: player === null ? 0 : aggregateFor(actions, player.id).fouls,
      // Cumul du match, calculé sur les actions et non sur les points affichés :
      // une action dont le joueur aurait quitté le roster ne doit pas disparaître
      // du score.
      totalPoints: teamTotals(actions).points,
    };
  }, [matchId, quarter]);

  // `revision` entre dans le tableau de dépendances : il n'est pas lu dans
  // `read`, c'est exactement son rôle — forcer une relecture.
  const { data, loading } = useAsyncData<MatchData>(read, [read, revision]);

  return { ...(data ?? EMPTY), loading };
}

const EMPTY: MatchData = {
  match: null,
  player: null,
  stats: undefined,
  fouls: 0,
  totalPoints: 0,
};
