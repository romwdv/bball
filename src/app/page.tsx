"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { repos } from "@/data";
import type { MatchRow } from "@/data/schema";
import { LOCAL_TEAM_ID } from "@/data/repositories";
import { MatchStatus } from "@/domain/types";
import { formatDate } from "@/features/match/formatDate";
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
}

export default function HomePage() {
  const router = useRouter();

  const load = useCallback(async (): Promise<HomeData> => {
    const store = repos();
    const existed = await store.teams.get(LOCAL_TEAM_ID);
    const team = await store.teams.ensureLocal();
    return {
      unfinished: await store.matches.listUnfinished(team.id),
      recreated: existed === undefined,
    };
  }, []);

  const { data, loading } = useAsyncData<HomeData>(load, [load]);
  const unfinished = data?.unfinished ?? [];
  const resume = unfinished[0];

  return (
    <main className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 pt-(--padding-safe-t) pb-(--padding-safe-b)">
      <header className="pt-4">
        <h1 className="text-2xl font-semibold">Matchs</h1>
        <p className="mt-1 text-sm text-secondary">
          Saisie hors-ligne, synchronisée plus tard.
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
            <li key={match.id}>
              <Link
                href={`/match/?m=${match.id}`}
                className="surface-card flex min-h-tap-min items-center justify-between px-4 py-3"
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
    </main>
  );
}
