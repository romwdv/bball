import { z } from "zod";

/**
 * Modèle du domaine — aucune dépendance à React, Dexie ou Supabase.
 *
 * Principe directeur : **on n'écrit jamais de statistique**. On enregistre des
 * actions, et les statistiques sont dérivées par `aggregate()` (voir `stats.ts`).
 *
 * Pourquoi : les combos (panier + faute + LF) et l'annulation rendraient une
 * mutation directe de compteurs intenable — il faudrait recalculer à chaque
 * combo, chaque undo, à chaque changement de période.
 *
 * Corollaires utiles :
 * - le filtre par quart temps, l'undo et les stats cumulées partagent le même
 *   code de calcul ;
 * - une action annulée n'a jamais été « détruite », on ne peut donc pas
 *   diverger entre l'historique et les compteurs.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Période (quart temps). Le format est 4×8 min, sanschrono de jeu. */
export const Quarter = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);
export type Quarter = z.infer<typeof Quarter>;

export const QUARTERS: readonly Quarter[] = [1, 2, 3, 4];

/** Valeur d'un tir à l'espace. Un lancer vaut toujours 1, donc n'en fait pas partie. */
export const ShotValue = z.union([z.literal(2), z.literal(3)]);
export type ShotValue = z.infer<typeof ShotValue>;

/** Seuil d'élimination pour fautes. Compteur simple, sans logique d'élimination. */
export const FOUL_LIMIT = 5;

/**
 * Types d'action.
 *
 * `shot` porte `value` (2 ou 3), `made` et `fouled`.
 * `free_throw` porte `made` uniquement.
 * Les autres ne portent aucune donnée chiffrée.
 */
export const ActionKind = z.enum([
  "shot",
  "foul",
  "free_throw",
  "rebound",
  "assist",
  "turnover",
  "steal",
  "block",
  "substitution",
]);
export type ActionKind = z.infer<typeof ActionKind>;

/** Rebond offensif ou défensif — deux compteurs distincts dans les stats. */
export const ReboundSide = z.enum(["offensive", "defensive"]);
export type ReboundSide = z.infer<typeof ReboundSide>;

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

/**
 * Une action est **immuable** et **append-only**. L'annulation passe par
 * `voidedAt` (soft-delete) : rien n'est jamais supprimé, ce qui garantit que
 * l'historique affiché et les statistiques ne peuvent jamais diverger.
 */
export const ActionSchema = z
  .object({
    /** UUID généré côté client. Sert aussi de clé de déduplication à la sync. */
    id: z.string().min(1),
    matchId: z.string().min(1),
    playerId: z.string().min(1),
    /** Rang monotonique dans le match. L'ordre d'insertion réel n'est pas une garantie. */
    seq: z.number().int().nonnegative(),
    quarter: Quarter,
    kind: ActionKind,
    /** Shot uniquement : points visés. */
    value: ShotValue.optional(),
    /** `shot` et `free_throw` : le tir est-il rentré. */
    made: z.boolean().optional(),
    /** `shot` uniquement : une faute a été sifflée sur ce tir. */
    fouled: z.boolean().optional(),
    /** `rebound` uniquement : offensif ou défensif. */
    side: ReboundSide.optional(),
    /**
     * Lie les événements d'un même combo (`2P+F` crée 2 actions).
     * L'annulation porte sur le groupe entier, jamais sur une action isolée.
     */
    groupId: z.string().min(1).optional(),
    /** Horodatage de l'annulation, `null` si l'action est active. */
    voidedAt: z.number().int().nonnegative().nullable().optional(),
  })
  .superRefine((action, ctx) => {
    switch (action.kind) {
      case "shot":
        if (action.value === undefined) {
          ctx.addIssue({
            code: "custom",
            message: "Une action 'shot' exige `value` (2 ou 3)",
            path: ["value"],
          });
        }
        if (action.made === undefined) {
          ctx.addIssue({
            code: "custom",
            message: "Une action 'shot' exige `made`",
            path: ["made"],
          });
        }
        break;
      case "free_throw":
        if (action.made === undefined) {
          ctx.addIssue({
            code: "custom",
            message: "Une action 'free_throw' exige `made`",
            path: ["made"],
          });
        }
        break;
      case "rebound":
        if (action.side === undefined) {
          ctx.addIssue({
            code: "custom",
            message: "Une action 'rebound' exige `side`",
            path: ["side"],
          });
        }
        break;
      case "foul":
        // `fouled` n'a de sens que sur un tir. Un garde-fou ici empêche qu'un
        // import mal formé ne fasse compter une faute deux fois.
        if (action.fouled !== undefined) {
          ctx.addIssue({
            code: "custom",
            message: "`fouled` est réservé aux actions 'shot'",
            path: ["fouled"],
          });
        }
        break;
    }
  });

export type Action = z.infer<typeof ActionSchema>;

// ---------------------------------------------------------------------------
// Entités
// ---------------------------------------------------------------------------

export const PlayerSchema = z
  .object({
    id: z.string().min(1),
    teamId: z.string().min(1),
    /**
     * Prénom. **Peut être vide** : en bord de terrain, on connaît le nom de
     * famille de tout le monde et le prénom de personne. Exiger les deux rendait
     * la saisie rapide inutilisable — « Dupont » seul était rejeté en silence.
     */
    firstName: z.string().trim(),
    /**
     * Nom de famille. **Peut être vide** depuis que l'application ne suit qu'un
     * seul joueur (PLAN.md §11) : son identité tient dans son prénom, « Andreas »
     * seul. Exiger un nom de famille n'aurait signifié qu'une donnée inventée, et
     * une contrainte qu'il faudrait contourner en écrivant le prénom à la place.
     *
     * C'est `refine` et non une contrainte de champ : au moins **une** des deux
     * parties doit porter l'identité, sinon le joueur n'a pas de nom du tout.
     */
    lastName: z.string().trim(),
    /** Numéro de maillot. Nullable car certains clubs n'en utilisent pas. */
    number: z.number().int().min(0).max(99).nullable(),
  })
  .refine(
    (player) => player.firstName !== "" || player.lastName !== "",
    "Un joueur doit avoir au moins un prénom ou un nom",
  );
export type Player = z.infer<typeof PlayerSchema>;

export const MatchStatus = z.enum(["draft", "live", "finished"]);
export type MatchStatus = z.infer<typeof MatchStatus>;

export const MatchSchema = z.object({
  id: z.string().min(1),
  teamId: z.string().min(1),
  /** Nom de l'adversaire, saisi librement. Aucun roster adverse n'est suivi. */
  opponentName: z.string().trim().min(1, "L'adversaire est obligatoire"),
  /** Date de la rencontre en ISO (`YYYY-MM-DD`), pas un timestamp. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format YYYY-MM-DD"),
  /**
   * Roster de ce match : les joueurs qui y ont joué.
   *
   * Le roster de l'**équipe** est persistant et s'enrichit match après match ;
   * ce champ ne fait que dire qui était sur le parquet ce jour-là. Sans lui, un
   * joueur arrivé en cours de saison apparaîtrait dans la feuille de match des
   * matchs où il n'a pas joué, avec des zéros — et l'écran de saisie ne pourrait
   * pas afficher les seuls joueurs disponibles.
   *
   * Un tableau plutôt qu'une table de jointure : la relation est 1-n, sans
   * attribut propre, et une jointure coûterait une lecture de plus à chaque
   * affichage pour n'apporter rien.
   */
  playerIds: z.array(z.string().min(1)),
  status: MatchStatus,
  createdAt: z.number().int().nonnegative(),
  finishedAt: z.number().int().nonnegative().nullable(),
});
export type Match = z.infer<typeof MatchSchema>;

export const TeamSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, "Le nom d'équipe est obligatoire"),
  /** Renseigné à la première connexion cloud. `null` tant que l'app n'est pas connectée. */
  ownerId: z.string().min(1).nullable(),
});
export type Team = z.infer<typeof TeamSchema>;

/**
 * `substitution` associe un entrant à un sortant ; elle ne produit donc aucune
 * statistique, seulement une trace chronologique.
 */
export const SubstitutionSchema = z.object({
  outPlayerId: z.string().min(1),
  inPlayerId: z.string().min(1),
});
export type Substitution = z.infer<typeof SubstitutionSchema>;

// ---------------------------------------------------------------------------
// Aides de discrimination
// ---------------------------------------------------------------------------

/** Une action est active si elle n'a pas été annulée. */
export function isActive(action: Action): boolean {
  return action.voidedAt === null || action.voidedAt === undefined;
}

/** Le tir a donné lieu à une faute sifflée. */
export function isFouledShot(action: Action): action is Action & {
  kind: "shot";
  value: 2 | 3;
  made: boolean;
  fouled: true;
} {
  return action.kind === "shot" && action.fouled === true;
}
