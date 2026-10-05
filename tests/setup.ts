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
