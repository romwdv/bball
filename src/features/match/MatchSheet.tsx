"use client";

import { useMemo } from "react";
import type { Action, Match, Player } from "@/domain/types";
import { QUARTERS, FOUL_LIMIT } from "@/domain/types";
import {
  aggregateFor,
  formatSplit,
  formatPercentage,
  percentage,
  teamTotals,
  pointsByQuarter,
  playerLabel,
} from "@/domain/stats";
import { CSV_MIME, JSON_MIME, downloadText } from "@/ui/download";
import { matchFilename, matchToCsv, matchToJson } from "@/domain/export";

/**
 * Feuille de match : le résultat, lisible.
 *
 * Réutilisable par la phase 5 pour le détail d'un match historique — c'est pour
 * ça qu'elle prend les données en props et ne les charge pas elle-même. Un
 * composant qui lit la base n'est pas réutilisable.
 *
 * Trois informations, dans l'ordre où le coach en a besoin après le coup de
 * sifflet final : le score par période (qui a pris l'avance quand), puis le
 * pourcentage de réussite de l'équipe (le seul chiffre qu'on commente), puis la
 * ligne par joueur. Les pourcentages sont en tête parce qu'ils sont la
 * conversation du vestiaire ; la ligne par joueur en dessous, pour le détail.
 */

export interface MatchSheetProps {
  match: Match;
  players: readonly Player[];
  actions: readonly Action[];
}

export function MatchSheet({ match, players, actions }: MatchSheetProps) {
  const quarters = useMemo(() => pointsByQuarter(actions, QUARTERS), [actions]);
  const total = quarters.reduce((sum, entry) => sum + entry.points, 0);

  const rows = useMemo(
    () =>
      players.map((player) => ({
        player,
        stats: aggregateFor(actions, player.id),
      })),
    [players, actions],
  );

  return (
    <section aria-label="Feuille de match" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">vs {match.opponentName}</h2>
        <p className="tabular text-sm text-secondary">
          {match.date} · {match.status === "finished" ? "Terminé" : "En cours"}
        </p>
      </div>

      <ScoreByQuarter quarters={quarters} total={total} />
      <TeamShooting actions={actions} />
      <PlayerRows rows={rows} />
      <ExportButtons match={match} players={players} actions={actions} />
    </section>
  );
}

interface ScoreByQuarterProps {
  quarters: readonly { quarter: number; points: number }[];
  total: number;
}

/** Score par période, avec une case vide rendue à 0 : une période à 0 est une information. */
function ScoreByQuarter({ quarters, total }: ScoreByQuarterProps) {
  return (
    // Étiqueté pour le lecteur d'écran : « le score de la période Q2 » se
    // lit sans compter les cases.
    <div
      aria-label="Score par période"
      className="surface-card flex items-center gap-1 p-3"
    >
      <div className="tabular flex flex-1 flex-col items-center gap-1">
        <span className="text-3xl font-bold">{total}</span>
        <span className="text-xs text-muted">Total</span>
      </div>
      {quarters.map(({ quarter, points }) => (
        <div
          key={quarter}
          className="tabular flex flex-1 flex-col items-center gap-1"
        >
          <span
            className={`text-lg font-semibold ${points === 0 ? "text-muted" : ""}`}
          >
            {points}
          </span>
          <span className="text-xs text-muted">Q{quarter}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Pourcentages de l'équipe, la conversation du vestiaire.
 *
 * `teamTotals` et pas `aggregateFor(actions, "team")` : cette dernière filtre par
 * `playerId`, donc une équipe fictive valait tout à zéro — un bug qui ne se voit
 * qu'au premier panier marqué.
 */
function TeamShooting({ actions }: { actions: readonly Action[] }) {
  const team = useMemo(() => teamTotals(actions), [actions]);

  // Le pourcentage global pondère 2 pts et 3 pts dans le même ratio : c'est la
  // convention du basket (FG%), et non la moyenne des deux colonnes.
  const fg = percentage(team.fgm2 + team.fgm3, team.fga2 + team.fga3);
  const two = percentage(team.fgm2, team.fga2);
  const three = percentage(team.fgm3, team.fga3);
  const ft = percentage(team.ftm, team.fta);

  return (
    <div
      aria-label="Pourcentages de l'équipe"
      className="surface-card grid grid-cols-4 gap-2 p-3 text-center"
    >
      <Stat label="Tirs" value={formatPercentage(fg)} />
      <Stat label="2 pts" value={formatPercentage(two)} />
      <Stat label="3 pts" value={formatPercentage(three)} />
      <Stat label="LF" value={formatPercentage(ft)} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="tabular text-lg font-semibold">{value}</span>
      <span className="text-xs text-muted">{label}</span>
    </div>
  );
}

interface PlayerRowsProps {
  rows: readonly { player: Player; stats: ReturnType<typeof aggregateFor> }[];
}

/** Une ligne par joueur, dans l'ordre du roster. */
function PlayerRows({ rows }: PlayerRowsProps) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted">Aucun joueur dans ce match.</p>;
  }

  return (
    <div className="surface-card overflow-x-auto">
      <table className="tabular w-full min-w-max text-left text-sm">
        <thead>
          <tr className="border-b border-edge text-xs text-muted">
            <th className="px-3 py-2 font-medium">Joueur</th>
            <th className="px-2 py-2 font-medium">Pts</th>
            <th className="px-2 py-2 font-medium">2P</th>
            <th className="px-2 py-2 font-medium">3P</th>
            <th className="px-2 py-2 font-medium">LF</th>
            <th className="px-2 py-2 font-medium">F</th>
            <th className="px-2 py-2 font-medium">R</th>
            <th className="px-2 py-2 font-medium">P</th>
            <th className="px-2 py-2 font-medium">PD</th>
            <th className="px-2 py-2 font-medium">CT</th>
            <th className="px-2 py-2 font-medium">IC</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ player, stats }) => (
            <tr key={player.id} className="border-b border-edge last:border-0">
              <td className="px-3 py-2 font-medium">
                <span className="tabular text-muted">
                  {player.number ?? "—"}
                </span>{" "}
                {playerLabel(player)}
              </td>
              <td className="px-2 py-2 font-semibold">{stats.points}</td>
              <td className="px-2 py-2">
                {formatSplit(stats.fgm2, stats.fga2, "") ?? "—"}
              </td>
              <td className="px-2 py-2">
                {formatSplit(stats.fgm3, stats.fga3, "") ?? "—"}
              </td>
              <td className="px-2 py-2">
                {formatSplit(stats.ftm, stats.fta, "") ?? "—"}
              </td>
              <td
                className={`px-2 py-2 ${stats.fouls >= FOUL_LIMIT ? "text-foul" : ""}`}
              >
                {stats.fouls}
              </td>
              <td className="px-2 py-2">
                {stats.reboundsOffensive + stats.reboundsDefensive}
              </td>
              <td className="px-2 py-2">{stats.assists}</td>
              <td className="px-2 py-2">{stats.turnovers}</td>
              <td className="px-2 py-2">{stats.steals}</td>
              <td className="px-2 py-2">{stats.blocks}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface ExportButtonsProps {
  match: Match;
  players: readonly Player[];
  actions: readonly Action[];
}

function ExportButtons({ match, players, actions }: ExportButtonsProps) {
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
        className="min-h-tap-min rounded-xl border border-edge-strong bg-raised font-medium"
      >
        Exporter CSV
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
        className="min-h-tap-min rounded-xl border border-edge-strong bg-raised font-medium"
      >
        Exporter JSON
      </button>
    </div>
  );
}
