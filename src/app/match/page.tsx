"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import type { Action } from "@/domain/types";
import { CombosBar } from "@/features/match/CombosBar";
import { FreeThrowSheet } from "@/features/match/FreeThrowSheet";
import { MatchHeader } from "@/features/match/MatchHeader";
import { FinishSheet } from "@/features/match/FinishSheet";
import { MatchSheet } from "@/features/match/MatchSheet";
import { ActionGrid, AdvancedStatsBar } from "@/features/match/ActionGrid";
import { ActivePlayer, useMatchData } from "@/features/match/ActivePlayer";
import { PeriodSelector } from "@/features/match/PeriodSelector";
import { useMatchStore } from "@/features/match/store";
import { AppHeader } from "@/ui/AppHeader";
import { UndoIcon } from "@/ui/icons";
import { repos } from "@/data";
import { Flash } from "@/ui/Flash";
import { Toast } from "@/ui/Toast";
import { useWakeLock } from "@/ui/useWakeLock";

/**
 * Écran de saisie — « PORTE DE VALIDATION » (PLAN.md §3).
 *
 * La disposition en trois zones du plan §4 est reprise à l'identique :
 * header compact, bandeau du joueur, grille d'actions en **thumb zone**. Les
 * actions sont en bas parce que c'est la seule zone atteignable à une main sans
 * changer sa prise du téléphone.
 *
 * La zone du milieu a rétréci : elle portait le carrousel de joueurs, il ne reste
 * qu'un bandeau de lecture (PLAN.md §11). La grille n'a pas bougé pour autant —
 * elle occupe la thumb zone, et c'est elle qui décide de l'ergonomie.
 *
 * `output: 'export'` interdit les routes dynamiques : le match est identifié
 * par un query param `?m=<uuid>`, pas par un segment de chemin. C'est la
 * conséquence directe d'un choix d'hébergement, appliquée ici sans exception.
 */

export default function MatchPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <MatchScreen />
    </Suspense>
  );
}

function LoadingScreen() {
  return (
    <main className="flex flex-1 items-center justify-center text-secondary">
      Chargement du match…
    </main>
  );
}

function MatchScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const matchId = params.get("m");

  const openMatch = useMatchStore((state) => state.openMatch);
  const closeMatch = useMatchStore((state) => state.closeMatch);
  const record = useMatchStore((state) => state.record);
  const undoLast = useMatchStore((state) => state.undoLast);
  const dismissNotice = useMatchStore((state) => state.dismissNotice);

  const playerId = useMatchStore((state) => state.playerId);
  const quarter = useMatchStore((state) => state.quarter);
  const sheet = useMatchStore((state) => state.sheet);
  const sheetGroupId = useMatchStore((state) => state.sheetGroupId);
  const notice = useMatchStore((state) => state.notice);
  const flash = useMatchStore((state) => state.flash);
  const dismissFlash = useMatchStore((state) => state.dismissFlash);
  const refresh = useMatchStore((state) => state.refresh);

  /**
   * Feuille de confirmation de clôture, ou feuille de match en lecture.
   *
   * `finished` est dérivé du match rechargé : après `setStatus`, `refresh()`
   * provoque la relecture et l'écran bascule tout seul en mode lecture. Un état
   * local dupliquerait la source de vérité.
   */
  const [confirming, setConfirming] = useState(false);

  const { match, player, stats, fouls, totalPoints, loading } =
    useMatchData(matchId);

  /**
   * `id` du joueur, et non l'objet.
   *
   * `useMatchData` relit la base à chaque écriture et renvoie donc un **nouvel**
   * objet `player` à chaque fois. Dépendre de l'objet ferait repasser cet effet à
   * chaque panier — et son nettoyage appelle `closeMatch()`, suivi d'un
   * `openMatch()` qui **remet la période à 1**. Le coach verrait le score du
   * header changer de quart temps après chaque tir. L'`id` est stable, donc
   * l'effet ne tourne que pour un vrai changement de joueur.
   */
  const matchPlayerId = player?.id ?? null;

  /**
   * Actions actives du match.
   *
   * Rechargées quand le match change — donc après la clôture, quand `refresh()`
   * a provoqué la relecture. Elles servent deux consommateurs : la fiche de
   * confirmation (lancers dûs, fautes) et la feuille de lecture. Un seul
   * chargement, sinon la fiche et la feuille verraient des données différentes.
   */
  /**
   * Le match est-il terminé ?
   *
   * Dérivé de `match`, jamais stocké : après `setStatus`, `refresh()` provoque
   * la relecture et l'écran bascule tout seul en mode lecture. Un état local
   * dupliquerait la source de vérité.
   */
  const finished = match?.status === "finished";
  const [matchActions, setMatchActions] = useState<Action[]>([]);
  useEffect(() => {
    if (matchId === null) return;
    void repos()
      .actions.listByMatch(matchId, { includeVoided: false })
      .then(setMatchActions);
  }, [matchId, match]);

  // L'écran ne doit jamais s'éteindre en plein match : le déverrouillage à une
  // main au milieu d'un quart temps est le pire des ratés d'ergonomie.
  useWakeLock(matchId !== null);

  /**
   * Le store doit connaître le match et son joueur pour que `record()` puisse
   * écrire sans relire la base.
   *
   * C'est fait dans un effet, et non pendant le rendu : écrire un store pendant
   * le rendu est un effet de bord, interdit par React et source de boucle de
   * rendu sous `StrictMode`.
   *
   * Le joueur arrive **après** le match, lu par `useMatchData`. Le store n'est
   * donc ouvert qu'une fois les deux connus, ce qui est correct : tant que le
   * joueur manque, la grille n'est pas saisissable.
   */
  useEffect(() => {
    if (matchId === null || matchPlayerId === null) return;
    openMatch(matchId, matchPlayerId);
    return () => {
      closeMatch();
    };
  }, [matchId, matchPlayerId, openMatch, closeMatch]);

  if (matchId === null) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-secondary">Aucun match sélectionné.</p>
        <button
          type="button"
          onClick={() => router.push("/")}
          className="min-h-tap-min rounded-xl bg-accent px-6 py-3 font-semibold text-inverse"
        >
          Retour à la liste
        </button>
      </main>
    );
  }

  if (loading) return <LoadingScreen />;

  if (match === null) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-secondary">Match introuvable.</p>
        <button
          type="button"
          onClick={() => router.push("/")}
          className="min-h-tap-min rounded-xl bg-accent px-6 py-3 font-semibold text-inverse"
        >
          Retour à la liste
        </button>
      </main>
    );
  }

  /**
   * Le joueur est-il prêt à recevoir la saisie ?
   *
   * Il finit par l'être toujours : `ensureSon()` le crée au premier lancement.
   * Le cas « pas encore » est donc **transitoire**, pas un état d'erreur — l'écran
   * affiche « Chargement… » et la grille reste désactivée le temps de la lecture.
   * Ce qui est impossible, en revanche, c'est un match sans joueur : la création
   * en garantit un (`/new-match` passe `playerIds: [son.id]`).
   */
  const noPlayer = playerId === null;

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <AppHeader />
      <MatchHeader match={match} />

      <div className="flex flex-col gap-3 px-4 pt-1 pb-2">
        <PeriodSelector />
        <ActivePlayer
          player={player}
          score={totalPoints}
          stats={stats}
          fouls={fouls}
        />
      </div>

      {finished ? (
        <div className="flex-1 overflow-y-auto px-4 py-4 pb-(--padding-safe-b)">
          {/* Sans cette sortie, le coach est piégé sur la feuille : la barre
            de saisie a disparu, et il ne reste que le bouton retour du
            navigateur — invisible sur une PWA installée. */}
          <header className="mb-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                closeMatch();
                router.push("/");
              }}
              aria-label="Retour à l'accueil"
              className="min-h-tap-min rounded-[10px] bg-white px-3 font-display text-sm text-secondary"
            >
              ‹ Accueil
            </button>
          </header>
          <MatchSheet
            match={match}
            players={player === null ? [] : [player]}
            actions={matchActions}
          />
        </div>
      ) : (
        <div className="flex flex-1 flex-col justify-end gap-2 pb-(--padding-safe-b)">
          <CombosBar
            playerId={playerId}
            disabled={noPlayer}
            onRecord={record}
          />

          <ActionGrid
            playerId={playerId ?? ""}
            // Fautes du match entier : la limite à cinq est par rencontre.
            // Avec le compte de la période, un joueur sorti en Q1 pourrait en
            // prendre cinq de plus en Q2.
            playerFouls={fouls}
            disabled={noPlayer}
            onRecord={async (drafts, kind) => {
              await record(drafts, kind);
            }}
          />

          <AdvancedStatsBar
            playerId={playerId ?? ""}
            disabled={noPlayer}
            onRecord={async (drafts, kind) => {
              await record(drafts, kind);
            }}
          />

          <div className="flex gap-2 px-4">
            <button
              type="button"
              onClick={() => {
                void undoLast({ text: "Dernière action annulée" });
              }}
              disabled={noPlayer}
              aria-label="Annuler la dernière action"
              className="grid min-h-tap-action w-14 shrink-0 place-items-center rounded-[10px] bg-accent disabled:opacity-40"
            >
              <UndoIcon className="h-6 w-6 text-inverse" />
            </button>
            <button
              type="button"
              onClick={() => {
                closeMatch();
                router.push("/");
              }}
              className="min-h-tap-action flex-1 rounded-[10px] bg-white font-display text-[19px] font-light text-primary"
            >
              Sortir
            </button>
          </div>

          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="mx-4 min-h-tap-action rounded-[10px] bg-accent font-display text-2xl font-light text-inverse"
          >
            Terminer
          </button>
        </div>
      )}

      {confirming && !finished && player !== null && (
        <FinishSheet
          match={match}
          players={[player]}
          actions={matchActions}
          onCancel={() => setConfirming(false)}
          onFinished={() => {
            setConfirming(false);
            refresh();
          }}
        />
      )}

      {sheet === "free-throws" &&
        playerId !== null &&
        sheetGroupId !== null && (
          <FreeThrowSheet
            playerId={playerId}
            quarter={quarter}
            parentGroupId={sheetGroupId}
          />
        )}

      {/*
        Deux bannières distinctes, et la distinction est délibérée.

        - `flash` acquitte **chaque** saisie : 1,1 s, sans bouton. Un tir raté
          ne change ni le score ni aucune pastille ; sans acquittement, le coach
          ne sait pas si son appui long est passé et il recommence. Le mot
          « raté » en gras et une couleur d'alerte le distinguent d'un panier.
        - `notice` propose « Réfaire » après une annulation : c'est un
          correctif que le coach choisit, pas un acquittement qu'il subit.
      */}
      <Flash message={flash} onDismiss={dismissFlash} />
      <Toast message={notice} onDismiss={dismissNotice} />
    </main>
  );
}
