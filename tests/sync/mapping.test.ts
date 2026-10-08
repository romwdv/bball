import { describe, expect, it } from "vitest";
import {
  fromCloudRow,
  PUSH_ORDER,
  remoteUpdatedAt,
  toCloudRow,
} from "@/sync/mapping";
import { newId } from "@/data/ids";
import type { ActionRow, MatchRow, PlayerRow, TeamRow } from "@/data/schema";

/**
 * Tests du mapping `camelCase` ↔ `snake_case`.
 *
 * C'est le seul endroit du projet où une faute de frappe corrompt des données
 * **sans bruit** : une colonne mal nommée est soit refusée par Postgres — visible
 * tout de suite — soit acceptée et jamais relue. Ces tests vérifient donc le
 * contrat dans les deux sens, et surtout les cas que le JSON crée : `bigint` en
 * chaîne, colonnes absentes en `null`, champs optionnels du domaine (`value`,
 * `made`, `side`, `groupId`) qui doivent disparaître et non valoir `0`/`false`.
 */

const TEAM: TeamRow = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "BC Rouge",
  ownerId: "22222222-2222-4222-8222-222222222222",
  updatedAt: 1_000,
};

const PLAYER: PlayerRow = {
  id: "33333333-3333-4333-8333-333333333333",
  teamId: TEAM.id,
  firstName: "Karim",
  lastName: "Bernard",
  number: 4,
  updatedAt: 2_000,
};

const MATCH: MatchRow = {
  id: "44444444-4444-4444-8444-444444444444",
  teamId: TEAM.id,
  opponentName: "BC Nuit",
  date: "2026-10-06",
  playerIds: [PLAYER.id],
  status: "live",
  createdAt: 3_000,
  finishedAt: null,
  updatedAt: 4_000,
};

const SHOT: ActionRow = {
  id: "55555555-5555-4555-8555-555555555555",
  matchId: MATCH.id,
  playerId: PLAYER.id,
  seq: 0,
  quarter: 1,
  kind: "shot",
  value: 2,
  made: true,
  voidedAt: null,
  updatedAt: 5_000,
};

const REBOUND: ActionRow = {
  id: "66666666-6666-4666-8666-666666666666",
  matchId: MATCH.id,
  playerId: PLAYER.id,
  seq: 1,
  quarter: 1,
  kind: "rebound",
  side: "offensive",
  voidedAt: null,
  updatedAt: 5_100,
};

describe("aller : ligne locale → colonne cloud", () => {
  it("convertit chaque entité", () => {
    expect(toCloudRow("teams", TEAM)).toEqual({
      id: TEAM.id,
      name: "BC Rouge",
      owner_id: TEAM.ownerId,
      updated_at: 1_000,
    });

    expect(toCloudRow("players", PLAYER)).toEqual({
      id: PLAYER.id,
      team_id: PLAYER.teamId,
      first_name: "Karim",
      last_name: "Bernard",
      number: 4,
      updated_at: 2_000,
    });

    expect(toCloudRow("matches", MATCH)).toEqual({
      id: MATCH.id,
      team_id: MATCH.teamId,
      opponent_name: "BC Nuit",
      date: "2026-10-06",
      player_ids: [PLAYER.id],
      status: "live",
      created_at: 3_000,
      finished_at: null,
      updated_at: 4_000,
    });

    expect(toCloudRow("actions", SHOT)).toMatchObject({
      id: SHOT.id,
      match_id: MATCH.id,
      player_id: PLAYER.id,
      seq: 0,
      quarter: 1,
      kind: "shot",
      value: 2,
      made: true,
      group_id: null,
      voided_at: null,
      updated_at: 5_000,
    });
  });

  it("écrit null et non undefined pour les champs optionnels absents", () => {
    const row = toCloudRow("actions", REBOUND);

    // `undefined` ne serait pas sérialisé par `JSON.stringify`, donc la colonne
    // garderait sa valeur précédente : une correction ne se propagerait jamais.
    expect(row.value).toBeNull();
    expect(row.made).toBeNull();
    expect(row.fouled).toBeNull();
    expect(JSON.parse(JSON.stringify(row))).toHaveProperty("value", null);
  });

  it("présente le side du rebond", () => {
    expect(toCloudRow("actions", REBOUND).side).toBe("offensive");
  });

  it("porte l'annulation en voided_at", () => {
    const voided = toCloudRow("actions", {
      ...SHOT,
      voidedAt: 9_999,
      updatedAt: 9_999,
    });
    expect(voided.voided_at).toBe(9_999);
  });

  it("accepte un joueur sans numéro", () => {
    expect(
      toCloudRow("players", { ...PLAYER, number: null }).number,
    ).toBeNull();
  });
});

describe("retour : colonne cloud → ligne locale", () => {
  it("reconstruit chaque entité", () => {
    expect(fromCloudRow("teams", toCloudRow("teams", TEAM))).toEqual(TEAM);
    expect(fromCloudRow("players", toCloudRow("players", PLAYER))).toEqual(
      PLAYER,
    );
    expect(fromCloudRow("matches", toCloudRow("matches", MATCH))).toEqual(
      MATCH,
    );
    expect(fromCloudRow("actions", toCloudRow("actions", SHOT))).toEqual(SHOT);
    expect(fromCloudRow("actions", toCloudRow("actions", REBOUND))).toEqual(
      REBOUND,
    );
  });

  it("accepte les bigint en chaîne, comme PostgREST les renvoie", () => {
    const row = fromCloudRow("players", {
      ...toCloudRow("players", PLAYER),
      updated_at: "2000",
    });
    expect(row.updatedAt).toBe(2_000);
  });

  it("refuse un updated_at manquant plutôt que de fabriquer un 0", () => {
    // Un `0` silencieux ferait resurfacer au tirage descendant des lignes
    // d'ancienneté arbitraire — le symptôme serait un re-téléchargement de toute
    // la base, sans aucun message d'erreur.
    expect(() =>
      fromCloudRow("players", {
        id: PLAYER.id,
        team_id: PLAYER.teamId,
        first_name: "Karim",
        last_name: "Bernard",
        number: null,
        updated_at: null,
      }),
    ).toThrow(/absente du tirage/);
  });

  it("refuse un updated_at illisible", () => {
    expect(() =>
      fromCloudRow("teams", {
        ...toCloudRow("teams", TEAM),
        updated_at: "n/a",
      }),
    ).toThrow(/illisible/);
  });

  it("rejette une ligne invalide par le schéma du domaine", () => {
    // Un joueur sans prénom **ni** nom n'a pas d'identité : c'est le critère
    // que le schéma conserve depuis PLAN.md §11 (l'un ou l'autre suffit).
    expect(() =>
      fromCloudRow("players", {
        ...toCloudRow("players", PLAYER),
        first_name: "",
        last_name: "",
      }),
    ).toThrow();

    expect(() =>
      fromCloudRow("matches", {
        ...toCloudRow("matches", MATCH),
        date: "06/10/2026",
      }),
    ).toThrow();
  });

  it("tolère les colonnes optionnelles absentes d'un select", () => {
    const row = fromCloudRow("actions", {
      id: SHOT.id,
      match_id: MATCH.id,
      player_id: PLAYER.id,
      seq: 0,
      quarter: 1,
      kind: "shot",
      value: 3,
      made: false,
      fouled: null,
      side: null,
      group_id: null,
      voided_at: null,
      updated_at: 5_000,
    });

    expect(row.side).toBeUndefined();
    expect(row.groupId).toBeUndefined();
    expect(row.fouled).toBeUndefined();
    expect(row.made).toBe(false);
    expect(row.value).toBe(3);
  });

  it("traite un roster vide ou absent comme un roster vide", () => {
    const row = fromCloudRow("matches", {
      ...toCloudRow("matches", MATCH),
      player_ids: null,
    });
    expect(row.playerIds).toEqual([]);
  });

  it("lit l'horodatage du curseur", () => {
    expect(remoteUpdatedAt({ updated_at: "1234" })).toBe(1_234);
  });
});

describe("ordre de dépendance", () => {
  it("envoie l'équipe, puis les joueurs, puis les matchs, puis les actions", () => {
    // Une action dont le match n'existe pas encore serait refusée par la clé
    // étrangère, et l'entrée resterait en file à chaque essai.
    expect(PUSH_ORDER).toEqual(["teams", "players", "matches", "actions"]);
  });
});

describe("aller-retour sur des identifiants réels", () => {
  it("préserve les uuid générés par le client", () => {
    const id = newId();
    expect(
      fromCloudRow("teams", toCloudRow("teams", { ...TEAM, id })),
    ).toHaveProperty("id", id);
  });
});
