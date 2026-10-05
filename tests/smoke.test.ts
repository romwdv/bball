import { describe, expect, it } from "vitest";

describe("socle", () => {
  it("les tests tournent", () => {
    expect(1 + 1).toBe(2);
  });

  it("IndexedDB est disponible via fake-indexeddb", () => {
    expect(typeof indexedDB).not.toBe("undefined");
  });

  it("l'alias @/ pointe sur src/", async () => {
    const mod = await import("@/app/page");
    expect(typeof mod.default).toBe("function");
  });
});
