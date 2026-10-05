"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { repos } from "@/data";
import type { PlayerRow } from "@/data/schema";
import { formatDate, today } from "@/features/match/formatDate";
import { hapticNeutral } from "@/ui/haptics";
import { playerLabel } from "@/domain/stats";

/**
 * Création d'un match.
 *
 * Le roster est pré-coché en entier : une équipe locale dispute avec ses joueurs
 * habituels, et faire cocher douze cases avant chaque match est une friction
 * pure. Le coach décoche qui il veut, ou coche un remplaçant arrivé en retard.
 *
 * La création rapide d'un joueur (numéro + nom) est là parce que le cas se
 * présente réellement : un remplaçant qui n'a jamais été saisi ne doit pas
 * obliger à quitter l'écran pour revenir au roster.
 */

export default function NewMatchPage() {
  const router = useRouter();

  const [opponent, setOpponent] = useState("");
  const [date, setDate] = useState(() => today());
  const [roster, setRoster] = useState<PlayerRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mini-formulaire de création rapide.
  const [quickNumber, setQuickNumber] = useState("");
  const [quickName, setQuickName] = useState("");

  useEffect(() => {
    void (async () => {
      const store = repos();
      const team = await store.teams.ensureLocal();
      const players = await store.players.listByTeam(team.id);
      setRoster(players);
      // Tout coché par défaut : cf. justification en tête de fichier.
      setSelected(new Set(players.map((player) => player.id)));
      setLoading(false);
    })();
  }, []);

  const toggle = useCallback((playerId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(playerId)) {
        next.delete(playerId);
      } else {
        next.add(playerId);
      }
      return next;
    });
  }, []);

  async function addQuickPlayer() {
    const name = quickName.trim();
    if (name === "") return;
    setError(null);

    const [first, ...rest] = name.split(/\s+/);
    const parsed = Number.parseInt(quickNumber, 10);

    try {
      // « Dupont » seul : c'est le cas le plus fréquent en bord de terrain, et
      // le nom complet n'est pas connu de tout le monde. Le premier mot part
      // donc dans `lastName` — convention française, et c'est le nom que le
      // coach cherche dans le carrousel.
      const single = rest.length === 0;
      const created = await repos().players.create(LOCAL_TEAM, {
        firstName: single ? "" : (rest.join(" ") ?? ""),
        lastName: single ? (first ?? name) : (first ?? ""),
        number: Number.isNaN(parsed) ? null : parsed,
      });

      setRoster((current) => [...current, created].sort(compareByNumber));
      setSelected((current) => new Set(current).add(created.id));
      setQuickNumber("");
      setQuickName("");
      hapticNeutral();
    } catch (caught) {
      // Sans ce `catch`, l'échec est une promesse rejetée sans message : le
      // coach appuie sur « Ajouter », rien ne se passe, et l'input reste vide.
      // Exactement le symptôme rapporté.
      setError(caught instanceof Error ? caught.message : "Ajout impossible.");
    }
  }

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
      const match = await store.matches.create(team.id, {
        opponentName: trimmed,
        date,
        playerIds: [...selected],
        status: "live",
      });
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

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-secondary">
            Roster · {selected.size}/{roster.length}
          </h2>
          <button
            type="button"
            onClick={() =>
              setSelected(
                selected.size === roster.length
                  ? new Set()
                  : new Set(roster.map((player) => player.id)),
              )
            }
            className="min-h-11 rounded-lg px-3 text-sm text-accent"
          >
            {selected.size === roster.length ? "Tout décocher" : "Tout cocher"}
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-muted">Chargement du roster…</p>
        ) : roster.length === 0 ? (
          <p className="rounded-xl border border-edge px-4 py-3 text-sm text-muted">
            Aucun joueur enregistré. Ajoutez-en un ci-dessous.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {roster.map((player) => (
              <li key={player.id}>
                <button
                  type="button"
                  aria-pressed={selected.has(player.id)}
                  onClick={() => toggle(player.id)}
                  className={`flex min-h-tap-min w-full items-center gap-3 rounded-xl border px-4 py-2 text-left ${
                    selected.has(player.id)
                      ? "border-accent bg-accent-subtle"
                      : "border-edge bg-raised"
                  }`}
                >
                  <span className="tabular w-7 text-sm text-muted">
                    {player.number ?? "—"}
                  </span>
                  <span className="flex-1 font-medium">
                    {playerLabel(player)}
                  </span>
                  <span
                    className={`text-lg ${selected.has(player.id) ? "text-accent" : "text-edge-strong"}`}
                    aria-hidden="true"
                  >
                    {selected.has(player.id) ? "✓" : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="surface-card mt-1 flex flex-col gap-2 p-3">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">
            Ajouter un joueur
          </span>
          <div className="flex gap-2">
            <input
              value={quickNumber}
              onChange={(event) => setQuickNumber(event.target.value)}
              inputMode="numeric"
              placeholder="N°"
              aria-label="Numéro"
              className={`tabular ${INPUT_CLASS} w-20 shrink-0 px-3`}
            />
            <input
              value={quickName}
              onChange={(event) => setQuickName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void addQuickPlayer();
              }}
              placeholder="Prénom Nom"
              aria-label="Nom du joueur"
              className={`${INPUT_CLASS} flex-1 px-3`}
            />
          </div>
          <button
            type="button"
            onClick={() => void addQuickPlayer()}
            disabled={quickName.trim() === ""}
            className="min-h-tap-min rounded-xl border border-edge-strong bg-overlay text-sm font-medium disabled:opacity-40"
          >
            Ajouter au roster
          </button>
          <p className="text-xs text-muted">
            Un seul mot suffit : « Dupont » fonctionne aussi.
          </p>
        </div>
      </section>

      {error !== null && (
        <p role="alert" className="text-sm text-foul">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={saving}
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
 * noir sur fond sombre, invisible. LeCompositeur du thème fixait bien `body`, ce
 * qui laissait croire que l'héritage couvrait le cas.
 */
const INPUT_CLASS =
  "min-h-tap-min rounded-xl border border-edge bg-raised text-base text-primary outline-none placeholder:text-muted focus:border-accent";

const LOCAL_TEAM = "local";

/**
 * Tri du roster affiché : numéros croissants, sans numéro à la fin.
 *
 * Même règle que `comparePlayers` côté repositories, mais simplifiée pour un
 * tableau déjà trié au moment du chargement : seul le joueur ajouté peut être
 * mal placé.
 */
function compareByNumber(a: PlayerRow, b: PlayerRow): number {
  if (a.number !== null && b.number === null) return -1;
  if (a.number === null && b.number !== null) return 1;
  if (a.number !== null && b.number !== null) return a.number - b.number;
  return 0;
}
