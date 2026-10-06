"use client";

import { enqueue, outboxKey } from "@/data/outbox";
import { dataDb } from "@/data";
import { newId } from "@/data/ids";
import { LOCAL_TEAM_ID } from "@/data/repositories";
import type { MatchRow, PlayerRow, TeamRow } from "@/data/schema";

/**
 * Rattachement des données locales au compte — phase 6b.
 *
 * Le cas d'usage est celui du coach qui a utilisé l'app avant de créer un compte :
 * il a saisi des matchs, des joueurs, des actions. À la première connexion, ces
 * données sont locales, `teamId = "local"`, et le cloud ne les verra jamais
 * telles quelles. `claimTeam()` les rattache à l'équipe du compte.
 *
 * ## Pourquoi l'`id` d'équipe change
 *
 * `LOCAL_TEAM_ID` vaut `"local"` — ce n'est pas un `uuid`, et la colonne `teams.id`
 * en est un. Surtout, la constante est la **même sur tous les appareils** : si elle
 * partait telle quelle dans le cloud, le premier compte inscrit verrait ses lignes
 * rejetées par la clé primaire dès que quelqu'un d'autre s'inscrirait, et les RLS
 * mélangeraient deux comptes sur les mêmes joueurs.
 *
 * D'où le réécriture : au premier login, l'équipe locale reçoit un `uuid` neuf,
 * et `players.teamId` / `matches.teamId` suivent dans la **même** transaction.
 *
 * ## Pourquoi cette opération est atomique
 *
 * Une réécriture interrompue laisserait des joueurs et des matchs pointant vers
 * une équipe qui n'existe plus, donc des matchs orphelins : invisibles dans
 * l'historique, jamais synchronisés, irrécupérables. La transaction Dexie couvre
 * `teams`, `players`, `matches` **et** `outbox` ; chaque ligne déplacée est
 * remise en file avec son nouveau `teamId`, sinon le cloud recevrait des lignes
 * dont la clé étrangère ne résout pas.
 *
 * ## Idempotence
 *
 * Appeler la fonction dix fois doit laisser dix fois la même base. Les lignes
 * déjà rattachées (`ownerId === userId` et `id` déjà un uuid) sont laissées
 * intactes, sans même réécrire `updatedAt` : un `updatedAt` sans raison ferait
 * remonter l'équipe en tête du tirage descendant, et l'indicateur de
 * synchronisation clignoterait pour rien.
 */

export type ClaimResult =
  | {
      status: "claimed";
      team: TeamRow;
      /** `true` si des données locales ont réellement été rattachées. */
      attached: boolean;
      /** Joueurs et matchs dont le `teamId` a été réécrit. */
      moved: number;
    }
  /**
   * L'appareil contient déjà les données d'un **autre** compte.
   *
   * Aucun code n'est exécuté dans ce cas. Faire passer la main sur l'équipe
   * existante serait une fuite de données dans les deux sens : le nouveau compte
   * verrait les matchs de l'ancien, et l'ancien perdrait l'accès à ses propres
   * données par les politiques RLS. Refuser est la seule option qui ne casse rien.
   */
  | { status: "conflict"; ownerId: string };

/**
 * Rattache l'équipe locale au compte et renvoie l'équipe utilisable.
 *
 * @param userId `auth.uid()` du compte connecté.
 */
export async function claimTeam(userId: string): Promise<ClaimResult> {
  const database = dataDb();
  const existing = await database.teams.toCollection().first();

  if (
    existing !== undefined &&
    existing.ownerId !== null &&
    existing.ownerId !== userId
  ) {
    return { status: "conflict", ownerId: existing.ownerId };
  }

  const now = Date.now();

  if (
    existing !== undefined &&
    existing.ownerId === userId &&
    existing.id !== LOCAL_TEAM_ID
  ) {
    return { status: "claimed", team: existing, attached: false, moved: 0 };
  }

  // Idempotence côté contenu : deux onglets qui appellent claimTeam() en même
  // temps obtiennent la même ligne qu'après relecture, et le second appel
  // renvoie `attached: false` sans rien réécrire.
  const current = existing ?? {
    id: LOCAL_TEAM_ID,
    name: "Mon équipe",
    ownerId: null,
    updatedAt: now,
  };

  const teamId = current.id === LOCAL_TEAM_ID ? newId() : current.id;
  const team: TeamRow = {
    ...current,
    id: teamId,
    ownerId: userId,
    updatedAt: now,
  };

  let moved = 0;

  await database.transaction(
    "rw",
    [database.teams, database.players, database.matches, database.outbox],
    async () => {
      // Relecture sous transaction : le second appel concurrent voit le travail
      // du premier et n'écrit rien.
      const raced = await database.teams.toCollection().first();
      if (
        raced !== undefined &&
        raced.ownerId === userId &&
        raced.id !== LOCAL_TEAM_ID
      ) {
        team.id = raced.id;
        team.updatedAt = raced.updatedAt;
        return;
      }

      if (current.id !== teamId) {
        await database.teams.delete(current.id);
      }
      await database.teams.put(team);
      if (current.id !== teamId) {
        // L'entrée d'outbox de l'ancienne équipe est **supprimée**, pas
        // remplacée. La laisser en file enverrait une ligne `teams` d'`id`
        // `"local"` à chaque cycle, et Postgres refuserait l'`uuid` — l'entrée
        // échouerait donc pour toujours, en bloquant toutes les autres du même
        // lot (l'échec de poussée est global).
        await database.outbox.delete(outboxKey("teams", current.id));
      }
      await enqueue(database, {
        entity: "teams",
        entityId: team.id,
        payload: { ...team },
        now,
      });

      const players = await database.players
        .where("teamId")
        .equals(current.id)
        .toArray();
      for (const player of players) {
        const next: PlayerRow = {
          ...player,
          teamId: teamId,
          updatedAt: now,
        };
        await database.players.put(next);
        await enqueue(database, {
          entity: "players",
          entityId: next.id,
          payload: { ...next },
          now,
        });
      }
      moved += players.length;

      const matches = await database.matches
        .where("teamId")
        .equals(current.id)
        .toArray();
      for (const match of matches) {
        const next: MatchRow = { ...match, teamId: teamId, updatedAt: now };
        await database.matches.put(next);
        await enqueue(database, {
          entity: "matches",
          entityId: next.id,
          payload: { ...next },
          now,
        });
      }
      moved += matches.length;
    },
  );

  return { status: "claimed", team, attached: true, moved };
}
