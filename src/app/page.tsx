"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { repos } from "@/data";
import type { MatchRow } from "@/data/schema";
import { AppHeader } from "@/ui/AppHeader";
import { ChartIcon, HistoryIcon, PlusIcon } from "@/ui/icons";
import { MatchCard } from "@/features/match/MatchCard";
import { useAuthStore } from "@/features/auth/store";
import { InstallPrompt } from "@/features/pwa/InstallPrompt";
import { SyncIndicator } from "@/features/sync/SyncIndicator";
import { useAsyncData } from "@/ui/useAsyncData";

/**
 * Écran d'accueil (PLAN.md §12) : les matchs en cours, le bouton pour en créer
 * un, et la navigation vers l'historique et les stats cumulées.
 *
 * Reprend la maquette : header de marque, titre « Matchs » avec le voyant de
 * synchronisation, cartes pilule des matchs ouverts, bouton orange « Ajouter un
 * match », et deux cartes de navigation en bas. L'ordre de priorité est délibéré
 * — en arrivant en bord de terrain, la seule question est « quel match je
 * reprends ? », donc la liste des matchs non terminés vient en premier.
 */

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
    const existing = await store.teams.list();
    const team = await store.teams.ensureLocal();
    const unfinished = await store.matches.listUnfinished(team.id);

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

  const [revision, setRevision] = useState(0);
  const onDeleted = useCallback(() => {
    setRevision((current) => current + 1);
  }, []);

  const { data, loading } = useAsyncData<HomeData>(load, [load, revision]);
  const unfinished = data?.unfinished ?? [];

  return (
    <main className="flex flex-1 flex-col overflow-y-auto pt-(--padding-safe-t) pb-(--padding-safe-b)">
      <AppHeader />

      <div className="flex flex-1 flex-col gap-5 px-4 pt-4">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-[19px] font-normal text-primary">
            Matchs
          </h1>
          <SyncIndicator variant="chip" />
        </div>

        {data?.recreated === true && (
          <p className="rounded-[10px] bg-warning-subtle px-4 py-3 text-sm text-warning">
            Équipe locale absente — elle a été recréée.
          </p>
        )}

        {loading && <p className="text-sm text-muted">Chargement…</p>}

        {!loading && unfinished.length === 0 && (
          <p className="mt-4 text-center text-sm text-muted">
            Aucun match en cours. Créez-en un pour commencer la saisie.
          </p>
        )}

        <ul className="flex flex-col gap-3">
          {unfinished.map((match) => (
            <MatchCard
              key={match.id}
              match={match}
              href={`/match/?m=${match.id}`}
              actionCount={data?.actionCounts.get(match.id) ?? 0}
              onDeleted={onDeleted}
            />
          ))}
        </ul>

        <button
          type="button"
          onClick={() => router.push("/new-match/")}
          className="flex min-h-tap-action items-center justify-center gap-2 rounded-[10px] bg-accent font-display text-[19px] font-semibold text-inverse"
        >
          <PlusIcon className="h-6 w-6 text-inverse" />
          Ajouter un match
        </button>

        <nav className="mt-auto grid grid-cols-2 gap-3 pb-2">
          <Link
            href="/history/"
            className="flex min-h-tap-action items-center gap-3 rounded-[10px] bg-white px-4 py-3"
          >
            <HistoryIcon className="h-7 w-7 shrink-0 text-accent" />
            <span className="font-display text-[19px] font-light text-primary">
              Historique
            </span>
          </Link>
          <Link
            href="/stats/"
            className="flex min-h-tap-action items-center gap-3 rounded-[10px] bg-white px-4 py-3"
          >
            <ChartIcon className="h-7 w-7 shrink-0 text-accent" />
            <span className="font-display text-[19px] font-light text-primary">
              Cumul stats
            </span>
          </Link>
        </nav>
      </div>

      <InstallPrompt />

      <footer className="flex items-center justify-between gap-3 px-4 py-3">
        <span className="truncate text-xs text-muted">{email}</span>
        <button
          type="button"
          onClick={() => {
            void signOut();
          }}
          disabled={busy}
          className="min-h-tap-min shrink-0 rounded-[10px] bg-white px-3 text-xs text-secondary disabled:opacity-50"
        >
          Déconnexion
        </button>
      </footer>
    </main>
  );
}
