"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { repos } from "@/data";
import { formatDate, today } from "@/features/match/formatDate";
import { hapticNeutral } from "@/ui/haptics";
import { AppHeader } from "@/ui/AppHeader";

/**
 * Création d'un match (PLAN.md §12).
 *
 * Deux champs, un bouton — la maquette ne montre rien d'autre, et c'est
 * exactement le nombre de gestes utiles : l'adversaire, la date, et lancer la
 * saisie. Le joueur n'est plus rappelé : l'application ne suit qu'**un seul
 * joueur** (PLAN.md §11), le match est donc implicitement le sien.
 */

export default function NewMatchPage() {
  const router = useRouter();

  const [opponent, setOpponent] = useState("");
  const [date, setDate] = useState(() => today());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const store = repos();
      const team = await store.teams.ensureLocal();
      // Garantit que le joueur existe avant la première création. L'écran n'a
      // rien à afficher de lui, mais `matches.create` exige un `playerIds` non
      // vide : `ensureSon` rend ce prérequis toujours satisfait.
      await store.players.ensureSon(team.id);
    })().catch(() => {
      // Fire-and-forget assumé : si la pré-création échoue (base fermée, accès
      // concurrent), `submit()` appelle de nouveau `ensureSon` dans son propre
      // `try` — l'erreur ne se perd donc pas, elle est juste déplacée au moment
      // où l'on en a besoin. La laisser remonter produirait un rejet non géré.
    });
  }, []);

  async function submit() {
    const trimmed = opponent.trim();
    if (trimmed === "") {
      setError("Indiquez l'adversaire.");
      return;
    }
    if (saving) return;

    setSaving(true);
    setError(null);
    try {
      const store = repos();
      const team = await store.teams.ensureLocal();
      const son = await store.players.ensureSon(team.id);
      const match = await store.matches.create(team.id, {
        opponentName: trimmed,
        date,
        playerIds: [son.id],
        status: "live",
      });
      hapticNeutral();
      router.push(`/match/?m=${match.id}`);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Création impossible.",
      );
      setSaving(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col overflow-y-auto pt-(--padding-safe-t) pb-(--padding-safe-b)">
      <AppHeader />

      <div className="flex flex-1 flex-col gap-6 px-4 pt-4">
        <h1 className="font-display text-[19px] font-normal text-primary">
          Nouveau match
        </h1>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-secondary">Adversaire</span>
          <input
            value={opponent}
            onChange={(event) => setOpponent(event.target.value)}
            placeholder="BC Nuit"
            autoComplete="off"
            className={INPUT_CLASS}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm text-secondary">Date</span>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className={`tabular ${INPUT_CLASS}`}
          />
          <span className="tabular text-xs text-muted">{formatDate(date)}</span>
        </label>

        {error !== null && (
          <p role="alert" className="text-sm text-foul">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving}
          className="mt-auto min-h-tap-action w-full rounded-[10px] bg-accent font-display text-2xl font-light text-inverse disabled:opacity-50"
        >
          {saving ? "Création…" : "Commencer la saisie"}
        </button>
      </div>
    </main>
  );
}

/**
 * Champ blanc, comme la maquette (PLAN.md §12) : fond blanc, rayon 10, texte
 * Source Sans 3. `text-primary` est explicite et non hérité — sur un `<input>`,
 * la couleur du texte vient de la feuille de l'agent utilisateur, pas du body.
 */
const INPUT_CLASS =
  "min-h-tap-min rounded-[10px] border border-edge bg-white px-4 text-base text-primary outline-none placeholder:text-muted focus:border-accent";
