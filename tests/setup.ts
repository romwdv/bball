import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// jsdom n'implémente ni `matchMedia` (Tailwind dark natif) ni les APIs tactiles.
// Ces stubs évitent des échecs qui n'ont rien à voir avec le code testé.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

if (
  typeof globalThis.navigator !== "undefined" &&
  !globalThis.navigator.vibrate
) {
  Object.defineProperty(globalThis.navigator, "vibrate", {
    value: vi.fn(),
    writable: true,
    configurable: true,
  });
}

// jsdom n'implémente pas `PointerEvent` : sans lui, React 19 n'abonne pas ses
// écouteurs synthétiques `pointerdown`, et l'écran de saisie — dont tout le
// geste repose sur ce minimum — n'est testable qu'à moitié.
//
// Un simple alias vers `MouseEvent` ne suffit pas : `isPrimary`, `pointerId` et
// `pointerType` n'existent pas sur `MouseEvent`, donc un alias les perd et le
// hook (`if (!event.isPrimary) return`) ignorerait tous les appuis. Cette classe
// les recopie, ce qui rend l'environnement de test fidèle au navigateur sur les
// trois propriétés que la saisie lit.
if (
  typeof window !== "undefined" &&
  typeof window.PointerEvent === "undefined"
) {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;
    readonly pressure: number;

    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
      this.pointerType = params.pointerType ?? "mouse";
      this.isPrimary = params.isPrimary ?? true;
      this.pressure = params.pressure ?? 0;
    }
  }

  Object.defineProperty(window, "PointerEvent", {
    value: PointerEventPolyfill,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, "PointerEvent", {
    value: PointerEventPolyfill,
    writable: true,
    configurable: true,
  });
}
