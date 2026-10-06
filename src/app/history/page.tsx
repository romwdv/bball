"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useState } from "react";
import { repos } from "@/data";
import type { Action } from "@/domain/types";
import { QUARTERS, type MatchStatus, type Quarter } from "@/domain/types";
import { MatchSheet } from "@/features/match/MatchSheet";
import { formatDate } from "@/features/match/formatDate";
import { useHistoryData } from "@/features/history/useHistoryData";
import { useAsyncData } from "@/ui/useAsyncData";

/**
 * Historique des matchs.
 *
 * Deux vues sur la même page : la liste, et le détail d'un match. Le détail passe
 * par un **query param** (`?m=<uuid>`) et non un segment de chemin, parce que
 * `output: 'export'` interdit les routes dynamiques — la même contrainte que
 * pour `/match`. Deux URLs statiques valent mieux qu'une règle de réécriture
 * côté Nginx.
 */

const STATUS_LABEL: Record<MatchStatus, string> = {
  draft: "Brouillon",
  live: "En cours",
  finished: "Terminé",
};

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
  const { matches, inProgress, loading } = useHistoryData();

  return (
    <main className="flex flex-1 flex-col overflow-y-auto px-4 pt-(--padding-safe-t) pb-(--padding-safe-b)">
      <header className="flex items-center gap-2 py-4">
        <Link
          href="/"
          aria-label="Retour à l’accueil"
          className="min-h-tap-min rounded-lg border border-edge px-3 text-sm text-secondary"
        >
          ‹
        </Link>
        <h1 className="text-xl font-semibold">Historique</h1>
        <span className="tabular ml-auto text-sm text-muted">
          {matches.length} match{matches.length > 1 ? "s" : ""}
        </span>
      </header>

      {loading && <p className="text-sm text-muted">Chargement…</p>}

      {!loading && matches.length === 0 && (
        <p className="mt-8 text-center text-sm text-muted">
          Aucun match enregistré. Les matchs apparaîtront ici dès la première
          saisie.
        </p>
      )}

      {inProgress.length > 0 && (
        <section aria-label="Matchs en cours" className="mb-4">
          <h2 className="mb-2 text-sm font-medium text-warning">En cours</h2>
          <ul className="flex flex-col gap-2">
            {inProgress.map((match) => (
              <li key={match.id}>
                <MatchRow match={match} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {matches.length > inProgress.length && (
        <section aria-label="Matchs terminés">
          <h2 className="mb-2 text-sm font-medium text-secondary">Terminés</h2>
          <ul className="flex flex-col gap-2">
            {matches
              .filter((match) => match.status === "finished")
              .map((match) => (
                <li key={match.id}>
                  <MatchRow match={match} />
                </li>
              ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function MatchRow({ match }: { match: import("@/data/schema").MatchRow }) {
  return (
    <Link
      href={`/history/?m=${match.id}`}
      className="surface-card flex min-h-tap-min items-center justify-between gap-3 px-4 py-3"
    >
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium">vs {match.opponentName}</span>
        <span className="tabular text-xs text-muted">
          {formatDate(match.date)}
        </span>
      </span>
      <span
        className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${
          match.status === "finished"
            ? "border-edge text-muted"
            : "border-warning/50 text-warning"
        }`}
      >
        {STATUS_LABEL[match.status]}
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------------------

function MatchDetail({ matchId }: { matchId: string }) {
  const router = useRouter();
  const [quarter, setQuarter] = useState<Quarter | undefined>(undefined);

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

  const title = data === null ? "" : data.match.opponentName;

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
          className="min-h-tap-min rounded-xl bg-accent px-6 py-3 font-semibold text-inverse"
        >
          Retour à l&rsquo;historique
        </button>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col overflow-y-auto px-4 pt-(--padding-safe-t) pb-(--padding-safe-b)">
      <header className="flex items-center gap-2 py-4">
        <button
          type="button"
          onClick={() => router.push("/history/")}
          aria-label="Retour à l&rsquo;historique"
          className="min-h-tap-min rounded-lg border border-edge px-3 text-sm text-secondary"
        >
          ‹
        </button>
        <h1 className="truncate text-lg font-semibold">vs {title}</h1>
      </header>

      <QuarterPicker value={quarter} onChange={setQuarter} />

      <MatchSheet
        match={data.match}
        players={data.players}
        actions={data.actions}
        quarter={quarter}
      />
    </main>
  );
}

/**
 * Sélecteur de période.
 *
 * Un bouton par période plus « Tout ». Le sélecteur du header de saisie n'a pas
 * sa place ici : c'est un autre écran, et un sélecteur qui change la période de
 * saisie depuis un match terminé n'aurait aucun sens.
 */
function QuarterPicker({
  value,
  onChange,
}: {
  value: Quarter | undefined;
  onChange: (next: Quarter | undefined) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Période consultée"
      className="mb-3 flex overflow-hidden rounded-xl border border-edge"
    >
      <button
        type="button"
        role="tab"
        aria-selected={value === undefined}
        onClick={() => onChange(undefined)}
        className={`min-h-tap-action flex-1 text-sm font-semibold ${
          value === undefined
            ? "bg-accent text-inverse"
            : "bg-raised text-secondary"
        }`}
      >
        Tout
      </button>
      {QUARTERS.map((quarter) => (
        <button
          key={quarter}
          type="button"
          role="tab"
          aria-selected={value === quarter}
          onClick={() => onChange(quarter)}
          className={`tabular min-h-tap-action flex-1 text-sm font-semibold ${
            value === quarter
              ? "bg-accent text-inverse"
              : "bg-raised text-secondary"
          }`}
        >
          Q{quarter}
        </button>
      ))}
    </div>
  );
}
