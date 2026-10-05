"use client";

import { create } from "zustand";
import { newId } from "@/data/ids";
import type { ActionRow } from "@/data/schema";
import { repos } from "@/data";
import {
  hapticCombo,
  hapticMade,
  hapticMissed,
  hapticNeutral,
  hapticUndo,
} from "@/ui/haptics";
import type { ActionDraft } from "@/domain/rules";
import { QUARTERS, type Quarter } from "@/domain/types";
import { describeAction } from "@/domain/stats";

/**
 * État de l'écran de saisie.
 *
 * Volatile par construction : ce store ne contient que ce qui change d'un appui à
 * l'autre — joueur verrouillé, période, fiche ouverte. Tout ce qui doit survivre
 * à un redémarrage est dans IndexedDB, écrit par les repositories. Si une donnée
 * de saisie vivait ici, elle serait perdue au rechargement de la PWA ; c'est
 * exactement ce que la phase 7 ne pourra pas rattraper.
 *
 * Le store ne connaît pas le rendu : il expose des actions, et les composants
 * s'y abonnent. Un composant de test peut donc piloter la saisie sans DOM.
 */

export type SheetKind = "free-throws" | null;

export interface UndoNotice {
  /** Incrémenté à chaque annonce : rejoue l'animation si le texte est identique. */
  id: number;
  /** Texte déjà rédigé, ex. « Panier 2 pts annulé ». */
  text: string;
}

export interface FlashNotice {
  id: number;
  text: string;
  /** Le geste a échoué : le retour visuel doit être plus fort que pour un panier. */
  missed: boolean;
}

interface MatchStore {
  matchId: string | null;
  /** Joueur verrouillé : les actions suivantes s'y appliquent. */
  playerId: string | null;
  quarter: Quarter;
  sheet: SheetKind;
  /** Nombre de lancers dus par la fiche courante. */
  pendingFreeThrows: number;
  /** Actions de la série de lancers en cours, pour le libellé de la fiche. */
  sheetGroupId: string | null;
  /** Compteur d'annonces, source de `notice.id`. */
  noticeCount: number;
  notice: UndoNotice | null;
  /**
   * Confirmation immédiate de la dernière saisie.
   *
   * Distincte du toast d'annulation : celle-ci est un correctif qu'on choisit,
   * celle-là est un acquittement qu'on subit. Le tir raté est le cas critique —
   * il ne change ni le score ni aucune pastille du carrousel, donc sans retour
   * explicite le coach ne sait pas si son appui long est passé.
   */
  flash: FlashNotice | null;
  /** Incrémenté à chaque écriture pour forcer le rechargement des statistiques. */
  revision: number;

  openMatch: (matchId: string, playerId?: string | null) => void;
  closeMatch: () => void;
  lockPlayer: (playerId: string) => void;
  setQuarter: (quarter: Quarter) => void;
  openFreeThrowSheet: (groupId: string, due: number) => void;
  closeSheet: () => void;

  /**
   * Enregistre un combo et renvoie les actions écrites.
   *
   * Le groupe est créé ici et pas dans le composant : c'est le seul endroit où
   * l'on sait qu'un geste = un groupe annulable d'un seul coup.
   *
   * Les actions **écrites** sont renvoyées, et non un simple `groupId`, parce que
   * le bandeau de combos doit savoir combien de lancers le domaine accorde à la
   * faute qu'il vient d'enregistrer — `awardedFreeThrows()` se lit sur l'action
   * réelle. Renvoyer l'objet évite au composant de relire la base pour retrouver
   * ce qu'il vient d'écrire.
   */
  record: (
    drafts: readonly ActionDraft[],
    kind: HapticKind,
  ) => Promise<ActionRow[]>;
  /**
   * Annule la dernière saisie et renseigne le toast.
   *
   * Le libellé est rédigé **avant** l'annulation : `undoScope()` raisonne sur les
   * actions encore actives, et une fois l'annulation écrite il ne reste plus rien
   * à décrire. D'où le champ `notice` renseigné par l'appelant.
   */
  undoLast: (notice?: Omit<UndoNotice, "id">) => Promise<number>;
  dismissNotice: () => void;
  dismissFlash: () => void;
}

export type HapticKind = "made" | "missed" | "combo" | "neutral";

function buzz(kind: HapticKind): void {
  switch (kind) {
    case "made":
      hapticMade();
      break;
    case "missed":
      hapticMissed();
      break;
    case "combo":
      hapticCombo();
      break;
    case "neutral":
      hapticNeutral();
      break;
  }
}

export const useMatchStore = create<MatchStore>((set, get) => ({
  matchId: null,
  playerId: null,
  quarter: 1,
  sheet: null,
  pendingFreeThrows: 0,
  sheetGroupId: null,
  noticeCount: 0,
  notice: null,
  flash: null,
  revision: 0,

  openMatch: (matchId, playerId = null) =>
    set({
      matchId,
      playerId,
      quarter: 1,
      sheet: null,
      sheetGroupId: null,
      notice: null,
    }),

  closeMatch: () =>
    set({
      matchId: null,
      playerId: null,
      sheet: null,
      sheetGroupId: null,
      notice: null,
    }),

  lockPlayer: (playerId) => set({ playerId }),

  setQuarter: (quarter) => set({ quarter }),

  openFreeThrowSheet: (groupId, due) =>
    set({
      sheet: "free-throws",
      sheetGroupId: groupId,
      pendingFreeThrows: due,
    }),

  closeSheet: () =>
    set({ sheet: null, sheetGroupId: null, pendingFreeThrows: 0 }),

  record: async (drafts, kind) => {
    const { matchId, quarter } = get();
    const playerId = drafts[0]?.playerId ?? get().playerId;
    if (matchId === null || playerId === null || drafts.length === 0) {
      throw new Error("record : match ou joueur non sélectionné");
    }

    const groupId = newId();
    // La période vient du store, pas du composant : c'est le seul moyen que
    // « Q3 » dans le header et la période réellement écrite ne divergent pas.
    const stamped = drafts.map((draft) => ({ ...draft, playerId, quarter }));

    const result = await repos().actions.append(matchId, stamped, { groupId });
    buzz(kind);

    // Le libellé vient du domaine : c'est le seul endroit qui sait dire
    // « Panneau 3 pts + faute » sans que l'UI réinvente le vocabulaire.
    const written = result.actions[0];
    set({
      revision: get().revision + 1,
      flash:
        written === undefined
          ? null
          : {
              id: get().revision + 1,
              text: describeAction(written),
              missed: kind === "missed",
            },
    });
    return result.actions;
  },

  undoLast: async (notice) => {
    const { matchId } = get();
    if (matchId === null) return 0;

    const voided = await repos().actions.undoLast(matchId);
    hapticUndo();
    const nextCount = get().noticeCount + 1;
    set({
      revision: get().revision + 1,
      noticeCount: nextCount,
      notice: notice === undefined ? null : { ...notice, id: nextCount },
    });
    return voided.length;
  },

  dismissNotice: () => set({ notice: null }),

  dismissFlash: () => set({ flash: null }),
}));

/** Périodes, pour le sélecteur du header. Ré-exporté pour n'avoir qu'un import. */
export { QUARTERS };

/** Libellé du joueur verrouillé, pour l'en-tête. */
export function quarterLabel(quarter: Quarter): string {
  return `Q${quarter}`;
}
