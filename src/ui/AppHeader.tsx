import { BallIcon } from "@/ui/icons";

/**
 * En-tête de marque — présent sur chaque écran.
 *
 * Reprend la maquette (PLAN.md §12) : fond `--surface-base`, ombre portée,
 * ballon orange et « BBALL STATS » en Alexandria. Fixe en 52 px, et volontairement
 * identique partout : c'est le seul élément qui rende l'application reconnaissable
 * d'un écran à l'autre.
 */

export function AppHeader() {
  return (
    <header className="flex h-[52px] shrink-0 items-center gap-2 bg-base px-(--padding-safe-l) shadow-[0_1px_4px_rgba(0,0,0,0.15)]">
      <BallIcon className="h-9 w-9 text-accent-strong" />
      <span className="font-brand text-2xl font-normal tracking-wide text-primary">
        BBALL STATS
      </span>
    </header>
  );
}
