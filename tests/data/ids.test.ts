import { describe, expect, it } from "vitest";
import { isUuid, newId } from "@/data/ids";

describe("newId", () => {
  it("produit un UUID v4 conforme à la RFC 4122", () => {
    expect(isUuid(newId())).toBe(true);
  });

  it("ne produit jamais deux fois le même identifiant", () => {
    const ids = new Set(Array.from({ length: 2000 }, () => newId()));
    expect(ids.size).toBe(2000);
  });

  it("repli sur getRandomValues quand randomUUID est absent", () => {
    // Safari < 15.4 n'expose pas `crypto.randomUUID`. L'identifiant produit doit
    // rester un UUID v4, sinon la colonne `id` de Supabase et le tri du
    // tirage descendant auraient à traiter deux conventions.
    const original = globalThis.crypto.randomUUID;
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      value: undefined,
      configurable: true,
      writable: true,
    });

    try {
      const ids = Array.from({ length: 50 }, () => newId());
      expect(ids.every((id) => isUuid(id))).toBe(true);
      expect(new Set(ids).size).toBe(50);
    } finally {
      Object.defineProperty(globalThis.crypto, "randomUUID", {
        value: original,
        configurable: true,
        writable: true,
      });
    }
  });
});
