"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { CombosBar } from "@/features/match/CombosBar";
import { FreeThrowSheet } from "@/features/match/FreeThrowSheet";
import { MatchHeader } from "@/features/match/MatchHeader";
import { ActionGrid, AdvancedStatsBar } from "@/features/match/ActionGrid";
import { PlayerCarousel, useMatchData } from "@/features/match/PlayerCarousel";
import { useMatchStore } from "@/features/match/store";
import { Flash } from "@/ui/Flash";
import { Toast } from "@/ui/Toast";
import { useWakeLock } from "@/ui/useWakeLock";

/**
 * Écran de saisie — « PORTE DE VALIDATION » (PLAN.md §3).
 *
 * La disposition en trois zones du plan §4 est reprise à l'identique :
 * header compact, carrousel joueurs, grille d'actions en **thumb zone**. Les
 * actions sont en bas parce que c'est la seule zone atteignable à une main sans
 * changer sa prise du téléphone.
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
  const lockPlayer = useMatchStore((state) => state.lockPlayer);
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

  const { match, players, statsByPlayer, loading } = useMatchData(matchId);

  // L'écran ne doit jamais s'éteindre en plein match : le déverrouillage à une
  // main au milieu d'un quart temps est le pire des ratés d'ergonomie.
  useWakeLock(matchId !== null);

  // Le store doit connaître le match courant pour que `record()` puisse écrire.
  // C'est fait dans un effet, et non pendant le rendu : écrire un store pendant
  // le rendu est un effet de bord, interdit par React et source de boucle de
  // rendu sous `StrictMode`.
  useEffect(() => {
    if (matchId !== null) {
      openMatch(matchId, null);
    }
    return () => {
      closeMatch();
    };
  }, [matchId, openMatch, closeMatch]);

  // Premier joueur verrouillé automatiquement. Un coach qui ouvre l'app et voit
  // une grille morte ne déverrouille rien : il faut que le premier joueur soit
  // déjà actif pour que le premier appui enregistre quelque chose.
  //
  // L'effet est déclaré **avant** les retours anticipés, sinon l'ordre des hooks
  // changerait selon l'état de chargement et React lèverait.
  useEffect(() => {
    if (loading) return;
    if (playerId !== null || players.length === 0) return;
    lockPlayer(players[0]!.id);
  }, [loading, playerId, players, lockPlayer]);

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

  const noPlayer = playerId === null;

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <MatchHeader match={match} statsByPlayer={statsByPlayer} />

      <PlayerCarousel
        players={players}
        statsByPlayer={statsByPlayer}
        onSelect={lockPlayer}
      />

      <div className="flex flex-1 flex-col justify-end gap-2 pb-3">
        <CombosBar playerId={playerId} disabled={noPlayer} onRecord={record} />

        <ActionGrid
          playerId={playerId ?? ""}
          playerFouls={
            playerId === null ? 0 : (statsByPlayer.get(playerId)?.fouls ?? 0)
          }
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
            className="min-h-tap-min flex-1 rounded-xl border border-edge-strong bg-raised font-medium disabled:opacity-40"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() => {
              closeMatch();
              router.push("/");
            }}
            className="min-h-tap-min rounded-xl border border-edge px-4 text-secondary"
          >
            Sortir
          </button>
        </div>
      </div>

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
          ne sait pas si son appui long est passé et il recommence, ou il passe
          au joueur suivant en croyant le tir compté. Le mot « raté » en gras et
          une couleur d'alerte le distinguent d'un panier.
        - `notice` propose « Réfaire » après une annulation : c'est un
          correctif que le coach choisit, pas un acquittement qu'il subit.
      */}
      <Flash message={flash} onDismiss={dismissFlash} />
      <Toast message={notice} onDismiss={dismissNotice} />
    </main>
  );
}
