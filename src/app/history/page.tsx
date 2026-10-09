"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useState } from "react";
import { repos } from "@/data";
import type { Action } from "@/domain/types";
import { MatchSheet } from "@/features/match/MatchSheet";
import { MatchCard } from "@/features/match/MatchCard";
import { useHistoryData } from "@/features/history/useHistoryData";
import { SyncIndicator } from "@/features/sync/SyncIndicator";
import { AppHeader } from "@/ui/AppHeader";
import { BackIcon } from "@/ui/icons";
import { useAsyncData } from "@/ui/useAsyncData";

/**
 * Historique des matchs (PLAN.md §12).
 *
 * Deux vues sur la même page : la liste, et le détail d'un match. Le détail passe
 * par un **query param** (`?m=<uuid>`) et non un segment de chemin, parce que
 * `output: 'export'` interdit les routes dynamiques.
 *
 * La liste reprend la maquette : retour, titre, compteur, puis les sections
 * « Match en cours » / « Matchs terminés » en cartes pilule.
 */

export default function HistoryPage() {
  return (
    <Suspense
      fallback={
        <p className="flex flex-1 items-center justify-center text-secondary">
          Chargement…
        </p>
      }
    >
      <HistoryScreen />
    </Suspense>
  );
}

function HistoryScreen() {
  const params = useSearchParams();
  const selectedId = params.get("m");

  return selectedId === null ? (
    <MatchList />
  ) : (
    <MatchDetail matchId={selectedId} />
  );
}

// ---------------------------------------------------------------------------

function MatchList() {
  const [revision, setRevision] = useState(0);
  const onDeleted = useCallback(() => {
    setRevision((current) => current + 1);
  }, []);

  const { matches, finished, inProgress, actionCounts, loading } =
    useHistoryData(revision);

  return (
    <main className="flex flex-1 flex-col overflow-y-auto pt-(--padding-safe-t) pb-(--padding-safe-b)">
      <AppHeader />

      <div className="flex items-center justify-between px-4 py-1">
        <div className="flex items-center gap-1">
          <Link
            href="/"
            aria-label="Retour à l'accueil"
            className="grid min-h-tap-min min-w-tap-min place-items-center rounded-[10px] text-accent"
          >
            <BackIcon className="h-6 w-6" />
          </Link>
          <h1 className="font-display text-[19px] text-primary">Historique</h1>
        </div>
        <span className="tabular font-label text-[13px] font-semibold text-muted">
          {matches.length} match{matches.length > 1 ? "s" : ""}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-4 px-4 pt-2">
        {/* Voyant de synchronisation : la suppression se fait d'ici, et elle est
            différée sur le réseau. Affiché même sur un historique vide : le cas
            « dernier match supprimé, suppression encore en file » fait disparaître
            la liste, et c'est précisément l'instant où le voyant compte. */}
        {!loading && <SyncIndicator variant="banner" />}

        {loading && <p className="text-sm text-muted">Chargement…</p>}

        {!loading && matches.length === 0 && (
          <p className="mt-8 text-center text-sm text-muted">
            Aucun match enregistré. Les matchs apparaîtront ici dès la première
            saisie.
          </p>
        )}

        {inProgress.length > 0 && (
          <section aria-label="Matchs en cours">
            <h2 className="mb-2 text-sm text-primary">Match en cours</h2>
            <ul className="flex flex-col gap-3">
              {inProgress.map((match) => (
                <MatchCard
                  key={match.id}
                  match={match}
                  href={`/history/?m=${match.id}`}
                  actionCount={actionCounts.get(match.id) ?? 0}
                  onDeleted={onDeleted}
                />
              ))}
            </ul>
          </section>
        )}

        {finished.length > 0 && (
          <section aria-label="Matchs terminés">
            <h2 className="mb-2 text-sm text-primary">Matchs terminés</h2>
            <ul className="flex flex-col gap-3">
              {finished.map((match) => (
                <MatchCard
                  key={match.id}
                  match={match}
                  href={`/history/?m=${match.id}`}
                  actionCount={actionCounts.get(match.id) ?? 0}
                  onDeleted={onDeleted}
                />
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------

function MatchDetail({ matchId }: { matchId: string }) {
  const router = useRouter();

  const read = useCallback(async () => {
    const store = repos();
    const match = await store.matches.get(matchId);
    if (match === undefined) return null;
    const [players, actions] = await Promise.all([
      store.matches.rosterOf(matchId),
      store.actions.listByMatch(matchId, { includeVoided: false }),
    ]);
    return { match, players, actions: actions as Action[] };
  }, [matchId]);

  const { data, loading } = useAsyncData(read, [read]);

  if (loading) {
    return (
      <main className="flex flex-1 items-center justify-center text-secondary">
        Chargement…
      </main>
    );
  }

  if (data === null) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-secondary">Match introuvable.</p>
        <button
          type="button"
          onClick={() => router.push("/history/")}
          className="min-h-tap-min rounded-[10px] bg-accent px-6 py-3 font-display text-lg text-inverse"
        >
          Retour à l&rsquo;historique
        </button>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col overflow-y-auto pt-(--padding-safe-t) pb-(--padding-safe-b)">
      <AppHeader />

      <div className="flex items-center justify-between px-4 py-1">
        <div className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            onClick={() => router.push("/history/")}
            aria-label="Retour à l'historique"
            className="grid min-h-tap-min min-w-tap-min shrink-0 place-items-center rounded-[10px] text-accent"
          >
            <BackIcon className="h-6 w-6" />
          </button>
          <h1 className="truncate font-display text-[19px] text-primary">
            stats match
          </h1>
        </div>
        <span className="shrink-0 truncate font-label text-[13px] font-semibold text-muted">
          vs {data.match.opponentName}
        </span>
      </div>

      <div className="flex-1 px-4 pt-2">
        <MatchSheet
          match={data.match}
          players={data.players}
          actions={data.actions}
        />
      </div>
    </main>
  );
}
