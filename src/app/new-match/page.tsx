"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { repos } from "@/data";
import type { PlayerRow } from "@/data/schema";
import { formatDate, today } from "@/features/match/formatDate";
import { hapticNeutral } from "@/ui/haptics";
import { playerLabel } from "@/domain/stats";

/**
 * Création d'un match.
 *
 * L'application ne suit qu'**un seul joueur** (PLAN.md §11) : il n'y a plus de
 * roster à cocher ni de formulaire d'ajout. L'écran tient en deux champs — puis
 * « Commencer la saisie » — ce qui est exactement le nombre de gestes que le
 * coach faisait *après* avoir ignoré la liste de cases.
 *
 * Le joueur n'est pas demandé ici : `ensureSon()` le crée au premier lancement et
 * l'adopte ensuite. Son prénom est donc rappelé sous les champs, pour que le
 * coach vérifie d'un coup d'œil qu'il saisit bien les stats du bon joueur — la
 * seule information que l'écran retire à la saisie.
 */

export default function NewMatchPage() {
  const router = useRouter();

  const [opponent, setOpponent] = useState("");
  const [date, setDate] = useState(() => today());
  const [son, setSon] = useState<PlayerRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const store = repos();
      const team = await store.teams.ensureLocal();
      const player = await store.players.ensureSon(team.id);
      setSon(player);
      setLoading(false);
    })();
  }, []);

  async function submit() {
    const trimmed = opponent.trim();
    if (trimmed === "") {
      setError("Indiquez l'adversaire.");
      return;
    }
    // Sans joueur, le match n'aurait aucun `playerId` : la saisie se retrouverait
    // sans auteur et les statistiques cumulées seraient vides. Mieux vaut refuser
    // que créer un match qui ne pourra jamais être rempli.
    if (son === null) {
      setError("Le joueur n'est pas encore prêt.");
      return;
    }
    if (saving) return;

    setSaving(true);
    setError(null);
    try {
      const store = repos();
      const team = await store.teams.ensureLocal();
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
    <main className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pt-(--padding-safe-t) pb-(--padding-safe-b)">
      <header className="flex items-center gap-2 pt-4">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Retour"
          className="min-h-tap-min min-w-tap-min rounded-lg border border-edge text-sm"
        >
          ‹
        </button>
        <h1 className="text-xl font-semibold">Nouveau match</h1>
      </header>

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

      {/*
        Le joueur suivi, en lecture seule. L'identité vient du code
        (`SON`) : l'afficher ici est le seul moyen pour le coach de vérifier
        qu'il ouvre la bonne feuille, et la seule ligne que cet écran affiche
        en plus des deux champs.
      */}
      <section className="surface-card flex items-baseline justify-between gap-3 px-4 py-3">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">
          Joueur
        </span>
        {loading ? (
          <span className="text-sm text-muted">Chargement…</span>
        ) : son === null ? (
          <span className="text-sm text-foul">Indisponible</span>
        ) : (
          // `text-lg` et non `text-base` : le thème définit une couleur
          // `--color-base`, donc Tailwind v4 lit `text-base` comme une **couleur**
          // — et le prénom s'afficherait en `--surface-base` sur une carte, donc
          // noir sur noir. Trouvé par l'audit de contraste AA.
          <span className="truncate text-lg font-medium text-primary">
            {playerLabel(son)}
          </span>
        )}
      </section>

      {error !== null && (
        <p role="alert" className="text-sm text-foul">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={saving || son === null}
        className="sticky bottom-2 min-h-tap-action w-full rounded-xl bg-accent text-lg font-semibold text-inverse disabled:opacity-50"
      >
        {saving ? "Création…" : "Commencer la saisie"}
      </button>
    </main>
  );
}

/**
 * Classe commune des champs de saisie.
 *
 * `text-primary` est explicite et non hérité : sur un `<input>`, la couleur du
 * texte vient de la feuille de l'agent utilisateur (`FieldText`), pas du body —
 * Tailwind v4 ne réinitialise pas cette propriété. Résultat observé : du texte
 * noir sur fond sombre, invisible. Le compositeur du thème fixait bien `body`, ce qui
 * laissait croire que l'héritage couvrait le cas.
 */
const INPUT_CLASS =
  "min-h-tap-min rounded-xl border border-edge bg-raised text-base text-primary outline-none placeholder:text-muted focus:border-accent";
