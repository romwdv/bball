"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { cumulativeToCsv } from "@/domain/export";
import {
  formatPercentage,
  formatSplit,
  percentage,
  playerLabel,
  type CumulativeStats,
} from "@/domain/stats";
import { CSV_MIME, downloadText } from "@/ui/download";
import { Flash } from "@/ui/Flash";
import {
  COLUMNS,
  sortAndFilter,
  type SortKey,
} from "@/features/stats/useCumulativeData";
import { useCumulativeData } from "@/features/stats/useCumulativeData";
import { useToastStore } from "@/features/stats/useToastStore";

/**
 * Stats cumulées de tous les matchs.
 *
 * Un tableau, pas des cartes : treize colonnes et une ligne par joueur, c'est la
 * forme qui se compare d'un coup d'œil et qui se trie. Les cartes ne
 * permettraient pas de répondre à « qui a le meilleur pourcentage » sans les
 * faire défiler toutes.
 *
 * Le tri par colonne est l'interaction principale : le coach cherche un leader,
 * pas une liste alphabetically.
 */

export default function StatsPage() {
  const { stats, roster, matchCount, loading } = useCumulativeData();
  const [sortKey, setSortKey] = useState<SortKey>("points");
  const [descending, setDescending] = useState(true);
  const [query, setQuery] = useState("");
  const [averages, setAverages] = useState(false);
  const flash = useToastStore();

  const { rows } = useMemo(
    () => sortAndFilter(stats, roster, sortKey, descending, query),
    [stats, roster, sortKey, descending, query],
  );

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setDescending(!descending);
      return;
    }
    // Un nouveau tri démarre toujours par le haut : on cherche le maximum.
    setSortKey(key);
    setDescending(key !== "name");
  }

  function exportCsv() {
    downloadText({
      filename: `stats-cumulees-${matchCount}-matchs.csv`,
      content: cumulativeToCsv({ players: roster, stats, matchCount }),
      mime: CSV_MIME,
    });
    flash.show(`Export de ${stats.length} joueurs`);
  }

  return (
    <main className="flex flex-1 flex-col overflow-y-auto px-4 pt-(--padding-safe-t) pb-(--padding-safe-b)">
      <header className="flex items-center gap-2 py-4">
        <Link
          href="/"
          aria-label="Retour à l'accueil"
          className="min-h-tap-min min-w-tap-min rounded-lg border border-edge px-3 text-sm text-secondary"
        >
          ‹
        </Link>
        <h1 className="text-xl font-semibold">Stats cumulées</h1>
        <span className="tabular ml-auto text-sm text-muted">
          {matchCount} match{matchCount > 1 ? "s" : ""}
        </span>
      </header>

      <div className="mb-3 flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filtrer un joueur"
            aria-label="Filtrer un joueur"
            className="min-h-tap-min flex-1 rounded-xl border border-edge bg-raised px-4 text-base text-primary outline-none placeholder:text-muted focus:border-accent"
          />
          <button
            type="button"
            onClick={exportCsv}
            disabled={stats.length === 0}
            className="min-h-tap-min rounded-xl border border-edge-strong bg-raised px-4 text-sm font-medium disabled:opacity-40"
          >
            CSV
          </button>
        </div>

        <div className="flex overflow-hidden rounded-xl border border-edge">
          <ModeButton
            active={!averages}
            onClick={() => setAverages(false)}
            label="Totaux"
          />
          <ModeButton
            active={averages}
            onClick={() => setAverages(true)}
            label="Par match"
          />
        </div>
      </div>

      {loading && <p className="text-sm text-muted">Chargement…</p>}

      {!loading && rows.length === 0 && (
        <p className="mt-6 text-center text-sm text-muted">
          {stats.length === 0
            ? "Aucun match terminé : les statistiques apparaîtront après la première clôture."
            : "Aucun joueur ne correspond à ce filtre."}
        </p>
      )}

      {rows.length > 0 && (
        <StatsTable
          rows={rows}
          sortKey={sortKey}
          descending={descending}
          averages={averages}
          onSort={toggleSort}
        />
      )}

      <p className="mt-3 text-xs text-muted">
        {averages
          ? "Moyennes par match joué, et non par match de l'équipe."
          : "Totaux sur l'ensemble des matchs. Les actions annulées sont exclues."}
      </p>

      {/* Réutilise la bannière de la saisie plutôt qu'un second composant de
          toast : même durée, même style, un seul comportement à maintenir. */}
      <Flash
        message={
          flash.text === null
            ? null
            : { id: flash.id, text: flash.text, missed: false }
        }
        onDismiss={flash.clear}
      />
    </main>
  );
}

function ModeButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-tap-min flex-1 text-sm font-semibold ${
        active ? "bg-accent text-inverse" : "bg-raised text-secondary"
      }`}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------

interface StatsTableProps {
  rows: readonly {
    entry: CumulativeStats;
    player: import("@/data/schema").PlayerRow | undefined;
  }[];
  sortKey: SortKey;
  descending: boolean;
  averages: boolean;
  onSort: (key: SortKey) => void;
}

function StatsTable({
  rows,
  sortKey,
  descending,
  averages,
  onSort,
}: StatsTableProps) {
  return (
    <div className="surface-card overflow-x-auto">
      <table className="tabular w-full min-w-max text-left text-sm">
        <thead>
          <tr className="border-b border-edge">
            {COLUMNS.map((column) => (
              // `aria-sort` est sur le `th` et non sur le bouton : c'est la
              // colonne entière qui est triée, et la règle d'accessibilité
              // l'interdit sur un `button`.
              <th
                key={column.key}
                scope="col"
                aria-sort={
                  sortKey === column.key
                    ? descending
                      ? "descending"
                      : "ascending"
                    : "none"
                }
                className="p-0 font-medium"
              >
                <button
                  type="button"
                  onClick={() => onSort(column.key)}
                  title={column.title}
                  aria-label={`${column.title}, ${sortKey === column.key && descending ? "décroissant" : "croissant"}`}
                  className={`min-h-tap-min w-full px-2 py-2 text-xs ${
                    sortKey === column.key ? "text-accent" : "text-muted"
                  }`}
                >
                  {column.label}
                  {sortKey === column.key && (descending ? " ▾" : " ▴")}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ entry, player }) => (
            <tr
              key={entry.playerId}
              className="border-b border-edge last:border-0"
            >
              <th
                scope="row"
                className="max-w-32 truncate px-2 py-2 font-medium"
              >
                {player === undefined ? "—" : playerLabel(player)}
              </th>
              <td className="px-2 py-2">{entry.matchesPlayed}</td>
              <td className="px-2 py-2 font-semibold">
                {number(averages ? entry.averages.points : entry.totals.points)}
              </td>
              <td className="px-2 py-2">
                {split(entry.totals.fgm2, entry.totals.fga2)}
              </td>
              <td className="px-2 py-2">
                {split(entry.totals.fgm3, entry.totals.fga3)}
              </td>
              <td className="px-2 py-2">
                {split(entry.totals.ftm, entry.totals.fta)}
              </td>
              <td className="px-2 py-2">
                {formatPercentage(
                  percentage(
                    entry.totals.fgm2 + entry.totals.fgm3,
                    entry.totals.fga2 + entry.totals.fga3,
                  ),
                )}
              </td>
              <td className="px-2 py-2">{entry.totals.fouls}</td>
              <td className="px-2 py-2">
                {entry.totals.reboundsOffensive +
                  entry.totals.reboundsDefensive}
              </td>
              <td className="px-2 py-2">{entry.totals.assists}</td>
              <td className="px-2 py-2">{entry.totals.turnovers}</td>
              <td className="px-2 py-2">{entry.totals.steals}</td>
              <td className="px-2 py-2">{entry.totals.blocks}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function split(made: number, attempted: number): string {
  return formatSplit(made, attempted, "") ?? "—";
}

/** Une décimale pour une moyenne, un entier pour un total. */
function number(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
