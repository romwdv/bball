import {
  type Action,
  type ActionKind,
  type Quarter,
  type ReboundSide,
  type ShotValue,
} from "./types";

/**
 * Règles de projection — le cœur métier de l'application.
 *
 * `project()` transforme **une** action en deltas de statistiques. Toutes les
 * statistiques du produit découlent de là : rien d'autre n'est dupliqué.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ DÉCISION MÉTIER NON STANDARD — à lire avant de modifier cette fonction
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Le tir **raté** sur lequel une faute est sifflée **ne compte pas** comme
 * tentative ratée (FGA). Il ne produit que +1 faute.
 *
 * En règle FIBA officielle, ce tir compte comme une tentative ratée (FGA +1).
 * Ici il est volontairement écarté, si bien que le pourcentage de réussite du
 * joueur n'est pas pénalisé par ces tirs.
 *
 * Conséquence à garder en tête : le total des tentatives ne correspondra pas au
 * total des tirs observés, et le % de réussite sera « optimiste » par rapport à
 * la règle FIBA.
 *
 * Si un jour cette règle doit changer, **une seule ligne de `projectShot()` est
 * à modifier**, et les tests de `tests/domain/rules.test.ts` le signalent.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ Les FTA ne sont comptés QUE par les actions `free_throw`
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Un tir fouillé n'ajoute pas de FTA : il indique seulement *quels* lancers sont
 * dus, via `awardedFreeThrows()`. Les FTA sont ensuite comptés un par un quand
 * le coach saisit chaque lancer.
 *
 * Ce choix évite un double comptage : ajouter +2 FTA sur le tir puis +2 sur les
 * deux lancers saisis donnerait 4 FTA pour une série de 2. C'est aussi plus
 * honnête sur le plan statistique — un joueur qui n'a pas eu l'occasion de
 * tirer ses 2 lancers n'a pas « tenté » 2 lancers.
 *
 * Contrepartie : si le coach ferme l'app sans saisir les lancers, les FTA de la
 * série n'apparaîtront pas. Le nombre de lancers dus reste consultable via
 * `awardedFreeThrows()` et le fil du match.
 */
export interface StatDelta {
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
  substitutions: number;
}

/** Delta neutre. Réutilisé pour construire des deltas partiels. */
export const EMPTY_DELTA: Readonly<StatDelta> = Object.freeze({
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
  substitutions: 0,
});

export function emptyDelta(): StatDelta {
  return { ...EMPTY_DELTA };
}

/** Somme deux deltas. `project()` l'utilise pour les combos atomiques. */
export function addDeltas(a: StatDelta, b: StatDelta): StatDelta {
  return {
    points: a.points + b.points,
    fgm2: a.fgm2 + b.fgm2,
    fga2: a.fga2 + b.fga2,
    fgm3: a.fgm3 + b.fgm3,
    fga3: a.fga3 + b.fga3,
    ftm: a.ftm + b.ftm,
    fta: a.fta + b.fta,
    fouls: a.fouls + b.fouls,
    reboundsOffensive: a.reboundsOffensive + b.reboundsOffensive,
    reboundsDefensive: a.reboundsDefensive + b.reboundsDefensive,
    assists: a.assists + b.assists,
    turnovers: a.turnovers + b.turnovers,
    steals: a.steals + b.steals,
    blocks: a.blocks + b.blocks,
    substitutions: a.substitutions + b.substitutions,
  };
}

/**
 * Règles propres au tir à l'espace.
 *
 * Une action valide par le schéma Zod porte forcément `value` et `made` ; les
 * assertions ci-dessous ne sont donc pas des garde-fous contre des données
 * corrompues, elles servent seulement à satisfaire `strictNullChecks`.
 */
function projectShot(action: Action): StatDelta {
  const delta = emptyDelta();
  const value = action.value as ShotValue;
  const made = action.made as boolean;
  const fouled = action.fouled === true;

  if (made) {
    // Panier réussi, avec ou sans faute sifflée (and-1).
    // Dans les deux cas le tir compte comme une tentative réussie.
    delta.points += value;
    if (value === 2) {
      delta.fgm2 += 1;
      delta.fga2 += 1;
    } else {
      delta.fgm3 += 1;
      delta.fga3 += 1;
    }
    if (fouled) {
      // And-1 : le panier compte, la faute aussi.
      // Pas de FTA ici — le lancer sera saisi comme action `free_throw` distincte.
      delta.fouls += 1;
    }
    return delta;
  }

  // Tir raté.
  if (fouled) {
    // ⚠️ Règle non-FIBA : le tir n'est PAS compté en tentative.
    // Voir l'avertissement en tête de fichier.
    // Seule la faute est comptée ; les FTA arriveront avec les lancers saisis.
    delta.fouls += 1;
    return delta;
  }

  // Tir raté sans faute : tentative ratée classique.
  if (value === 2) {
    delta.fga2 += 1;
  } else {
    delta.fga3 += 1;
  }
  return delta;
}

/**
 * Projette une action en deltas de statistiques.
 *
 * Les actions annulées (`voidedAt`) renvoient un delta neutre : le domaine ne
 * demande jamais à l'appelant de filtrer, ce qui supprime une classe entière de
 * bugs où un compteur et l'historique divergent.
 */
export function project(action: Action): StatDelta {
  if (action.voidedAt !== null && action.voidedAt !== undefined) {
    return emptyDelta();
  }

  const kind: ActionKind = action.kind;

  switch (kind) {
    case "shot":
      return projectShot(action);

    case "free_throw": {
      const delta = emptyDelta();
      delta.fta += 1;
      if (action.made === true) {
        delta.ftm += 1;
        delta.points += 1;
      }
      return delta;
    }

    case "foul":
      return { ...emptyDelta(), fouls: 1 };

    case "rebound": {
      const delta = emptyDelta();
      if (action.side === "offensive") {
        delta.reboundsOffensive += 1;
      } else {
        delta.reboundsDefensive += 1;
      }
      return delta;
    }

    case "assist":
      return { ...emptyDelta(), assists: 1 };

    case "turnover":
      return { ...emptyDelta(), turnovers: 1 };

    case "steal":
      return { ...emptyDelta(), steals: 1 };

    case "block":
      return { ...emptyDelta(), blocks: 1 };

    case "substitution":
      // Une substitution n'est pas une statistique : c'est une trace
      // chronologique. Elle est comptée pour pouvoir l'afficher dans le fil.
      return { ...emptyDelta(), substitutions: 1 };
  }
}

// ---------------------------------------------------------------------------
// Construction des actions
// ---------------------------------------------------------------------------

/**
 * Champs communs à toute action créée par l'application.
 * `seq` et `id` sont fournis par le repository : c'est lui qui garantit
 * l'unicité du `id` et la monotonie du `seq`.
 */
/** Champs communs, quels que soient la variante. */
type DraftCommon = { playerId: string; quarter: Quarter; groupId?: string };

/** Objet vide. `{}` accepterait n'importe quelle propriété : on l'interdit. */
type EmptyObject = Record<never, never>;

/** Champs obligatoires d'un `kind` donné. */
type DraftFields = {
  shot: { value: ShotValue; made: boolean; fouled?: boolean };
  free_throw: { made: boolean };
  foul: EmptyObject;
  rebound: { side: ReboundSide };
  // Actions sans donnée chiffrée : le `kind` suffit à les qualifier.
  assist: EmptyObject;
  turnover: EmptyObject;
  steal: EmptyObject;
  block: EmptyObject;
  substitution: EmptyObject;
};

/**
 * Un `kind` + `K`, moins ses champs spécifiques.
 *
 * Union discriminée plutôt que champs optionnels : impossible de construire un
 * rebond sans `side`, ou un tir sans `value`. L'erreur est attrapée à la
 * compilation, pas par un garde-fou à l'exécution.
 */
export type DraftOf<K extends ActionKind> = DraftCommon & {
  kind: K;
} & DraftFields[K];

export type ActionDraft = { [K in ActionKind]: DraftOf<K> }[ActionKind];

/**
 * Calcule le delta d'un combo **sans l'écrire**.
 *
 * Sert à valider l'atomicité avant persistance : si le delta obtenu ne
 * correspond pas à ce que la saisie visait, rien n'est écrit. Le repository
 * s'en sert pour vérifier qu'une transaction n'a pas été à moitié appliquée.
 */
export function planActions(drafts: readonly ActionDraft[]): {
  drafts: readonly ActionDraft[];
  delta: StatDelta;
} {
  let delta = emptyDelta();
  for (const draft of drafts) {
    delta = addDeltas(delta, projectDraft(draft));
  }
  return { drafts, delta };
}

/** Delta attendu d'un `ActionDraft`, sans avoir à construire l'action complète. */
function projectDraft(draft: ActionDraft): StatDelta {
  // Un draft minimal suffit : `project()` ne lit ni `id`, ni `matchId`, ni `seq`.
  // `playerId` et `quarter` viennent du draft, pas de la constante.
  return project({
    id: "draft",
    matchId: "draft",
    seq: 0,
    voidedAt: null,
    ...draft,
  } as Action);
}

// ---------------------------------------------------------------------------
// Compositions de combos
// ---------------------------------------------------------------------------

/**
 * Combinaisons d'actions autorisées depuis l'écran de saisie.
 *
 * Chaque fonction renvoie des drafts **déjà groupés** : l'annulation portera sur
 * l'ensemble, ce qui est le comportement attendu sur le terrain (on ne défait pas
 * un panier de 2 points sans sa faute associée).
 *
 * Chaque fonction est typée par `kind`, ce qui garantit à la compilation que les
 * champs obligatoires du `kind` sont bien fournis. Impossible, par exemple, de
 * créer un rebond sans `side` ou un tir sans `value`.
 *
 * `planActions(combo)` accepte un combo entier et renvoie son delta, pour valider
 * l'atomicité avant écriture.
 */
export const combos = {
  /** Panier à 2 points réussi, sans faute. */
  twoMade: (playerId: string, quarter: Quarter, groupId: string) =>
    [
      { kind: "shot", playerId, quarter, groupId, value: 2, made: true },
    ] as const,

  /** Panier à 3 points réussi, sans faute. */
  threeMade: (playerId: string, quarter: Quarter, groupId: string) =>
    [
      { kind: "shot", playerId, quarter, groupId, value: 3, made: true },
    ] as const,

  /**
   * Panier à 2 ou 3 points + faute sifflée (and-1).
   *
   * Une seule action : le panier et la faute sont deux effets de la même action.
   * Aucun `foul` séparé, sinon la faute serait comptée deux fois.
   */
  madeAndFouled: (
    playerId: string,
    quarter: Quarter,
    groupId: string,
    value: ShotValue,
  ) =>
    [
      {
        kind: "shot",
        playerId,
        quarter,
        groupId,
        value,
        made: true,
        fouled: true,
      },
    ] as const,

  /** Tir raté sans faute. */
  missed: (
    playerId: string,
    quarter: Quarter,
    groupId: string,
    value: ShotValue,
  ) =>
    [
      {
        kind: "shot",
        playerId,
        quarter,
        groupId,
        value,
        made: false,
        fouled: false,
      },
    ] as const,

  /**
   * Tir raté + faute sifflée.
   *
   * ⚠️ Ne crée **pas** d'action `shot` ratée « normale » : ce tir n'existe pas
   * dans les stats (règle non-FIBA). Une seule action est créée, portant la
   * faute. Le nombre de lancers dus est renvoyé par `awardedFreeThrows()`, qui
   * pilote la mini-sheet de saisie.
   */
  missedAndFouled: (
    playerId: string,
    quarter: Quarter,
    groupId: string,
    value: ShotValue,
  ) =>
    [
      {
        kind: "shot",
        playerId,
        quarter,
        groupId,
        value,
        made: false,
        fouled: true,
      },
    ] as const,

  /** Faute simple, sans tir associé. */
  foul: (playerId: string, quarter: Quarter, groupId: string) =>
    [{ kind: "foul", playerId, quarter, groupId }] as const,

  /** Un lancer libre, réussi ou raté. */
  freeThrow: (
    playerId: string,
    quarter: Quarter,
    groupId: string,
    made: boolean,
  ) => [{ kind: "free_throw", playerId, quarter, groupId, made }] as const,

  /** Rebond offensif ou défensif. */
  rebound: (
    playerId: string,
    quarter: Quarter,
    groupId: string,
    side: ReboundSide,
  ) => [{ kind: "rebound", playerId, quarter, groupId, side }] as const,

  /** Passe décisive. */
  assist: (playerId: string, quarter: Quarter, groupId: string) =>
    [{ kind: "assist", playerId, quarter, groupId }] as const,

  /** Perte de balle. */
  turnover: (playerId: string, quarter: Quarter, groupId: string) =>
    [{ kind: "turnover", playerId, quarter, groupId }] as const,

  /** Interception. */
  steal: (playerId: string, quarter: Quarter, groupId: string) =>
    [{ kind: "steal", playerId, quarter, groupId }] as const,

  /** Contre. */
  block: (playerId: string, quarter: Quarter, groupId: string) =>
    [{ kind: "block", playerId, quarter, groupId }] as const,
} as const;

/**
 * Nombre de lancers accordés après une faute sur un tir manqué.
 * Retourne `null` si l'action n'ouvre pas une série de lancers.
 *
 * Alimente la mini-sheet de saisie des LF ouverte par les combos.
 */
export function awardedFreeThrows(action: Action): number | null {
  if (
    action.kind !== "shot" ||
    action.made !== false ||
    action.fouled !== true
  ) {
    return null;
  }
  return action.value === 3 ? 3 : 2;
}
