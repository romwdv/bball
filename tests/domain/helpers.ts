import { ActionSchema, type Action } from "@/domain/types";
import type { ActionDraft } from "@/domain/rules";

/**
 * Convertit les drafts typés de `combos` en actions complètes.
 *
 * Partagé par les tests de règles, d'undo et d'export : trois fichiers qui
 * construisent les mêmes actions autrement finissent par diverger — et un test
 * qui valide ses propres fixtures ne valide rien.
 */

let counter = 0;

/** Réinitialise le compteur de fixtures, pour des `seq` prévisibles par test. */
export function resetFixtures(): void {
  counter = 0;
}

export function expand(drafts: readonly ActionDraft[]): Action[] {
  return drafts.map((draft) => {
    counter += 1;
    return ActionSchema.parse({
      id: `g${counter}`,
      matchId: "m1",
      seq: counter,
      voidedAt: null,
      ...draft,
    });
  });
}
