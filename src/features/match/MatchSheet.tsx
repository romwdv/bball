"use client";

import { useMemo, useState } from "react";
import type { Action, Match, Player, Quarter } from "@/domain/types";
import { QUARTERS } from "@/domain/types";
import { aggregateFor, formatPercentage, percentage } from "@/domain/stats";
import { CSV_MIME, JSON_MIME, downloadText } from "@/ui/download";
import { matchFilename, matchToCsv, matchToJson } from "@/domain/export";
import { StatCards, type StatCardData } from "@/ui/StatCard";

/**
 * Feuille de match (PLAN.md §12).
 *
 * La maquette « stats match » remplace le tableau par une **grille de cartes**
 * : une sélection de période (Tout / Q1–Q4) et les statistiques du joueur en
 * cartes, suivies des boutons d'export.
 *
 * Réutilisable par l'écran de saisie terminé et par le détail de l'historique —
 * c'est pour ça qu'elle prend les données en props et ne les charge pas elle-même.
 *
 * Les valeurs sont celles du **premier joueur du roster** : l'application ne
 * suit qu'un seul joueur (PLAN.md §11).
 */

export interface MatchSheetProps {
  match: Match;
  players: readonly Player[];
  /** Toutes les actions du match, **annulées exclues**. */
  actions: readonly Action[];
  /**
   * Période à consulter, ou `undefined` pour le match entier.
   *
   * Le score reste calculé sur le match complet quand « Tout » est sélectionné ;
   * en sélectionnant une période, tous les compteurs portent sur elle.
   */
  quarter?: Quarter;
}

export function MatchSheet({
  match,
  players,
  actions,
  quarter,
}: MatchSheetProps) {
  const [period, setPeriod] = useState<Quarter | undefined>(quarter);

  const scope = useMemo(
    () =>
      period === undefined
        ? actions
        : actions.filter((action) => action.quarter === period),
    [actions, period],
  );

  const player = players[0];
  const stats =
    player === undefined ? undefined : aggregateFor(scope, player.id);

  const rows = stats === undefined ? [] : buildRows(stats);

  return (
    <section aria-label="Feuille de match" className="flex flex-col gap-4">
      <PeriodFilter value={period} onChange={setPeriod} />

      {stats === undefined ? (
        <p className="text-sm text-muted">Aucun joueur dans ce match.</p>
      ) : (
        <StatCards rows={rows} />
      )}

      <ExportButtons match={match} players={players} actions={actions} />
    </section>
  );
}

// ---------------------------------------------------------------------------

/**
 * Lignes de cartes, dans l'ordre exact de la maquette « stats match »
 * (PLAN.md §12) : Points/% Tirs, %2PTS/%3PTS/%LF, PD/INT/BP/CTR, RB/RD/RO.
 */
function buildRows(
  stats: ReturnType<typeof aggregateFor>,
): readonly (readonly StatCardData[])[] {
  const fg = percentage(stats.fgm2 + stats.fgm3, stats.fga2 + stats.fga3);
  const two = percentage(stats.fgm2, stats.fga2);
  const three = percentage(stats.fgm3, stats.fga3);
  const ft = percentage(stats.ftm, stats.fta);

  return [
    [
      { label: "Points", value: String(stats.points) },
      { label: "% Tirs", value: formatPercentage(fg) },
    ],
    [
      { label: "% 2PTS", value: formatPercentage(two) },
      { label: "% 3PTS", value: formatPercentage(three) },
      { label: "% LF", value: formatPercentage(ft) },
    ],
    [
      { label: "PD", value: String(stats.assists) },
      { label: "INT", value: String(stats.steals) },
      { label: "BP", value: String(stats.turnovers) },
      { label: "CTR", value: String(stats.blocks) },
    ],
    [
      {
        label: "RB",
        value: String(stats.reboundsOffensive + stats.reboundsDefensive),
      },
      { label: "RD", value: String(stats.reboundsDefensive) },
      { label: "RO", value: String(stats.reboundsOffensive) },
    ],
  ];
}

/**
 * Sélecteur de période de la feuille.
 *
 * Un bouton par période plus « Tout ». Le sélecteur de l'écran de saisie n'a pas
 * sa place ici : c'est un autre écran, et un sélecteur qui change la période de
 * saisie depuis un match terminé n'aurait aucun sens.
 */
function PeriodFilter({
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
      className="flex items-center gap-1.5"
    >
      <button
        type="button"
        role="tab"
        aria-selected={value === undefined}
        onClick={() => onChange(undefined)}
        className={`min-h-tap-min flex-1 rounded-[10px] font-display text-[19px] font-normal ${
          value === undefined
            ? "bg-accent text-inverse"
            : "bg-white text-primary"
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
          onClick={() => onChange(quarter as Quarter)}
          className={`tabular min-h-tap-min flex-1 rounded-[10px] font-brand text-[19px] ${
            value === quarter
              ? "bg-accent text-inverse"
              : "bg-white text-primary"
          }`}
        >
          Q{quarter}
        </button>
      ))}
    </div>
  );
}

function ExportButtons({
  match,
  players,
  actions,
}: {
  match: Match;
  players: readonly Player[];
  actions: readonly Action[];
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <button
        type="button"
        onClick={() =>
          downloadText({
            filename: matchFilename(match, "csv"),
            content: matchToCsv({ match, players, actions }),
            mime: CSV_MIME,
          })
        }
        className="min-h-tap-min rounded-[10px] bg-accent text-sm text-inverse"
      >
        Exporter en CSV
      </button>
      <button
        type="button"
        onClick={() =>
          downloadText({
            filename: matchFilename(match, "json"),
            content: matchToJson({ match, players, actions }),
            mime: JSON_MIME,
          })
        }
        className="min-h-tap-min rounded-[10px] bg-accent text-sm text-inverse"
      >
        Exporter en JSON
      </button>
    </div>
  );
}
