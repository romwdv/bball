"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { repos } from "@/data";
import type { MatchRow } from "@/data/schema";
import { MatchStatus } from "@/domain/types";
import { formatDate } from "@/features/match/formatDate";
import { useAuthStore } from "@/features/auth/store";
import { DeleteMatchButton } from "@/features/match/DeleteMatchButton";
import { InstallPrompt } from "@/features/pwa/InstallPrompt";
import { useAsyncData } from "@/ui/useAsyncData";

/**
 * Écran d'accueil : les matchs en cours, et le bouton pour en créer un.
 *
 * L'ordre de priorité est délibéré. En arrivant sur l'app en bord de terrain, la
 * seule question qui compte est « quel match je reprends ? ». La liste est donc
 * limitée aux matchs non terminés, avec le plus récent en tête. L'historique
 * complet est l'écran `/history`, qui n'existera qu'en phase 5.
 */

const STATUS_LABEL: Record<MatchStatus, string> = {
  draft: "Brouillon",
  live: "En cours",
  finished: "Terminé",
};

interface HomeData {
  unfinished: MatchRow[];
  /** L'équipe locale a dû être (re)créée pendant ce chargement. */
  recreated: boolean;
  /** Actions actives par match, pour la confirmation de suppression. */
  actionCounts: ReadonlyMap<string, number>;
}

export default function HomePage() {
  const router = useRouter();
  const signOut = useAuthStore((state) => state.signOut);
  const busy = useAuthStore((state) => state.busy);
  const email = useAuthStore((state) => state.session?.email ?? null);

  const load = useCallback(async (): Promise<HomeData> => {
    const store = repos();
    // L'équipe n'est plus identifiée par une constante : après la première
    // connexion, `claimTeam()` lui a donné un `uuid` (la constante `"local"`
    // n'est pas un identifiant acceptable par le cloud, et elle serait la même
    // sur tous les appareils). « Existe-t-elle ? » se demande donc au store.
    const existing = await store.teams.list();
    const team = await store.teams.ensureLocal();
    const unfinished = await store.matches.listUnfinished(team.id);

    // Comptage des actions, pour que la confirmation de suppression dise « 40
    // actions seront perdues » plutôt qu'un nom d'adversaire — seul le premier
    // permet de vérifier qu'on choisit le bon match.
    const actions =
      unfinished.length === 0
        ? []
        : await store.actions.listByMatches(
            unfinished.map((match) => match.id),
            { includeVoided: false },
          );
    const actionCounts = new Map<string, number>();
    for (const action of actions) {
      actionCounts.set(
        action.matchId,
        (actionCounts.get(action.matchId) ?? 0) + 1,
      );
    }

    return {
      unfinished,
      actionCounts,
      recreated: existing.length === 0,
    };
  }, []);

  // Forcé après une suppression, pour la même raison que dans l'historique :
  // sans relecture, le match effacé resterait dans la liste.
  const [revision, setRevision] = useState(0);
  const onDeleted = useCallback(() => {
    setRevision((current) => current + 1);
  }, []);

  const { data, loading } = useAsyncData<HomeData>(load, [load, revision]);
  const unfinished = data?.unfinished ?? [];
  const resume = unfinished[0];

  return (
    <main className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 pt-(--padding-safe-t) pb-(--padding-safe-b)">
      <header className="pt-4">
        <h1 className="text-2xl font-semibold">Matchs</h1>
        <p className="mt-1 text-sm text-secondary">
          Saisie hors-ligne, synchronisée dès que le réseau revient.
        </p>
      </header>

      {data?.recreated === true && (
        <p className="rounded-xl border border-warning/40 bg-warning-subtle px-4 py-3 text-sm text-warning">
          Équipe locale absente — elle a été recréée.
        </p>
      )}

      {resume !== undefined && (
        <Link
          href={`/match/?m=${resume.id}`}
          className="surface-card flex min-h-tap-action flex-col justify-center gap-1 px-4 py-4"
        >
          <span className="text-xs font-medium uppercase tracking-wide text-accent">
            Reprendre · {STATUS_LABEL[resume.status]}
          </span>
          <span className="text-lg font-semibold">
            vs {resume.opponentName}
          </span>
          <span className="tabular text-sm text-secondary">
            {formatDate(resume.date)}
          </span>
        </Link>
      )}

      <button
        type="button"
        onClick={() => router.push("/new-match/")}
        className="min-h-tap-action w-full rounded-xl bg-accent text-lg font-semibold text-inverse"
      >
        Nouveau match
      </button>

      <section aria-label="Matchs non terminés" className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-secondary">
          {loading
            ? "Chargement…"
            : unfinished.length === 0
              ? "Aucun match en cours"
              : "Tous les matchs ouverts"}
        </h2>

        <ul className="flex flex-col gap-2">
          {unfinished.map((match) => (
            <li key={match.id} className="flex items-center gap-2">
              <Link
                href={`/match/?m=${match.id}`}
                className="surface-card flex min-h-tap-min flex-1 items-center justify-between px-4 py-3"
              >
                <span className="flex flex-col">
                  <span className="font-medium">vs {match.opponentName}</span>
                  <span className="tabular text-xs text-muted">
                    {formatDate(match.date)}
                  </span>
                </span>
                <span className="rounded-full border border-edge px-2 py-0.5 text-xs text-secondary">
                  {STATUS_LABEL[match.status]}
                </span>
              </Link>
              {/* Sur un match en cours, le bouton est indispensable : c'est
                  celui qu'on crée par erreur, et il faut pouvoir l'effacer sans
                  le clôturer d'abord. */}
              <DeleteMatchButton
                match={match}
                actionCount={data?.actionCounts.get(match.id) ?? 0}
                onDeleted={onDeleted}
              />
            </li>
          ))}
        </ul>
      </section>

      <nav className="mt-auto grid grid-cols-2 gap-2 pb-2">
        <Link
          href="/history/"
          className="min-h-tap-min rounded-xl border border-edge px-4 py-3 text-center text-sm text-secondary"
        >
          Historique
        </Link>
        <Link
          href="/stats/"
          className="min-h-tap-min rounded-xl border border-edge px-4 py-3 text-center text-sm text-secondary"
        >
          Stats cumulées
        </Link>
      </nav>

      {/*
        Invite à installer, juste au-dessus de la navigation : c'est le dernier
        endroit de l'écran où elle ne masque aucun contenu, et le premier que le
        coach voit sans avoir à faire défiler. L'écran d'accueil est aussi le seul
        moment pertinent — pendant un match, personne n'installe une application.
      */}
      <InstallPrompt />

      {/*
        Déconnexion, volontairement discrète et tout en bas de l'écran.

        L'écran d'accueil est le seul endroit qui soit à la fois accessible au
        repos et sans risque : se déconnecter au milieu d'un match laisserait une
        saisie non synchronisée, donc la sortie de session n'a pas sa place dans
        le header de saisie.
      */}
      <footer className="flex items-center justify-between gap-3 pb-2">
        <span className="truncate text-xs text-muted">{email}</span>
        <button
          type="button"
          onClick={() => {
            void signOut();
          }}
          disabled={busy}
          className="min-h-tap-min shrink-0 rounded-lg border border-edge px-3 text-xs text-secondary disabled:opacity-50"
        >
          Déconnexion
        </button>
      </footer>
    </main>
  );
}
