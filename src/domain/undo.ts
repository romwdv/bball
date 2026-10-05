import { type Action, type Quarter, ActionSchema } from "@/domain/types";

/**
 * Annulation d'actions.
 *
 * Le modèle est append-only : rien n'est jamais supprimé. Une annulation écrit un
 * `voidedAt`, et tous les agrégats ignorent les actions ainsi annulées (voir
 * `project()` dans `rules.ts`).
 *
 * Cette séparation évite deux symptômes localisés :
 * 1. un compteur et un historique qui divergent (impossible ici, car l'historique
 *    est la source et le compteur en est dérivé) ;
 * 2. une annulation qui effacerait une trace alors que le coach veut voir ce qu'il
 *    a défait dans le fil du match.
 */

/**
 * Toutes les actions d'un même `groupId`.
 *
 * Un combo comme `2P+F` produit plusieurs actions liées : les défaire ensemble est
 * le seul comportement acceptable sur le terrain. Défaire « le panier » sans
 * « la faute » qui va avec produirait des statistiques fausses.
 */
export function groupOf(actions: readonly Action[], groupId: string): Action[] {
  return actions.filter((action) => action.groupId === groupId);
}

/**
 * Dernière action saisie, ou dernière action d'un groupe.
 *
 * Sert à déterminer ce que l'undo doit retirer.
 */
export function lastAction(actions: readonly Action[]): Action | null {
  let latest: Action | null = null;
  for (const action of actions) {
    if (latest === null || action.seq > latest.seq) {
      latest = action;
    }
  }
  return latest;
}

/**
 * Ensemble d'actions qu'un undo doit retirer.
 *
 * Trois cas, dans l'ordre de priorité :
 * 1. la dernière action a un `groupId` → tout le groupe est retiré ;
 * 2. sinon → la seule dernière action.
 *
 * Les actions déjà annulées sont ignorées : un double undo ne doit pas
 * annuler la seconde action la plus récente, ce qui donnerait au coach
 * l'impression que l'annulation est cassée.
 */
export function undoScope(actions: readonly Action[]): Action[] {
  const active = actions.filter(
    (action) => action.voidedAt === null || action.voidedAt === undefined,
  );
  const latest = lastAction(active);
  if (latest === null) return [];

  if (latest.groupId !== undefined) {
    // Un groupe peut contenir des actions déjà annulées : on ne les reprend pas.
    return groupOf(active, latest.groupId);
  }
  return [latest];
}

/**
 * Les actions qu'un redo devrait réappliquer après un undo.
 *
 * Non implémenté côté interface (l'app n'expose pas de redo), mais la logique est
 * ici pour que le comportement soit défini et testable le jour où le besoin
 * apparaît.
 */
export function redoScope(
  actions: readonly Action[],
  undone: readonly Action[],
): Action[] {
  void actions;
  return [...undone].sort((a, b) => a.seq - b.seq);
}

/**
 * Marque les actions comme annulées. Ne modifie **rien** en place.
 *
 * Le repository remplace ces enregistrements dans IndexedDB ; le domaine se
 * contente de produire la nouvelle version, ce qui garde cette logique pure.
 */
export function voidActions(
  actions: readonly Action[],
  at: number = Date.now(),
): Action[] {
  return actions.map((action) =>
    action.voidedAt === null || action.voidedAt === undefined
      ? { ...action, voidedAt: at }
      : action,
  );
}

/**
 * Renvoie la liste **complète** des actions, périmètre d'annulation compris.
 *
 * Important : le périmètre annulé reste dans la liste, avec son `voidedAt`. Il
 * n'est pas retiré, sinon l'historique du match perdrait la trace de ce qui a été
 * défait — ce qui est précisément ce qu'on veut montrer au coach.
 */
export function applyUndo(actions: readonly Action[], at?: number): Action[] {
  const scope = new Set(undoScope(actions).map((action) => action.id));
  return actions.map((action) =>
    scope.has(action.id) &&
    (action.voidedAt === null || action.voidedAt === undefined)
      ? { ...action, voidedAt: at ?? Date.now() }
      : action,
  );
}

// ---------------------------------------------------------------------------
// Fidélité de la saisie
// ---------------------------------------------------------------------------

export interface RedoDraftHint {
  /** Action qui sera recréée par le prochain appui sur « refaire ». */
  kind: Action["kind"];
  playerId: string;
  quarter: Quarter;
}

/**
 * Décrit ce que le prochain appui sur « refaire » recréerait.
 *
 * Sert à afficher « Réfaire : panier 2 pts » dans le toast d'undo, ce qui rend
 * l'annulation réversible en pratique sans coût d'interface supplémentaire.
 *
 * Une action seule → elle-même. Un groupe → la première action du groupe, qui
 * représente l'intention (pour `2P+F`, le tir ; les lancers suivent ensuite).
 */
export function redoHint(actions: readonly Action[]): RedoDraftHint | null {
  const scope = undoScope(actions);
  const first = scope[0];
  if (first === undefined) return null;
  return { kind: first.kind, playerId: first.playerId, quarter: first.quarter };
}

/** Nombre d'actions actives dans une liste. */
export function activeCount(actions: readonly Action[]): number {
  return actions.filter(
    (action) => action.voidedAt === null || action.voidedAt === undefined,
  ).length;
}

/** Une action est-elle cohérente avec le schéma ? Utilisé par le repository. */
export function isWellFormed(action: Action): boolean {
  return ActionSchema.safeParse(action).success;
}
