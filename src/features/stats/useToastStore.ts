"use client";

import { create } from "zustand";

/**
 * Message éphémère de l'écran `/stats`.
 *
 * Store séparé de celui du match, volontairement : les deux n'ont ni le même
 * cycle de vie ni la même audience. Le toast de saisie suit un joueur pendant
 * un quart temps, celui-ci confirme un export une fois et disparaît.
 */

interface ToastStore {
  text: string | null;
  /** Incrémenté à chaque message : rejoue l'animation si le texte est identique. */
  id: number;
  show: (text: string) => void;
  clear: () => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  text: null,
  id: 0,
  show: (text) => set((state) => ({ text, id: state.id + 1 })),
  clear: () => set({ text: null }),
}));
