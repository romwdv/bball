"use client";

import Link from "next/link";
import { useState } from "react";
import { cumulativeToCsv } from "@/domain/export";
import { formatPercentage, percentage } from "@/domain/stats";
import type { CumulativeStats } from "@/domain/stats";
import { CSV_MIME, downloadText } from "@/ui/download";
import { Flash } from "@/ui/Flash";
import { useCumulativeData } from "@/features/stats/useCumulativeData";
import { useToastStore } from "@/features/stats/useToastStore";
import { AppHeader } from "@/ui/AppHeader";
import { BackIcon } from "@/ui/icons";
import { StatCards, type StatCardData } from "@/ui/StatCard";

/**
 * Stats cumulées de tous les matchs (PLAN.md §12).
 *
 * La maquette remplace le tableau triable par une **grille de cartes** : le
 * joueur est unique (PLAN.md §11), donc trier et filtrer des lignes n'a plus de
 * sens — on lit les valeurs. La bascule « Totaux / Par match » reste.
 */

export default function StatsPage() {
  const { stats, roster, matchCount, loading } = useCumulativeData();
  const [averages, setAverages] = useState(false);
  const flash = useToastStore();

  const entry = stats[0];
  const rows = entry === undefined ? [] : buildRows(entry, averages);

  function exportCsv() {
    downloadText({
      filename: `stats-cumulees-${matchCount}-matchs.csv`,
      content: cumulativeToCsv({ players: roster, stats, matchCount }),
      mime: CSV_MIME,
    });
    flash.show(
      `Export de ${stats.length} joueur${stats.length > 1 ? "s" : ""}`,
    );
  }

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
          <h1 className="font-display text-[19px] text-primary">
            stats cumulées
          </h1>
        </div>
        <span className="tabular font-label text-[13px] font-semibold text-muted">
          {matchCount} match{matchCount > 1 ? "s" : ""}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-4 px-4 pt-2">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={exportCsv}
            disabled={stats.length === 0}
            className="min-h-tap-min rounded-[10px] bg-accent px-3 text-sm text-inverse disabled:opacity-40"
          >
            CSV
          </button>
          <div className="flex overflow-hidden rounded-[10px]">
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

        {!loading && stats.length === 0 && (
          <p className="mt-6 text-center text-sm text-muted">
            Aucun match terminé : les statistiques apparaîtront après la
            première clôture.
          </p>
        )}

        {!loading && rows.length > 0 && <StatCards rows={rows} />}

        <p className="text-xs text-muted">
          {averages
            ? "Moyennes par match joué, et non par match de l'équipe."
            : "Totaux sur l'ensemble des matchs. Les actions annulées sont exclues."}
        </p>
      </div>

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
      className={`min-h-tap-min w-28 font-display text-[19px] ${
        active ? "bg-accent text-inverse" : "bg-white text-primary"
      }`}
    >
      {label}
    </button>
  );
}

/** Une décimale pour une moyenne, un entier pour un total. */
function number(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * Lignes de cartes, dans l'ordre de la maquette (PLAN.md §12) :
 * Matchs/Points/% Tirs, %2PTS/%3PTS/%LF, PD/INT/BP/CTR, RB/RD/RO.
 */
function buildRows(
  entry: CumulativeStats,
  averages: boolean,
): readonly (readonly StatCardData[])[] {
  const totals = entry.totals;
  const played = entry.matchesPlayed;
  const per = (value: number) => (averages ? value / played : value);

  const fg = percentage(totals.fgm2 + totals.fgm3, totals.fga2 + totals.fga3);
  const two = percentage(totals.fgm2, totals.fga2);
  const three = percentage(totals.fgm3, totals.fga3);
  const ft = percentage(totals.ftm, totals.fta);

  return [
    [
      { label: "Matchs", value: String(played) },
      { label: "Points", value: number(per(totals.points)) },
      { label: "% Tirs", value: formatPercentage(fg) },
    ],
    [
      { label: "% 2PTS", value: formatPercentage(two) },
      { label: "% 3PTS", value: formatPercentage(three) },
      { label: "% LF", value: formatPercentage(ft) },
    ],
    [
      { label: "PD", value: number(per(totals.assists)) },
      { label: "INT", value: number(per(totals.steals)) },
      { label: "BP", value: number(per(totals.turnovers)) },
      { label: "CTR", value: number(per(totals.blocks)) },
    ],
    [
      {
        label: "RB",
        value: number(per(totals.reboundsOffensive + totals.reboundsDefensive)),
      },
      { label: "RD", value: number(per(totals.reboundsDefensive)) },
      { label: "RO", value: number(per(totals.reboundsOffensive)) },
    ],
  ];
}
