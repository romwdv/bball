import type { Action, Player, Quarter } from "./types";
import {
  addDeltas,
  awardedFreeThrows,
  emptyDelta,
  project,
  type StatDelta,
} from "./rules";

/**
 * Agrégation — transforme des actions en statistiques.
 *
 * Point clé : aucune statistique n'est stockée. Tout est recalculé à partir des
 * actions. C'est ce qui permet au filtre par période, à l'annulation et aux
 * stats cumulées de partager exactement le même code, donc de ne jamais
 * diverger.
 */

export interface PlayerStats {
  playerId: string;
  points: number;
  fgm2: number;
  fga2: number;
  fgm3: number;
  fga3: number;
  ftm: number;
  fta: number;
  fouls: number;
  reboundsOffensive: number;
  reboundsDefensive: number;
  assists: number;
  turnovers: number;
  steals: number;
  blocks: number;
}

export function emptyPlayerStats(playerId: string): PlayerStats {
  return {
    playerId,
    points: 0,
    fgm2: 0,
    fga2: 0,
    fgm3: 0,
    fga3: 0,
    ftm: 0,
    fta: 0,
    fouls: 0,
    reboundsOffensive: 0,
    reboundsDefensive: 0,
    assists: 0,
    turnovers: 0,
    steals: 0,
    blocks: 0,
  };
}

/** Rebonds totaux (offensifs + défensifs). */
export function totalRebounds(stats: PlayerStats): number {
  return stats.reboundsOffensive + stats.reboundsDefensive;
}

/** Tirs à l'espace réussis. */
export function fieldGoalsMade(stats: PlayerStats): number {
  return stats.fgm2 + stats.fgm3;
}

/** Tirs à l'espace tentés. */
export function fieldGoalsAttempted(stats: PlayerStats): number {
  return stats.fga2 + stats.fga3;
}

/**
 * Pourcentage de réussite.
 *
 * Convention : `null` quand aucune tentative, jamais `0`. Afficher « 0 % » pour
 * un joueur qui n'a pas tiré induirait en erreur ; l'absence de donnée est
 * indépendante de la valeur.
 */
export function percentage(made: number, attempted: number): number | null {
  if (attempted === 0) return null;
  return (made / attempted) * 100;
}

export function fgPercentage(stats: PlayerStats): number | null {
  return percentage(fieldGoalsMade(stats), fieldGoalsAttempted(stats));
}

export function twoPointsPercentage(stats: PlayerStats): number | null {
  return percentage(stats.fgm2, stats.fga2);
}

export function threePointsPercentage(stats: PlayerStats): number | null {
  return percentage(stats.fgm3, stats.fga3);
}

export function freeThrowPercentage(stats: PlayerStats): number | null {
  return percentage(stats.ftm, stats.fta);
}

// ---------------------------------------------------------------------------
// Filtres
// ---------------------------------------------------------------------------

export interface AggregateFilter {
  playerId?: string;
  quarter?: Quarter;
  matchId?: string;
}

/**
 * Toute action du jeu, à la fois statistique et chronologique.
 */
export const CHRONOLOGICAL_KINDS = [
  "shot",
  "foul",
  "free_throw",
  "rebound",
  "assist",
  "turnover",
  "steal",
  "block",
  "substitution",
] as const;

/**
 * Filtre une liste d'actions. Utilisé par tous les agrégats.
 *
 * Les actions annulées sont **toujours** exclues : `project()` retourne un delta
 * neutre pour elles, il n'existe donc aucun chemin par lequel une statistique
 * pourrait les compter. Un filtre « inclure les annulées » n'aurait aucun effet
 * et serait un piège ; le fil du match, lui, les affiche via `actionsOfMatch()`.
 */
export function filterActions(
  actions: readonly Action[],
  { playerId, quarter, matchId }: AggregateFilter = {},
): Action[] {
  return actions.filter((action) => {
    if (action.voidedAt !== null && action.voidedAt !== undefined) {
      return false;
    }
    if (playerId !== undefined && action.playerId !== playerId) return false;
    if (quarter !== undefined && action.quarter !== quarter) return false;
    if (matchId !== undefined && action.matchId !== matchId) return false;
    return true;
  });
}

/**
 * Actions d'un match dans l'ordre chronologique de saisie.
 *
 * Contrairement à `filterActions`, cette fonction garde les actions annulées par
 * défaut : le fil du match doit montrer ce qui s'est passé, y compris ce qui a
 * été défait. C'est le seul moyen de les lire.
 */
export function actionsOfMatch(
  actions: readonly Action[],
  matchId: string,
  { includeVoided = true }: { includeVoided?: boolean } = {},
): Action[] {
  return actions
    .filter(
      (action) =>
        action.matchId === matchId &&
        (includeVoided ||
          action.voidedAt === null ||
          action.voidedAt === undefined),
    )
    .sort((a, b) => a.seq - b.seq);
}

// ---------------------------------------------------------------------------
// Agrégats
// ---------------------------------------------------------------------------

/**
 * Total des lancers dus mais pas encore saisis.
 *
 * Répond à la question « reste-t-il des lancers à enregistrer ? », typiquement
 * en fin de match.
 *
 * L'appariement est **séquentiel et par joueur** : chaque tir fouillé réclame les
 * `n` lancers qui le suivent dans l'ordre chronologique, sans dépasser `n`. Un
 * décompte global serait faux (un lancer de la série précédente serait imputé à
 * la série courante).
 */
export function pendingFreeThrows(actions: readonly Action[]): number {
  const active = filterActions(actions)
    .slice()
    .sort((a, b) => a.seq - b.seq);

  const freeThrowSeqsByPlayer = new Map<string, number[]>();
  for (const action of active) {
    if (action.kind !== "free_throw") continue;
    const list = freeThrowSeqsByPlayer.get(action.playerId);
    if (list) {
      list.push(action.seq);
    } else {
      freeThrowSeqsByPlayer.set(action.playerId, [action.seq]);
    }
  }

  const consumed = new Map<string, Set<number>>();

  let pending = 0;
  for (const shot of active) {
    const awarded = awardedFreeThrows(shot);
    if (awarded === null) continue;

    const candidates = freeThrowSeqsByPlayer.get(shot.playerId) ?? [];
    const used = consumed.get(shot.playerId) ?? new Set<number>();
    let taken = 0;
    for (const seq of candidates) {
      if (used.has(seq)) continue;
      if (seq <= shot.seq) continue;
      used.add(seq);
      taken += 1;
      if (taken === awarded) break;
    }
    consumed.set(shot.playerId, used);
    pending += awarded - taken;
  }

  return pending;
}

/** Somme des projections d'un ensemble d'actions. */
export function sumDeltas(actions: readonly Action[]): StatDelta {
  let total = emptyDelta();
  for (const action of actions) {
    total = addDeltas(total, project(action));
  }
  return total;
}

/** Statistiques d'un joueur sur un ensemble d'actions filtrées. */
export function playerStatsFrom(
  actions: readonly Action[],
  playerId: string,
): PlayerStats {
  const stats = emptyPlayerStats(playerId);
  for (const action of actions) {
    const delta = project(action);
    stats.points += delta.points;
    stats.fgm2 += delta.fgm2;
    stats.fga2 += delta.fga2;
    stats.fgm3 += delta.fgm3;
    stats.fga3 += delta.fga3;
    stats.ftm += delta.ftm;
    stats.fta += delta.fta;
    stats.fouls += delta.fouls;
    stats.reboundsOffensive += delta.reboundsOffensive;
    stats.reboundsDefensive += delta.reboundsDefensive;
    stats.assists += delta.assists;
    stats.turnovers += delta.turnovers;
    stats.steals += delta.steals;
    stats.blocks += delta.blocks;
  }
  return stats;
}

/**
 * Statistiques par joueur, pour tous les joueurs ayant au moins une action.
 *
 * Les joueurs sans action ne sont pas retournés : l'appelant décide comment les
 * afficher (l'écran de saisie le fera, pour garder les 5 titulaires visibles).
 */
export function aggregate(
  actions: readonly Action[],
  filter: AggregateFilter = {},
): PlayerStats[] {
  const filtered = filterActions(actions, filter);
  const byPlayer = new Map<string, Action[]>();
  for (const action of filtered) {
    const bucket = byPlayer.get(action.playerId);
    if (bucket) {
      bucket.push(action);
    } else {
      byPlayer.set(action.playerId, [action]);
    }
  }
  return [...byPlayer.entries()]
    .map(([playerId, playerActions]) =>
      playerStatsFrom(playerActions, playerId),
    )
    .sort(
      (a, b) => b.points - a.points || a.playerId.localeCompare(b.playerId),
    );
}

/** Statistiques d'un joueur unique. Renvoie des zéros s'il n'a rien fait. */
export function aggregateFor(
  actions: readonly Action[],
  playerId: string,
  filter: Omit<AggregateFilter, "playerId"> = {},
): PlayerStats {
  return playerStatsFrom(
    filterActions(actions, { ...filter, playerId }),
    playerId,
  );
}

/** Totaux d'équipe. Somme des statistiques joueur. */
export function teamTotals(
  actions: readonly Action[],
  filter: AggregateFilter = {},
): StatDelta {
  return sumDeltas(filterActions(actions, filter));
}

// ---------------------------------------------------------------------------
// Stats par période
// ---------------------------------------------------------------------------

/**
 * Score de l'équipe pour un ensemble de périodes.
 *
 * Utile pour le score d'une rencontre déjà terminée à partir d'un sous-ensemble
 * de périodes (match en cours : on veut le score de la période en cours).
 */
export function scoreForQuarters(
  actions: readonly Action[],
  quarters: readonly Quarter[],
): number {
  if (quarters.length === 0) return 0;
  let total = 0;
  for (const action of filterActions(actions)) {
    if (!quarters.includes(action.quarter)) continue;
    total += project(action).points;
  }
  return total;
}

/**
 * Points marqués par période.
 *
 * Utilisé par la feuille de match et par le graphique d'évolution.
 * Renvoie une entrée pour chaque période demandée, y compris à 0 point : une
 * période à zéro est une information, pas une absence.
 */
export function pointsByQuarter(
  actions: readonly Action[],
  quarters: readonly Quarter[],
): { quarter: Quarter; points: number }[] {
  return quarters.map((quarter) => ({
    quarter,
    points: sumDeltas(filterActions(actions, { quarter })).points,
  }));
}

/** Statistiques d'un joueur pour chaque période. */
export function statsByQuarter(
  actions: readonly Action[],
  playerId: string,
  quarters: readonly Quarter[],
): { quarter: Quarter; stats: PlayerStats }[] {
  return quarters.map((quarter) => ({
    quarter,
    stats: aggregateFor(actions, playerId, { quarter }),
  }));
}

// ---------------------------------------------------------------------------
// Stats cumulées (tous les matchs)
// ---------------------------------------------------------------------------

export interface CumulativeStats extends PlayerStats {
  /** Nombre de matchs dans lesquels le joueur a au moins une action. */
  matchesPlayed: number;
  /** Totaux sur l'ensemble des matchs terminés. */
  totals: PlayerStats;
  /** Moyennes par match. Les ratios (%, points) sont des moyennes de ratios,
   * pas des totaux divisés — c'est la convention usuelle en suivi de performance. */
  averages: {
    points: number;
    fgm2: number;
    fga2: number;
    fgm3: number;
    fga3: number;
    ftm: number;
    fta: number;
    fouls: number;
    rebounds: number;
    assists: number;
    turnovers: number;
    steals: number;
    blocks: number;
  };
}

function averageOf(total: number, count: number): number {
  return count === 0 ? 0 : total / count;
}

/**
 * Statistiques cumulées sur plusieurs matchs.
 *
 * `matchIds` détermine ce qui compte comme « un match joué ». Le comptage se fait
 * sur les actions distinctes du joueur, pas sur la taille de la liste — sinon un
 * joueur présent deux fois dans une même rencontre serait compté deux fois.
 */
export function cumulativeStats(
  actions: readonly Action[],
  matchIds: readonly string[],
): CumulativeStats[] {
  const byPlayer = new Map<string, Map<string, Action[]>>();

  for (const action of filterActions(actions)) {
    if (!matchIds.includes(action.matchId)) continue;
    let byMatch = byPlayer.get(action.playerId);
    if (!byMatch) {
      byMatch = new Map();
      byPlayer.set(action.playerId, byMatch);
    }
    const bucket = byMatch.get(action.matchId);
    if (bucket) {
      bucket.push(action);
    } else {
      byMatch.set(action.matchId, [action]);
    }
  }

  return [...byPlayer.entries()]
    .map(([playerId, byMatch]) => {
      const perMatch = [...byMatch.values()];
      const matchesPlayed = perMatch.length;

      const merged: Action[] = [];
      for (const matchActions of perMatch) merged.push(...matchActions);
      const totals = playerStatsFrom(merged, playerId);

      return {
        ...totals,
        matchesPlayed,
        totals,
        averages: {
          points: averageOf(totals.points, matchesPlayed),
          fgm2: averageOf(totals.fgm2, matchesPlayed),
          fga2: averageOf(totals.fga2, matchesPlayed),
          fgm3: averageOf(totals.fgm3, matchesPlayed),
          fga3: averageOf(totals.fga3, matchesPlayed),
          ftm: averageOf(totals.ftm, matchesPlayed),
          fta: averageOf(totals.fta, matchesPlayed),
          fouls: averageOf(totals.fouls, matchesPlayed),
          rebounds: averageOf(totalRebounds(totals), matchesPlayed),
          assists: averageOf(totals.assists, matchesPlayed),
          turnovers: averageOf(totals.turnovers, matchesPlayed),
          steals: averageOf(totals.steals, matchesPlayed),
          blocks: averageOf(totals.blocks, matchesPlayed),
        },
      };
    })
    .sort(
      (a, b) =>
        b.totals.points - a.totals.points ||
        a.playerId.localeCompare(b.playerId),
    );
}

// ---------------------------------------------------------------------------
// présentation
// ---------------------------------------------------------------------------

/**
 * Phrase courte décrivant une action, pour le fil du match et le retour immédiat
 * de saisie.
 *
 * Une action muette est une action dont le coach doute. Un tir raté ne change ni
 * le score ni aucune pastille affichée : sans retour explicite, le coach ne sait
 * pas si son appui long est passé et il recommence, ou il passe au joueur
 * suivant en croyant le tir compté. Une phrase de six mots lève le doute sans
 * qu'il ait à lever les yeux du terrain.
 *
 * Le vocabulaire est celui du coach, pas celui du code : « Panier », « Panneau »,
 * « LF », « Faute ».
 */
export function describeAction(action: Action): string {
  switch (action.kind) {
    case "shot": {
      const points = action.value === 3 ? "3 pts" : "2 pts";
      if (action.made === true) {
        return action.fouled === true
          ? `Panneau ${points} + faute`
          : `Panier ${points}`;
      }
      return action.fouled === true
        ? `Tir ${points} raté + faute`
        : `Tir ${points} raté`;
    }
    case "free_throw":
      return action.made === true ? "LF réussi" : "LF raté";
    case "foul":
      return "Faute";
    case "rebound":
      return action.side === "offensive"
        ? "Rebond offensif"
        : "Rebond défensif";
    case "assist":
      return "Passe";
    case "turnover":
      return "Perte de balle";
    case "steal":
      return "Interception";
    case "block":
      return "Contre";
    case "substitution":
      return "Remplacement";
  }
}

/** Nom d'affichage d'un joueur.
 *
 * Le prénom seul quand le nom de famille est inconnu, le nom de famille seul
 * quand le prénom l'est — « Dupont » plutôt que «  Dupont » avec une espace
 * parasite en tête, et « Andreas » plutôt que « Andreas » avec une espace en
 * queue. Les deux moitiés optionnelles, donc les deux combinaisons doivent
 * être gérées : l'identité n'a qu'un prénom depuis que l'app suit un seul
 * joueur.
 *
 * L'ordre est prénom puis nom parce que c'est ainsi qu'on annonce quelqu'un à
 * voix haute.
 */
export function playerLabel(player: Player): string {
  if (player.firstName === "") return player.lastName;
  if (player.lastName === "") return player.firstName;
  return `${player.firstName} ${player.lastName}`;
}

/**
 * Nom court pour les surfaces étroites (carrousel joueurs).
 *
 * Prénom quand il est connu, sinon nom de famille : dans un onglet de 96 px de
 * large, « Lovelace » et « Alan » ont la même utilité, et un champ vide
 * donnerait l'illusion d'un bug de rendu.
 */
export function playerShortName(player: Player): string {
  return player.firstName === "" ? player.lastName : player.firstName;
}

/**
 * Formatage d'une ligne de la feuille de match, façon `2/6 à 3pts`.
 * `null` si aucune tentative, pour ne pas afficher « 0/0 ».
 */
export function formatSplit(
  made: number,
  attempted: number,
  suffix: string,
): string | null {
  if (attempted === 0) return null;
  return `${made}/${attempted}${suffix}`;
}

/** Pourcentage arrondi à l'entier, `—` si aucune donnée. */
export function formatPercentage(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}%`;
}

/** Initiale du joueur, pour les pastilles et avatars. */
export function playerInitial(player: Player): string {
  const source = player.firstName === "" ? player.lastName : player.firstName;
  return source.charAt(0).toUpperCase();
}
