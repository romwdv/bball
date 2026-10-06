# Plan d'implémentation — Stats de match de basketball

PWA mobile-first de saisie de statistiques de basketball en bord de terrain.
Suivi de l'avancement en bas de chaque phase et dans le journal de bord.

---

## Comment reprendre le travail

1. Lire la section **État actuel** (en bas de ce fichier).
2. Ouvrir la phase indiquée par `Prochaine étape`.
3. Respecter la liste de tâches de la phase, dans l'ordre.
4. Met à jour cette section et le **Journal de bord** à chaque tâche finie.

Convention : une tâche cochée `[x]` est faite **et vérifiée** (`pnpm typecheck && pnpm test && pnpm build` au vert).

---

## 1. Décisions produit validées

| Sujet         | Décision                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------- |
| Cible         | PWA mobile-first, installable iOS + Android                                              |
| Format        | 5x5, 4 périodes de 8 min, 5 fautes éliminatoire                                          |
| Chrono de jeu | **Non implémenté** — seule la sélection de période compte (stats par quart temps)        |
| Saisie        | Joueur verrouillé + tap = réussi, appui long 400 ms = manqué                             |
| Périmètre     | Mes joueurs uniquement — **pas** de score adverse, pas de stats adverses                 |
| Fautes        | Compteur simple (5 pastilles). Pas d'élimination, pas de LF suggérés, pas de bonus       |
| Effectif      | Une seule équipe, roster persistant enrichi match après match                            |
| Écrans        | Match en cours, historique des matchs, stats cumulées. **Pas** d'écran scoreboard public |
| Hors-ligne    | Garanti. Build 100 % statique, source de vérité en IndexedDB                             |
| Compte        | **Obligatoire.** Email + mot de passe Supabase, confirmation d'email désactivée          |
| Hébergement   | VPS Coolify, déploiement push depuis GitHub                                              |

### Règles métier à respecter

**Comptage des tirs** (implémenté dans `src/domain/rules.ts`, fonction unique et documentée) :

| Situation                          | FGA | FGM | Points  | Fautes | FTA                                |
| ---------------------------------- | --- | --- | ------- | ------ | ---------------------------------- |
| Tir 2 ou 3 pts réussi              | +1  | +1  | +2 / +3 | —      | —                                  |
| Tir 2 ou 3 pts raté                | +1  | —   | —       | —      | —                                  |
| Tir réussi + faute sifflée (and-1) | +1  | +1  | +2 / +3 | +1     | +1                                 |
| Tir **raté** + faute sifflée       | —   | —   | —       | +1     | +2, ou **+3** si tentative à 3 pts |
| Lancer réussi                      | —   | —   | +1      | —      | +1                                 |
| Lancer raté                        | —   | —   | —       | —      | +1                                 |
| Faute simple                       | —   | —   | —       | +1     | —                                  |

> **À confirmer par le commanditaire** : la ligne « Tir raté + faute » est **non-FIBA**. En règle FIBA
> officielle, ce tir compte comme une tentative ratée (FGA +1). Ici il n'est volontairement pas
> comptabilisé, donc le % de réussite n'est pas pénalisé par ces tirs. C'est un choix assumé.
> La logique est isolée dans une seule fonction pour être trivial à inverser le jour où l'avis change.

**Stats dérivées** : aucune statistique n'est stockée. On écrit des actions, les stats sont
recalculées par `aggregate()`. Conséquence : le filtre par période, l'undo et les stats cumulées
partagent le même code de calcul.

---

## 2. Stack et justification

### Versions vérifiées (npm, octobre 2026)

| Paquet                | Version |
| --------------------- | ------- |
| next                  | 16.3.8  |
| react                 | 19.3.0  |
| tailwindcss           | 4.3.3   |
| dexie                 | 4.4.6   |
| zustand               | 5.0.15  |
| @tanstack/react-query | 5.104.1 |
| @supabase/supabase-js | 2.117.2 |
| zod                   | 4.6.5   |
| vitest                | 5.0.3   |
| @playwright/test      | 1.63.0  |

### Contraintes techniques ayant dicté l'architecture

| Fait vérifié                                                                      | Conséquence retenue                                                                   |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Next 16 utilise **Turbopack par défaut**                                          | Le plugin PWA historique `@ducanh2912/next-pwa` est inutilisable                      |
| `output: 'export'` **interdit** les routes dynamiques sans `generateStaticParams` | Pas de `/match/[id]`. Routes fixes + query param : `/match?m=<uuid>`                  |
| `output: 'export'` **interdit** les Route Handlers dynamiques                     | Le mode Turbopack de Serwist (qui repose sur `app/serwist/[path]/route.ts`) est exclu |
| `@serwist/next` v9.5.13 (mode webpack) fonctionne                                 | Imposerait `next build --webpack`. Non retenu, voir ci-dessous                        |

### Décision PWA : service worker écrit à la main

Trois options évaluées :

- **A. Service worker artisanal (~120 lignes) — RETENUE.** Un script post-build génère le
  manifeste de precache depuis `out/`. Le SW fait `cache-first` sur les assets hashés et
  `network-first` avec fallback sur la navigation. Zéro dépendance de build, Turbopack conservé,
  comportement entièrement maîtrisé. Pour une app de 5 routes statiques, Workbox n'apporte rien
  qu'on ne fasse pas en 120 lignes.
- **B. Serwist en mode webpack.** Plus mature, mais perte de Turbopack et compatibilité
  Serwist × Next 16 × `output: 'export'` non validée.
- **C. Abandon de `output: 'export'`.** Contredit le besoin d'app 100 % statique sur le VPS Coolify.

**À confirmer par le commanditaire.** Repli : option B.

### Stack complète

```
Next.js 16.3.8 (App Router, output:'export')   routing + outillage, zéro SSR
React 19.3 + TypeScript strict
Tailwind CSS v4                                dark natif, tokens de design
Dexie 4.4 (IndexedDB)                          source de vérité locale
Zustand 5                                      état UI volatile (joueur verrouillé, période, sheet)
Zod 4                                          validation du modèle
@supabase/supabase-js 2.117                    auth + sync
Service worker artisanal                        offline
Vitest 5 + @testing-library/react + fake-indexeddb
Playwright 1.63                                 smoke test mobile
```

### Arborescence

```
src/
  domain/      modèle d'action, règles de projection, agrégation, undo  (pur, testé, zéro dépendance)
  data/        schémas Dexie, repositories, outbox
  sync/        client Supabase, moteur de sync, écrans d'auth
  ui/          composants génériques (Bouton, Jauge, Sheet, CarrouselJoueurs)
  features/
    match/     création, saisie en cours, clôture, feuille de match
    history/   liste des matchs
    stats/     stats cumulées
  app/         routes Next.js (4 pages statiques)
```

---

## 3. Modèle de données

### Principe : append-only

On n'écrit jamais un compteur. On enregistre des actions. Les combos et l'annulation exigeraient
sinon un recalcul permanent des compteurs. Les événements sont **immuables**, ont un **uuid généré
client**, et sont **soft-deleted** (`voidedAt`) — jamais supprimés.

### Type d'action

```ts
type Action = {
  id: string; // uuid client — sert aussi de clé de dédupe à la sync
  matchId: string;
  playerId: string;
  seq: number; // monotonique, ordre chronologique
  quarter: 1 | 2 | 3 | 4;
  kind:
    | "shot"
    | "foul"
    | "free_throw"
    | "rebound"
    | "assist"
    | "turnover"
    | "steal"
    | "block"
    | "substitution";
  value?: 2 | 3; // points visés (shot)
  made?: boolean; // shot / free_throw
  fouled?: boolean; // le tir a donné lieu à une faute sifflée
  groupId?: string; // lie les événements d'un même combo (undo groupé)
  voidedAt?: number | null;
};
```

### Tables

| Table       | Champs clés                                                                                                                                        | Index                                                                                |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `teams`     | `id`, `name`, `ownerId`, `updatedAt`                                                                                                               | `ownerId`, `updatedAt`                                                               |
| `players`   | `id`, `teamId`, `firstName`, `lastName`, `number`, `updatedAt`                                                                                     | `teamId`, `[teamId+number]`, `updatedAt`                                             |
| `matches`   | `id`, `teamId`, `opponentName`, `date`, **`playerIds`** (roster du match), `status: draft\|live\|finished`, `createdAt`, `finishedAt`, `updatedAt` | `teamId`, `status`, `date`, `updatedAt`                                              |
| `actions`   | voir ci-dessus + `updatedAt`                                                                                                                       | `[matchId+seq]`, `[matchId+quarter]`, `playerId`, `groupId`, `voidedAt`, `updatedAt` |
| `syncState` | `key`, `lastPulledAt`, `updatedAt`                                                                                                                 | `updatedAt`                                                                          |
| `outbox`    | `id` (= `entity:entityId`), `entity`, `entityId`, `payload`, `createdAt`, `attempts`, `lastError`                                                  | `[entity+entityId]`, `createdAt`                                                     |

`updatedAt` est une colonne de persistence, pas du domaine : les lignes stockées sont
`Player & { updatedAt: number }`, et `toPlayer()` la retire avant de remettre l'objet au
reste du code. Elle est ce qui rend le tirage descendant par curseur possible (§5).

---

## 4. Ergonomie de l'écran de saisie

Disposition en 3 zones, actions dans la **thumb zone** (bas de l'écran), une seule main.

```
┌──────────────────────────────────┐
│ Q2  [undo]  38 - 24   ⚡ sync    │  header compact
├──────────────────────────────────┤
│ 4 Martin ████ 12 │ 7 Dubois ●● │  ← carrousel joueurs scrollable,
│ 9 Bernard ▪ │ 5 Petit ████████ │    n° + live stats + pastilles de fautes
├──────────────────────────────────┤
│  ┌────────────┬────────────┐    │
│  │    2 PTS   │    3 PTS   │    │  cibles ≥ 88px
│  │    ✓  ✗    │    ✓  ✗    │    │  tap = réussi
│  ├────────────┼────────────┤    │  appui 400 ms = manqué
│  │   FAUTE    │     LF     │    │
│  ├────────────┴────────────┤    │
│  │ RB  RB+  P  PD  CT  IC  │    │  stats avancées
├──────────────────────────────────┤
│ 2P+F  3P+F  R+F+2LF  R+F+3LF   │  ← bandeau combos scrollable
└──────────────────────────────────┘
```

**Le joueur verrouillé** : après sélection, le joueur reste actif. Les actions suivantes s'y
appliquent sans re-sélectionner. Un tap sur un autre joueur change le verrou. C'est ce qui rend
rapide une série de paniers du même joueur.

**Combos atomiques** : `2P+F` et `3P+F` sont deux boutons distincts. Un tap crée 2 événements liés
par `groupId` — l'undo les retire ensemble. Un tir manqué avec faute ouvre directement la saisie
des lancers (mini-sheet de 2 ou 3 lancers avec compteurs).

**Retours** : `navigator.vibrate` (15 ms réussi, 40 ms manqué, motif distinct pour les combos) ·
toast undo de 4 s · `WakeLock` réacquis à chaque visibilité du document ·
`env(safe-area-inset-*)` · cibles ≥ 88 px.

---

## 5. Auth et synchronisation

### Auth — email + mot de passe, sans confirmation

Choix structurant : la doc Supabase indique que le service email par défaut est plafonné à
**2 emails/heure**. En désactivant « Confirm email », l'inscription renvoie une session immédiate
et **aucun email n'est envoyé**. On supprime entièrement la dépendance email du quotidien.

```ts
createClient(url, publishableKey, {
  auth: {
    persistSession: true, // localStorage → survit au redémarrage et au mode avion
    autoRefreshToken: true, // refresh silencieux en tâche de fond
    detectSessionInUrl: true, // requis pour le lien de reset de mot de passe
  },
});
```

Trois écrans sur `/` : connexion · inscription · mot de passe oublié. Le lien de reset revient
dans le fragment d'URL, `detectSessionInUrl` le convertit en session et émet `PASSWORD_RECOVERY`.

**Garde-fou d'accès — à confirmer par le commanditaire.** Si la session est absente ou expirée,
l'app est **verrouillée** et la saisie de match est bloquée. Pas de mode hors-ligne dégradé.
Raison : sans ce verrouillage, un coach pourrait saisir un match entier hors-ligne puis
découvrir qu'il n'a pas de compte, ce qui produirait un match orphelin jamais synchronisé.

**Sécurité** : seule la publishable key est exposée dans le bundle — c'est la conception de
Supabase, la sécurité repose sur les RLS. **Aucune** `service_role` key dans le client.

### Configuration dashboard Supabase (une seule fois)

| Où                                 | Quoi                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------ |
| Authentication → Sign In / Email   | **Cocher "Confirm email" → OFF** (point critique)                        |
| Authentication → URL Configuration | Site URL = domaine de prod ; `Redirect URLs` = `https://domaine/` et `/` |
| Authentication → Sessions          | `Session time limit` 30 jours, refresh token rotation ON                 |
| Auth → Providers                   | Email activé (par défaut)                                                |

Aucune clé Google Cloud. Aucun SMTP. Si l'oubli de mot de passe doit fonctionner réellement,
brancher un SMTP (Brevo / Resend / SMTP2GO) — l'écran est prévu mais le bouton échouera
proprement tant que le SMTP n'est pas configuré.

### Sync — pattern outbox

1. L'écriture locale (Dexie) est immédiate et ne bloque jamais l'UI.
2. **Dans la même transaction**, chaque mutation ajoute une entrée dans `outbox`. Soit les
   deux passent, soit aucune — il ne peut pas exister une action en base que la
   synchronisation n'essaiera jamais d'envoyer.
3. Un moteur de sync drain l'outbox vers Supabase (upsert par `id`). Déclenché au lancement,
   au retour réseau, et toutes les 30 s. **En phase 2, seule la file existe** (`peek`,
   `ack`, `fail`) — le moteur lui-même arrive en phase 6.
4. Tirage descendant par curseur `updated_at > lastPulledAt`.

L'outbox contient **au plus une entrée par ligne**, clé `entity:entityId`. Créer puis annuler
une action remplace l'entrée au lieu de s'accumuler : le cloud ne connaît que des upserts, le
dernier état suffit. `attempts` et `lastError` sont conservés au remplacement, pour qu'une
mutation locale ne remette pas le backoff à zéro.

Les actions étant **immuables** avec uuid client, la résolution de conflit est un dédupe par `id` :
pas de CRDT, pas de merge. Seuls les undos (soft-delete) sont des mutations, résolus en
last-write-wins — acceptable sur un usage mono-appareil.

RLS : `auth.uid() = teams.owner_id`.

---

## 6. Phases d'implémentation

Estimation totale : **6 à 8 jours**.

---

### Phase 0 — Socle

**Durée** : ~0,5 jour · **Statut** : ✅ Terminée

Objectif : un projet qui compile, se typecheck, se teste et se construit en statique.

Tâches :

- [x] `create-next-app` (TypeScript, Tailwind v4, App Router, `src/`, alias `@/*`) — dossier
      projet nommé `SpaceBunny`, donc le package s'appelle `space-bunny`
- [x] `output: 'export'` dans `next.config.ts`, `trailingSlash: true`, `images.unoptimized`
- [x] Scripts : `dev`, `build`, `typecheck`, `lint`, `format`, `format:check`, `test`,
      `test:watch`, `test:coverage`, `e2e`, `verify`
- [x] ESLint (flat config, règles a11y tactiles) + Prettier + `.prettierignore`
- [x] Vitest : `jsdom`, `setupFiles`, alias `@/*`, seuils de couverture à 90 %
- [x] Dossiers `src/{domain,data,sync,ui,features/*}` + `tests/{domain,data,features}`
- [x] `app/layout.tsx` : métadonnées, `viewport` (`themeColor`, `viewportFit: 'cover'`),
      `lang="fr"`, suppression du zoom auto
- [x] `globals.css` : thème dark natif, tokens sémantiques, `env(safe-area-inset-*)`,
      `--tap-target-min` (44px) et `--tap-target-action` (88px)
- [x] 4 routes fixes créées : `/`, `/match/`, `/history/`, `/stats/`
- [x] `.env.example` documenté (clé publishable uniquement)
- [x] `playwright.config.ts` : viewport téléphone, sert `out/` en prod
- [ ] `git init` + premier commit — **bloqué** : agreement de licence Xcode manquant sur cette
      machine. À faire quand `sudo xcodebuild -license` a été accepté.

Vérification : `pnpm verify` (typecheck + lint + test + build) au vert, `out/index.html` produit,
les 4 routes listées comme `(Static)`.

Notes de mise en œuvre :

- `pnpm` n'était pas installé : activé via `corepack prepare pnpm@latest --activate` (12.9.1).
- `tsconfig.json` durci : `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`,
  `noImplicitOverride`, `noFallthroughCasesInSwitch`. Le modèle d'action du domaine étant une
  union discriminée, ces drapeaux sont la défense contre une règle oubliée.
- Police système au lieu de Google Fonts : aucun téléchargement réseau au premier lancement,
  exigence pour une PWA hors-ligne.
- `LayoutProps<"/">` (type généré par Next) remplacé par `{ children: ReactNode }` pour que
  `tsc --noEmit` passe sans avoir à builder d'abord.
- `next-env.d.ts` est ignoré par `.gitignore` (comportement par défaut de `create-next-app`) :
  le build le régénère.

---

### Phase 1 — Domaine pur (test-first)

**Durée** : ~1 à 1,5 jour · **Statut** : ✅ Terminée

Objectif : toute la logique métier, sans UI ni base de données. C'est le cœur de la valeur.

Tâches :

- [x] Schémas Zod du type `Action` et des entités `Match`, `Player`, `Team`
- [x] `project(action) → StatDelta` : règles de la table §1
- [x] `aggregate(actions, { playerId?, quarter?, matchId? }) → PlayerStats` (points, FGM/FGA,
      FTA/FTM, % 2pts, % 3pts, % LF, rebonds off/def, passes, pertes, contres, interceptions,
      fautes)
- [x] `pointsByQuarter` / `statsByQuarter` / `scoreForQuarters` pour la feuille de match
- [x] Grouping des combos : `ActionDraft` en union discriminée + `combos.*`
- [x] Undo : annulation groupée d'un `groupId`, périmètre calculé par `undoScope()`
- [x] `cumulativeStats(actions, matchIds)` → totaux + moyennes par match
- [x] `pendingFreeThrows(actions)` : lancers dus mais non saisis
- [x] **Tests exhaustifs** : chaque ligne du tableau §1 a au moins un test nommé.
      Plus : and-1 à 3pts, série de 3 LF, action voidée exclue des deux côtés,
      filtre par période, deux séries de LF distinctes, tir à égalité de points

Vérification : `pnpm verify` au vert · **115 tests** · couverture `src/domain`
**99,2 % stmts / 97,2 % branches / 100 % lignes** · aucun import de React ni de Dexie.

#### Trois décisions prises en cours de route

**1. Les FTA ne sont comptés que par les actions `free_throw`.**
Une première version faisait `+2 FTA` sur le tir fouillé, _plus_ `+1` par lancer saisi :
2 FTA became 4 pour une série de 2. Corrigé : un tir fouillé ne produit que `+1 faute`, et
`awardedFreeThrows()` indique combien de lancers sont dus. C'est aussi plus honnête : un
joueur qui n'a pas eu l'occasion de tirer ses 2 lancers n'a pas « tenté » 2 lancers.
Contrepartie signalée dans le code : si le coach ferme l'app sans saisir les lancers, les FTA
de la série n'apparaissent pas.

**2. `madeAndFouled` ne crée qu'une action, pas deux.**
Le plan prévoyait `panier` + `fautes`. Une action `foul` séparée aurait compté la faute deux
fois puisque l'action `shot` porte déjà `fouled: true`.

**3. `includeVoided` supprimé de `AggregateFilter`.**
`project()` retourne toujours un delta neutre pour une action annulée : ce filtre n'aurait
donc aucun effet. Plutôt que de laisser un paramètre menteur en place, il a été retiré. Le
seul moyen de lire une action annulée est `actionsOfMatch()`, qui les conserve par défaut pour
le fil du match.

#### Notes de mise en œuvre

- `ActionDraft` est une **union discriminée** (`DraftOf<K>`) plutôt qu'un objet à champs
  optionnels : impossible de compiler un rebond sans `side` ou un tir sans `value`. Erreurs
  attrapées à la compilation, pas par garde-fou à l'exécution.
- `voidActions()` et `applyUndo()` sont purs et ne modifient rien en place ; le repository
  réécrira les enregistrements concernés dans IndexedDB.
- Bug corrigé en cours de route : `applyUndo` renvoyait les seules actions du périmètre au lieu
  de la liste complète, ce qui faisait disparaître les actions non annulées.
- `tsconfig.json` : `types: ["vitest/globals", "@testing-library/jest-dom"]` ajouté, sinon
  `describe`/`it`/`expect` n'étaient pas typés.
- `@vitest/coverage-v8` installé (manquant pour `pnpm test:coverage`).
- Prettier : `semi: true` (par défaut), le formatage initial avait retiré les points-virgules.

---

### Phase 2 — Persistance locale

**Durée** : ~0,5 à 1 jour · **Statut** : ✅ Terminée

Objectif : IndexedDB fiable, derrière des interfaces testables.

Tâches :

- [x] Schéma Dexie + fonction de migration (v1 → v2 documentée)
- [x] Interfaces `MatchRepository`, `PlayerRepository`, `ActionRepository`
- [x] Implémentations IndexedDB derrière ces interfaces
- [x] `voidAction(id)` / `voidGroup(groupId)` avec soft-delete
- [x] `nextSeq(matchId)` atomique
- [x] Table `outbox` + helpers d'ajout/drain
- [x] Tests avec `fake-indexeddb` : CRUD, migration, undo groupé, monotonie de `seq`

Note : c'est fait — les repositories sont écrit contre leurs interfaces, le passage à Supase
en phase 6 se fera sans toucher au domaine ni aux composants de saisie.

Vérification : `pnpm verify` au vert · **239 tests** · couverture `src/data` **100 % lignes /
100 % fonctions / 99,6 % branches**.

#### Quatre décisions prises en cours de route

**1. La migration v1 → v2 remplit `updatedAt` avec `0`, pas `Date.now()`.**
`0` est plus petit que n'importe quel `updated_at` déjà distribué par le cloud, donc le
premier tirage descendant **rattrapera** les lignes préexistantes. Avec `Date.now()`, des
matchs saisis avant la mise à jour seraient croyus déjà synchronisés et ne remonteraient
jamais — une perte de données silencieuse et définitive.

**2. `groupId` indexé sur `actions`.**
Absent du premier jet du schéma, il rendait `voidGroup()` — donc l'annulation d'un combo
`2P+F` et de ses deux lancers — dépendante d'un parcours complet de la table. Ajouté à v2,
avec un test qui échouait franchement (`KeyPath groupId … is not indexed`) plutôt que de
dégrader la performance en silence.

**3. L'outbox déduplique par ligne, clé primaire = `entity:entityId`.**
Créer puis annuler une action produit deux mutations de la même ligne. Comme le cloud ne
connaît que des upserts, n'envoyer que le dernier état suffit. Conséquence : `attempts` et
`lastError` sont **conservés** au remplacement, sinon chaque nouvelle action locale
remettrait le backoff à zéro — une mutation locale ne transforme pas un serveur injoignable
en serveur joignable.

**4. Une clé d'outbox déterministe, pas un `newId()`.**
La déduplication « au plus une entrée par ligne » impose de retrouver l'entrée existante
avant d'en écrire une nouvelle. Une clé calculée évite la lecture préalable et rend
l'upsert en une opération.

#### Notes de mise en œuvre

- **`updatedAt` sur chaque ligne** : ce n'est pas une colonne décorative, c'est ce qui rend
  le tirage descendant du §5 possible. Les actions étant immuables sauf soft-delete, la
  colonne couvre la création **et** l'annulation.
- **Atomicité de `nextSeq`** : lecture-modification-écriture dans une seule transaction
  `rw` sur `actions`. C'est Dexie, sérialisant les transactions qui se recouvrent, qui
  rend l'opération atomique — aucun verrou à écrire. Un test lance 10 `append()` concurrents
  et vérifie que les `seq` sont `0..9` sans doublon.
- **`lastSeqIn()` utilise l'index composé `[matchId+seq]`** plutôt que de filtrer par
  `matchId` puis réduire : O(log n) au lieu de O(n) sur un match qui peut compter plusieurs
  centaines d'événements.
- **Zéro suppression physique.** `voidMany()` réécrit les enregistrements concernés ;
  `actions.update` n'existe pas, par construction.
- **`voidMany()` relit les lignes dans la transaction** avant d'écrire `voidedAt` : l'annulation
  passe par la clé primaire, pas par la copie que l'appelant détenait. `undoLast()` ne fait
  que demander au domaine (`undoScope()`) _quel_ est le périmètre, puis délègue l'écriture.
- **Validation Zod avant écriture** : une ligne invalide est rejetée **avant** d'atteindre
  IndexedDB. Écrire d'abord et valider ensuite laisserait un match corrompu en base, visible
  seulement à la première lecture des statistiques. Un test vérifie qu'un combo dont le
  second draft est invalide ne laisse aucune ligne ni entrée d'outbox derrière lui.
- **`db()` paresseux** : `output: 'export'` prerend les pages dans un Node sans
  `indexedDB`, donc ouvrir la base à l'import du module ferait échouer le build.
- **`src/data/index.ts`** est le seul point d'entrée : les composants obtiennent des
  repositories, jamais une base. Le test correspondant vérifie qu'aucune base n'est ouverte
  avant le premier appel.
- `src/data/schema.ts` fusionne la classe `SpaceBunnyDB` et les helpers d'accès
  (`db`, `setDb`) : un `db.ts` séparé aurait juste constitution deux fichiers de dix lignes.
  `createTestDb()` a été retiré, les tests construisant `new SpaceBunnyDb(nom unique)` en
  direct — plus lisible qu'un helper qui ne fait que déléguer au constructeur.

---

### Phase 3 — Prototype tactile · PORTE DE VALIDATION

**Durée** : ~1 à 1,5 jour · **Statut** : ✅ Terminée — porte de validation levée le 2026-10-06

Objectif : la saisie en temps réel, testable sur un vrai téléphone. **On s'arrête ici pour ton
retour ergonomique avant d'écrire la moindre ligne de stats.**

Ce qui était déjà disponible côté données : `append()` écrit un combo entier et attribue `seq`
et `id`, `undoLast()` et `voidGroup()` gèrent l'annulation, `listByMatch()` rend le fil
ordonné. La phase 3 n'a donc pas eu à se soucier de la persistance.

Tâches :

- [x] Zustand : store de match (`playerId` verrouillé, `quarter`, sheet ouverte)
- [x] Écran `/` — liste des matchs en cours + « Nouveau match »
- [x] Écran `/new-match` — date, adversaire, sélection des joueurs depuis le roster (création rapide
      d'un joueur si absent : numéro + nom)
- [x] Écran `/match?m=<uuid>` selon le layout §4
- [x] Carrousel joueurs : numéro, nom, points live, pastilles de fautes, état verrouillé
- [x] Grille d'actions : tap vs appui long 400 ms, haptique
- [x] Bandeau de combos : `2P+F`, `3P+F`, `R+F+2LF`, `R+F+3LF`
- [x] Mini-sheet de saisie des LF (2 ou 3 lancers, compteurs, boutons ✓ / ✗)
- [x] Undo groupé + toast 4 s
- [x] Sélecteur de période (Q1–Q4) + score dans le header
- [x] Wake Lock
- [ ] `visualViewport` (clavier qui ne casse pas le layout) — **non fait, à voir sur téléphone**
- [ ] Recalage du carrousel sur le joueur verrouillé au changement de période
- [ ] Indicateur de sync réel dans le header (le `⚡` est un placeholder, la phase 6 le branchera)

**PORTE** : ✅ **levée le 2026-10-06.** Test sur téléphone via l'URL déployée (`stats.romwdv.fr`),
OK. L'accès par IP locale échouait (pare-feu macOS et/ou bail DHCP renouvelé — l'IP a changé
en cours de session) ; le déploiement HTTPS a rendu la question sans objet, ce qui valide au
passage que **Safari refuse IndexedDB hors contexte sécurisé** : un test réussi en HTTP sur
Android n'aurait rien prouvé pour iOS.

Un point reste sous surveillance, sans retour négatif à ce jour : le seuil de 400 ms du geste
tap / appui long est une **estimation**, pas une mesure. Il est isolé dans la constante
`LONG_PRESS_MS` (`src/ui/usePress.ts`) pour être ajusté en une ligne si un match réel révèle
que le coach confond les deux gestes.

#### Décisions prises en cours de route

**1. `playerIds` ajouté au modèle `Match`, avec migration v2 → v3.**
C'était un manque du modèle, pas de l'écran : sans roster par match, un joueur arrivé en cours
de saison apparaît dans la feuille de match des matchs où il n'a pas joué, avec des zéros. Un
tableau plutôt qu'une table de jointure — relation 1-n sans attribut propre, et une jointure
coûterait une lecture de plus à chaque affichage pour n'apporter rien. Les matchs anciens
reçoivent `playerIds: []` et non le roster actuel : attribuer les joueurs d'aujourd'hui à un
match d'il y a trois mois donnerait l'illusion qu'ils y ont joué.

**2. La période n'existe que dans le store, jamais en prop.**
Le sélecteur Q1–Q4 et l'écriture en base partageaient deux sources (store d'un côté, prop de
l'autre). Elles ont divergé pendant une heure de développement : le test enregistrait un tir en
Q1 pendant que le composant affichait Q2. Le store est l'unique source ; `ActionGrid` et
`CombosBar` lisent `useMatchStore(state => state.quarter)`.

**3. `combos.*` ne sont plus utilisés par la grille d'actions.**
Ils exigent un `groupId` non vide, or un geste simple n'a pas de groupe : le store en crée un à
chaque écriture. Les drafts sont donc construits littéralement dans les composants, sans
`groupId`. Un `groupId: ""` avait été essayé et rejetait la validation Zod — un garde-fou qui a
fonctionné comme prévu.

**4. Le toast n'expose pas encore « Réfaire ».**
Le rendre fonctionnel demanderait de conserver le périmètre exact de l'annulation en mémoire
pendant 4 secondes, alors que la source de vérité est la base. Le bouton d'annuler du header
reste le chemin de correction. Candidat pour la phase 4, une fois le score lisible.

**5. Les tirs affichés en `réussis/tentés` dans le carrousel.**
Un tir raté ne changeait **rien** de ce qui était affiché : ni le score, ni les points du
joueur, ni les pastilles de fautes. Le seul compteur modifié était `fga`, absent de l'UI — le
coach ne pouvait pas savoir si son appui long était passé. Le ratio `2/5` rend le raté visible
et persistant, et la bannière d'acquittement le confirme à l'instant.

**6. Bouton FAUTE bloqué à 5 fautes — décision du commanditaire, écart au plan.**
Le plan §1 disait « compteur simple, pas d'élimination ». Le commanditaire a demandé que le
bouton se bloque à 5 ; c'est fait, avec le compteur affiché en permanence et un libellé qui
explique pourquoi le bouton est mort. Les autres cibles restent actives : un joueur sorti peut
encore tirer.

**7. `awardedFreeThrows()` accorde 1 lancer après un and-1.**
Une première version ne renvoyait quelque chose que pour un tir **raté** : le bouton `2P+F`
n'ouvrait aucune fiche et `pendingFreeThrows()` ne signalait jamais le lancer dû. Le domaine
applique désormais la règle FIBA — 1 lancer après un panier, 2 ou 3 après un tir raté selon sa
valeur. Le lancer est rattaché au groupe du panier, donc un `undo` après un and-1 retire les
trois d'un bloc. C'est correct, mais ça mérite d'être connu.

**8. Un bouton désactivé n'enregistre rien, même si le navigateur lui délivre l'événement.**
Les navigateurs ne dispatchent pas de pointer events sur un élément `disabled`, mais faire
porter la garantie au navigateur laissait un `disabled` qui n'empêchait rien d'écrire dans
jsdom. `usePress` vérifie `currentTarget.disabled` — central, protège tous les appelants.

#### Trois bugs réels trouvés par les tests

**1. `usePress` enregistrait un tap sur un relâchement sans appui.**
`onPointerUp` appelait `onTap` sans vérifier qu'un `pointerdown` avait eu lieu. Un second
doigt posé et levé rapidement, ou un `pointercancel` suivi d'un `pointerup`, auraient créé une
action fantôme. Corrigé par un `pressing` en ref.

**2. jsdom n'implémente pas `PointerEvent` — les appuis longs n'étaient pas testables.**
React 19 n'abonne pas ses écouteurs synthétiques `pointerdown` sans ce global : les tests de
l'appui long échouaient sans raison apparente. Un simple alias vers `MouseEvent` ne suffisait
pas — `isPrimary` n'existe pas sur `MouseEvent`, donc le hook ignorait tous les appuis. Le
polyfill recopie `pointerId`, `pointerType`, `isPrimary` et `pressure`.

**3. `useAsyncData` : `loading` ne repasse jamais à `true`.**
Choix d'ergonomie assumé : après un tir, le carrousel doit continuer à afficher les stats
précédentes pendant la relecture IndexedDB. Faire clignoter « Chargement… » à chaque panier
rendrait l'écran illisible en bord de terrain. `loading` ne sert qu'au tout premier rendu.

#### Notes de mise en œuvre

- **`usePress` est le seul endroit du projet où le geste est implémenté.** C'est ce qui rend le
  contrat testable : un test vérifie qu'un appui de 600 ms n'enregistre _ni_ tap _ni_ double
  action, ce qui est l'erreur la plus coûteuse possible ici — un score faux sans signal.
- **`AwardedFreeThrows` est relu sur l'action écrite**, pas déduit du bouton pressé dans
  `CombosBar`. Si la règle métier change un jour, la fiche affichera le bon nombre sans qu'un
  seul bouton soit touché.
- **`revision` dans le store force la relecture des statistiques** sans que le composant ait à
  savoir d'où vient l'écriture (tir, undo, série de LF). Indirection volontaire.
- **Stats du carrousel = période courante**, pas cumul du match. Afficher le cumul ferait
  passer un joueur à 12 points pour un tireur de 6 en cours de quart temps.
- **`Bouton.tsx` n'est plus utilisé** : chaque cible de la grille a son propre état pressé via
  `usePress`, qu'un bouton générique ne pourrait pas exposer. Supprimé.
- **Les `role="tab"` du carrousel** annoncent la liste des joueurs au lecteur d'écran, même si
  le carrousel est avant tout tactile.

---

### Phase 4 — Clôture et feuille de match

**Durée** : ~0,5 à 1 jour · **Statut** : ✅ Terminée

Objectif : terminer un match proprement et lire le résultat.

Tâches :

- [x] Action « Terminer le match » avec confirmation
- [x] Feuille de match : score total et par période, ligne par joueur
      (`2/6 à 3pts`, `4/8 LF`, fautes, rebonds, passes, pertes, contres, interceptions)
- [x] Reprise d'un match en cours au lancement : bandeau « Reprendre le match du 12/03 »
      (déjà en place en phase 3, verrouillé par l'E2E ici)
- [x] Export CSV et JSON du match
- [x] Tests Playwright : créer un match → saisir 10 actions → vérifier le score

Vérification : `pnpm verify` au vert · **394 tests** + **7 tests E2E** · couverture globale
98,5 % lignes. Le smoke test Playwright couvre le cycle complet, y compris la clôture et la
reprise.

#### Quatre décisions prises en cours de route

**1. La clôture verrouille l'écriture, dans la transaction.**
`append()` refuse d'écrire dans un match terminé, **dans la transaction** : un écran resté
ouvert pendant la clôture ne peut pas écrire une action dans une feuille déjà lue — sinon les
stats exportées divergeraient silencieusement de ce que le coach vient de voir. La correction
passe par « rouvrir » (`setStatus live`), jamais par un contournement. L'undo reste possible
sur un match terminé : bloquer la suppression empêcherait de corriger une erreur à la relecture.

**2. La fiche de clôture montre les lancers dus AVANT de confirmer.**
Un lancer oublié découvert après la clôture oblige à rouvrir, resaisir, refermer. La fiche
compte donc `pendingFreeThrows()` et l'affiche en avertissement — c'est le seul écart réparable
avant le point de non-retour.

**3. L'export CSV est calibré pour Excel FR, pas pour un standard.**
Séparateur `;`, BOM UTF-8, fins CRLF. Un CSV à virgules s'ouvre en une seule colonne dans
Excel FR et le coach ne saura jamais pourquoi. Les valeurs sont échappées : « BC;Nuit »
casserait la colonne suivante en silence.

**4. Le JSON exporte TOUTES les actions, annulées comprises.**
Le CSV montre les compteurs ; l'export machine doit permettre de reconstruire l'historique
exact, y compris ce qui a été défait. C'est la seule façon de garantir qu'un export ne perd
rien — les stats, elles, sont recalculées sur les actions actives.

#### Le smoke test a trouvé un vrai trou d'UX

L'écran de match terminé n'avait **aucun bouton de sortie** : la barre de saisie disparaît,
et il ne restait que le bouton retour du navigateur — invisible sur une PWA installée. Le
coach était piégé sur la feuille. Ajouté « ‹ Accueil » au-dessus de la feuille.

C'est exactement ce que la tâche « smoke test » est censée attraper : un parcours complet,
pas une page isolée.

#### Notes de mise en œuvre

- **`MatchSheet` est présentationnel** : il reçoit match, roster et actions en props, il ne
  charge rien. C'est ce qui le rend réutilisable par la phase 5 pour le détail d'un match
  historique, et testable sans IndexedDB.
- **Un seul chargement d'actions pour deux consommateurs** : la fiche de confirmation
  (lancers dûs, fautes) et la feuille de lecture lisent la même liste. Sinon les deux
  écrans verraient des données différentes.
- **`refresh()` ajouté au store** : une écriture qui ne passe pas par `record()` — la
  clôture — doit quand même rafraîchir l'écran. Sinon le composant devrait connaître
  l'écriture étrangère et la répliquer.
- **L'écran « fini » n'a pas d'état local** : `finished` est dérivé de `match.status`, et
  `refresh()` provoque la relecture. Un état local dupliquerait la source de vérité.
- **Pourcentages d'équipe via `teamTotals`** : `aggregateFor(actions, "team")` filtre par
  `playerId`, donc une équipe fictive valait tout à zéro — un bug qui ne se voit qu'au
  premier panier marqué. Attrapé par le test, pas par le type.
- **Playwright sert `out/` via `scripts/serve.mjs`** : mêmes en-têtes de cache que la
  production, aucun téléchargement de paquet au premier lancement (`npx --yes serve` le
  faisait). `pnpm e2e:full` enchaîne build puis test — un E2E sur un build périmé est un
  faux positif.

---

### Phase 5 — Historique et stats cumulées

**Durée** : ~1 à 1,5 jour · **Statut** : ✅ Terminée

Objectif : l'écran « les matchs précédents » et l'écran « mes stats cumulées ».

Tâches :

- [x] `/history` : matchs terminés + en cours, badge de statut, tri par date
- [x] Détail d'un match historique : feuille de match, consultation par période
- [x] `/stats` : cumul par joueur — points totaux, points/match, paniers 2P et 3P (réussis/tentés),
      % de réussite global et par type, rebonds, passes, pertes, contres, interceptions, fautes
- [x] Tri par colonne · filtres
- [x] Export CSV des stats cumulées

Vérification : `pnpm verify` au vert · **424 tests** + 7 E2E · couverture 98,56 % lignes.
Les moyennes sont vérifiées explicitement : `averages.points === totals.points / matchesPlayed`.

#### Quatre décisions prises en cours de route

**1. Le détail d'un match passe par un query param, pas un segment de chemin.**
`/history/?m=<uuid>`, pour la même raison que `/match/?m=` : `output: 'export'` interdit les
routes dynamiques. Deux URLs statiques valent mieux qu'une règle de réécriture Nginx — et c'est
pour ça que `MatchSheet` a été écrit présentationnel en phase 4, il était déjà prêt à être
réemployé tel quel.

**2. La période sélectionnée ne filtre que les lignes, jamais le score par période.**
Filtrer les actions en amont donnerait un bandeau de score à zéro partout ailleurs — un
mensonge. Le score par période reste donc calculé sur le match entier, tandis que les
pourcentages et les lignes par joueur portent sur la période consultée. `MatchSheet` reçoit un
`quarter` optionnel et fait la séparation lui-même.

**3. Le tri par nom reste croissant, même en « décroissant ».**
Lire une liste de noms à l'envers n'aide personne. Le sens est forcé au croissant pour la seule
colonne « Joueur », et l'icône de tri reflète ce sens réel — pas l'inverse.

**4. Un joueur sans tentative a un pourcentage vide, pas 0.**
Le tri le place en fin de classement grâce à une sentinelle `-1`, et l'export laisse la cellule
vide. Afficher « 0 % » ferait croire à un joueur qui n'a rien raté alors qu'il n'a rien tenté.

#### Notes de mise en œuvre

- **`listByMatches()` ajouté au repository** : sans lui, l'écran des stats cumulées ferait une
  lecture par match, soit vingt requêtes pour une saison. Un `anyOf` sur l'index `matchId`
  suffit.
- **Le tri est extrait en fonction pure** (`sortAndFilter`) plutôt que laissé au tableau :
  testable sans DOM, et chaque colonne expose sa fonction de tri, ce qui évite de maintenir deux
  listes de clés qui divergeraient entre le mode « Totaux » et le mode « Par match ».
- **Un joueur qui n'a joué aucun match n'apparaît pas** dans les statistiques cumulées — le
  comptage se fait sur les actions distinctes, pas sur la taille de la liste des matchs.
- **Le toast de `/stats` réutilise le composant `Flash`** de la saisie plutôt qu'un second
  composant identique : même durée, même style, un seul comportement à maintenir.
- **Les tests de fixtures ont d'abord été faux, trois fois.** Ada marque 2+3 puis 2 = 7 points,
  et 2 paniers à 2 points réussis sur 3 tentés. Les attentes écrites à l'estime ont échoué, pas
  le code — un rappel utile quand un test d'export affiche des chiffres qu'on vient d'inventer.

---

### Phase 6 — Supabase : auth et sync

**Durée** : ~1 jour · **Statut** : ✅ Terminée

Objectif : compte obligatoire et synchronisation cloud. Le poste le moins risqué du projet,
l'auth étant réduite à deux clics de dashboard.

Tâches :

- [x] `.env.local` + `.env.example` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`)
- [x] `src/sync/supabase-client.ts` avec la config auth §5
- [x] Store d'auth Zustand : session, chargement, `signIn`, `signUp`, `signOut`, `onAuthStateChange`
- [x] Écran de connexion `/` : email, mot de passe, « mot de passe oublié »
- [x] Écran d'inscription : email, mot de passe, confirmation → session immédiate
- [x] Écran « mot de passe oublié » + gestion `PASSWORD_RECOVERY` via le query param `?mode=reset-password`
- [x] Garde-fou : `Guard` bloquant l'accès aux routes de match si session absente
- [x] SQL Supabase : tables `teams`, `players`, `matches`, `actions` + `outbox` côté serveur
- [x] RLS : `auth.uid() = teams.owner_id`, politiques sur chaque table
- [x] Moteur de sync : drain de l'outbox (upsert par `id`), pull par curseur `updated_at`,
      backoff exponentiel, retry manuel depuis l'indicateur du header
- [x] Indicateur d'état de sync dans le header : synchronisé / en cours / hors-ligne / erreur
- [x] Création du `teamId` à l'inscription

Écarts par rapport au plan initial, tous documentés dans le journal :

- **`?mode=reset-password` n'existe pas.** `detectSessionInUrl` lit le **fragment**
  d'URL (`#access_token=…`), que Supabase utilise pour éviter que le lien fuite
  dans les journaux serveur et l'historique. Le paramètre de query n'aurait jamais
  été lu. La détection se fait donc sur l'événement `PASSWORD_RECOVERY`.
- **L'écran d'authentification vit dans `AuthGate`, pas dans la page `/`.**
  `output: 'export'` interdit tout verrouillage côté serveur : le seul endroit
  exhaustif est le composant racine. Un garde posé page par page laisserait passer
  la suivante.
- **Un état `unconfigured` s'ajoute à `signed-out`.** Sans variables
  d'environnement, l'app reste utilisable en local au lieu d'afficher une page
  blanche, et l'écran explique quoi poser.
- **Un état « appareil rattaché à un autre compte » s'ajoute.** Refuser est la
  seule option qui ne casse rien : céder l_teamId donnerait au second compte les
  matchs du premier, et les RLS retireraient au premier l'accès aux siens.
- **La table `side` manquait au plan** pour les rebonds — ajoutée au SQL, le
  domaine s'en servait déjà.

---

### Phase 6b — Données orphelines

**Durée** : ~0,25 jour · **Statut** : ✅ Terminée

Objectif : ne jamais perdre de données, y compris dans le cas de figure où l'app est utilisée
avant que l'auth soit configurée.

Tâches :

- [x] Au premier login, associer les données locales existantes au `teamId` créé côté cloud
- [x] Upload de l'outbox accumulée avant login
- [x] Test de non-régression : données créées hors-ligne → login → toutes présentes dans le cloud

Écart : le `teamId` ne peut pas rester `"local"`. C'est une constante, identique
sur tous les appareils, et la colonne `teams.id` est un `uuid` : le premier compte
inscrit verrait ses lignes rejetées par la clé primaire dès que quelqu'un
d'autre s'inscrirait. `claimTeam()` donne donc à l'équipe un `uuid` et réécrit
`teamId` sur les joueurs et les matchs **dans la même transaction** — et supprime
l'entrée d'outbox de l'ancienne équipe, qui échouerait à chaque cycle sinon.

---

### Phase 7 — PWA et robustesse

**Durée** : ~1 jour · **Statut** : ✅ Terminée

Objectif : le mode hors-ligne est garanti, pas supposé.

Tâches :

- [x] `app/manifest.json` : nom, `display: standalone`, `orientation: portrait`,
      `theme_color`, icônes 192 / 512 + version maskable
- [x] Icônes générées (192, 512, maskable, favicon) — pas de placeholder
- [x] Script post-build : parcourt `out/` et génère `sw-precache-manifest.json`
- [x] `public/sw.js` : `cache-first` sur les assets hashés, `network-first` + fallback sur les
      navigations, `skipWaiting` + `clientsClaim`, purge des anciens caches à l'activation
- [x] Page `/~offline` de fallback
- [x] **Test d'offline réel** : build de prod, mode avion, rechargement complet, match en cours
      toujours là
- [x] Prompts d'installation iOS (non supporté par l'API) et Android
- [x] En-têtes Nginx pour Coolify : `sw.js` et `manifest.json` en `no-cache`,
      assets hashés en `immutable`
- [x] Audit des cibles tactiles (≥ 44 px mini, ≥ 88 px actions principales) et des contrastes

Écarts par rapport au plan, tous documentés dans le journal :

- **Les icônes sont générées par un script sans dépendance** (`scripts/make-icons.mjs`),
  et régénérées à chaque `pnpm build` — ImageMagick ou `sharp` ne donnent pas le
  même résultat selon la plateforme, donc le même code produirait trois icônes
  différentes sur trois machines.
- **Les pages HTML sont précachées**, ce qui n'est pas un service worker classique.
  `output: 'export'` produit une page par route : sans elles, un rechargement
  hors-ligne n'a rien à afficher.
- **Chaque route est déclarée deux fois** dans le manifeste — fichier et chemin de
  dossier. `/match/` est servi par `/match/index.html` ; sans l'alias, le pré-cache
  serait complet et la page hors-ligne introuvable.
- **La page `/~offline` est la seule route hors `AuthGate`.** Elle doit
  s'afficher avant toute vérification — c'est-à-dire précisément quand il n'y a
  ni réseau ni session.
- **La révision du pré-cache est un hash des contenus, pas une date.** Avec une
  date, chaque déploiement viderait et retéléchargerait 1,7 Mo — en gymnase, sur la
  connexion qui est déjà le point faible.
- **L'audit tactile est automatisé** (`tests/e2e/a11y.spec.ts`), et il a trouvé ce
  qu'aucune relecture de CSS ne voit : `min-h-tap-min` garantit la hauteur, jamais
  la largeur.

---

### Phase 8 — Finition

**Durée** : ~0,5 jour · **Statut** : ✅ Terminée

Objectif : propre, documenté, prêt à déployer.

Tâches :

- [x] Smoke test Playwright : match complet de bout en bout
- [x] Budget de bundle vérifié au build
- [x] `README.md` : procédure de build, config Nginx, checklist dashboard Supabase, config Coolify
- [x] Relance complète : `pnpm typecheck && pnpm lint && pnpm test && pnpm build`

Notes :

- **Le budget de bundle échoue le build.** C'est le seul moyen qu'il serve à
  quelque chose : une régression arrive par un `import` oublié ou une mise à jour
  de dépendance, et personne ne la voit avant que le coach attende en gymnase.
- **La mesure porte sur le premier écran**, pas sur le total du build — c'est la
  seule métrique qui dise ce que le téléphone attend réellement.
- **Le smoke test est un test d'enchaînement**, pas un test plus long. Les tests
  fins de `match.spec.ts` passent sur une application dont le parcours global est
  cassé, et l'inverse.

---

## 7. État actuel

|                         |                                                                         |
| ----------------------- | ----------------------------------------------------------------------- |
| **Phase courante**      | **Phase 8 — Finition · ✅ Terminée. Projet complet**                    |
| **Prochaine étape**     | Aucune. Déploiement et validation sur téléphone                         |
| **Dernière action**     | 563 tests + 19 E2E · `pnpm verify` au vert · couverture 98,24 % lignes  |
| **Phases terminées**    | Phase 0 à Phase 8. **Toutes les portes levées**                         |
| **Porte de validation** | ✅ Levée — test sur téléphone via l'URL déployée, pas de retour négatif |
| **Blocage**             | Aucun côté code                                                         |
| **Prochaine phase**     | Aucune                                                                  |

### Ce qui reste à faire, hors code

Trois points, aucun n'est un développement. Ils exigent un téléphone et un
projet Supabase réel, donc aucun test automatisé ne les remplace.

1. **Exécuter `supabase/schema.sql`** dans le dashboard — le bloc `grant` compris.
2. **Vérifier la synchronisation pour de vrai** : créer un compte, saisir un
   match, voir le voyant passer de « n en attente » à « synchronisé », puis
   recontrôler depuis un autre appareil que les données sont là.
3. **Installer depuis l'écran d'accueil** sur iPhone et sur Android, et confirmer
   que l'app s'ouvre en plein écran et fonctionne en mode avion.

### Fichiers créés en Phase 8

```
scripts/check-bundle.mjs               budget de bundle, échoue le build si dépassé
tests/e2e/smoke.spec.ts                un match complet, de la création à la relecture
browserslist (package.json)            cibles réelles, plus de polyfills core-js inutiles
```

### Vérifications effectuées en fin de Phase 8

- `pnpm verify` → au vert, 6 routes `(Static)`, budget respecté
- `pnpm test` → 563 tests · `pnpm e2e` → 19 tests Playwright
- `pnpm test:coverage` → 98,24 % lignes · 96,73 % stmts · 90,29 % branches
- `pnpm format:check` → conforme
- **Poids du premier écran : 377,7 ko gzippés**, budget 400 ko. JS total 408 ko,
  budget 500 ko.
- `README.md` réorganisé : build, budget, déploiement Coolify, Nginx, checklist
  Supabase, test hors-ligne, installation.

### Fichiers créés en Phase 7

```
src/app/manifest.json                 nom, standalone, portrait, 3 icônes dont une maskable
src/app/~offline/page.tsx             repli hors-ligne, statique, hors AuthGate
src/features/pwa/ServiceWorkerRegistrar.tsx   un seul enregistrement, production seulement
src/features/pwa/InstallPrompt.tsx    dialogue natif sur Android, marche à suivre sur iOS
public/sw.js                          cache-first assets, network-first navigations
scripts/make-icons.mjs                PNG + ICO écrits à la main, sans dépendance
scripts/make-precache-manifest.mjs    parcourt out/, révision = hash des contenus
deploy/nginx.conf                     en-têtes de cache et CSP pour Coolify
tests/e2e/offline.spec.ts             2 tests : coupure réseau, rechargement, saisie
tests/e2e/a11y.spec.ts                7 tests : cibles tactiles et contraste AA mesurés
tests/scripts/precache.test.ts        10 tests du manifeste de pré-cache
tests/features/pwa.test.tsx           17 tests des composants PWA
```

### Vérifications effectuées en fin de Phase 7

- `pnpm verify` → au vert, 6 routes `(Static)`
- `pnpm test` → 563 tests passés
- `pnpm test:coverage` → global 98,24 % lignes · 96,73 % stmts · 90,42 % branches
- `pnpm e2e` → 18 tests Playwright au vert, dont 2 hors-ligne et 7 d'accessibilité
- `pnpm format:check` → conforme
- **Test d'offline réel automatisé** : réseau coupé, rechargement, match en cours
  retrouvé avec son score, saisie hors-ligne persistée après un second
  rechargement. C'est la porte de validation de la phase, et elle est **fermée**.
- ⏳ **Non vérifié sur téléphone réel** : l'installation depuis l'écran d'accueil,
  le `WakeLock` en cours de partie et les en-têtes Nginx en production.

### Fichiers créés en Phase 6

```
supabase/schema.sql                  4 tables + registre outbox + index + RLS, idempotent
src/sync/supabase-client.ts          config auth §5, client paresseux, lecture d'env testée
src/sync/remote.ts                   interface étroite + adaptation de supabase-js, testable sans réseau
src/sync/mapping.ts                  camelCase ↔ snake_case, le seul endroit de conversion
src/sync/engine.ts                   drain de l'outbox, tirage par curseur, backoff, cycle 30 s
src/sync/claim.ts                    rattachement des données locales au compte (phase 6b)
src/features/auth/store.ts           session, signIn/signUp/signOut, traduction des erreurs
src/features/auth/AuthScreen.tsx     connexion, inscription, mot de passe oublié, récupération
src/features/auth/AuthGate.tsx       garde-fou : bloque toutes les routes sans session
src/features/sync/useSyncStatus.ts   useSyncExternalStore sur l'état du moteur
src/features/sync/SyncIndicator.tsx  voyant du header, retry manuel au tap
tests/sync/{mapping,remote,engine,claim}.test.ts   74 tests du moteur et de ses frontières
tests/e2e/auth.ts                    session factice amorcée, réseau Supabase coupé
```

### Vérifications effectuées en fin de Phase 6

- `pnpm verify` → au vert, 5 routes `(Static)`
- `pnpm test` → 536 tests passés
- `pnpm test:coverage` → global 98,33 % lignes · 97,08 % stmts · 96,49 % fonctions
- `pnpm e2e` → 9 tests Playwright au vert, dont 2 sur le garde-fou d'accès
- `pnpm format:check` → conforme
- ⏳ **Non vérifié contre un vrai projet Supabase** : SQL non exécuté, sync non
  testée en conditions réelles. C'est le premier pas de la phase suivante.

### Fichiers créés en Phase 5

```
src/features/history/useHistoryData.ts   tous les matchs de l'équipe, répartis terminés / en cours
src/features/stats/useCumulativeData.ts  hook de cumul + COLUMNS + sortAndFilter() pur
src/features/stats/useToastStore.ts     acquittement de l'export, store Zustand isolé
src/app/history/page.tsx                liste + détail (?m=<uuid>) + sélecteur de période
src/app/stats/page.tsx                  tableau triable, bascule Totaux / Par match, filtre, CSV
tests/features/stats.test.tsx           26 tests — cohérence moyennes, tri, filtre, export CSV
tests/features/history.test.tsx         4 tests — répartition et tri des matchs
```

### Vérifications effectuées en fin de Phase 5

- `pnpm verify` → au vert, 4 routes `(Static)`
- `pnpm test` → 424 tests passés
- `pnpm test:coverage` → global 98,56 % lignes · 97,55 % stmts · 96,95 % fonctions
- `pnpm e2e` → 7 tests Playwright au vert (le parcours ne touche pas `/history` ni `/stats`,
  qui sont des écrans de consultation : ils ont leurs propres tests de logique)
- `pnpm format:check` → conforme

### Fichiers créés en Phase 4

```
src/domain/export.ts               matchToCsv() / matchToJson() purs, matchFilename(),
                                   activeActions() — zéro dépendance à IndexedDB
src/ui/download.ts                 downloadText() — Blob + lien éphémère, revoke différé
src/features/match/MatchSheet.tsx  feuille de match : score par période, % d'équipe,
                                   ligne par joueur, boutons d'export — réutilisable phase 5
src/features/match/FinishSheet.tsx confirmation de clôture : score, lancers dus, joueurs sortis
tests/domain/export.test.ts        24 tests — CSV (BOM, ;, CRLF, échappement, Total),
                                   JSON (score par période, actions annulées incluses)
tests/features/sheet.test.tsx      20 tests — feuille, export, clôture, réouverture
tests/e2e/match.spec.ts            7 tests Playwright — cycle complet sur le build statique
```

### Vérifications effectuées en fin de Phase 4

- `pnpm verify` (typecheck + lint + test + build) → au vert, 4 routes `(Static)`
- `pnpm test` → 394 tests passés
- `pnpm test:coverage` → global 98,54 % lignes · 97,65 % stmts · 96,85 % fonctions
- `pnpm e2e` → 7 tests Playwright au vert sur Chromium mobile, build servi depuis `out/`
- `pnpm format:check` → conforme

### Fichiers créés en Phase 3

```
src/features/match/store.ts            store Zustand : joueur verrouillé, période, sheet,
                                       record(), undoLast(), revision (force la relecture)
src/features/match/ActionGrid.tsx      grille 88px (2pts / 3pts / faute / LF) + bandeau stats avancées 44px
src/features/match/CombosBar.tsx       2P+F, 3P+F, R+F+2LF, R+F+3LF — un geste = une action
src/features/match/PlayerCarousel.tsx  carrousel joueurs + useMatchData (roster, stats de la période)
src/features/match/MatchHeader.tsx     période Q1-Q4, score, annulation, rappels de lancers
src/features/match/FreeThrowSheet.tsx  fiche 2-3 lancers, ✓ / ✗ par ballon
src/features/match/formatDate.ts       formatage des dates (isolé : 3 écrans l'utilisent)
src/ui/usePress.ts                     tap vs appui long 400 ms — implémenté UNE seule fois
src/ui/haptics.ts                      motifs de vibration distincts (réussi / raté / combo / undo)
src/ui/useWakeLock.ts                  écran allumé, réacquis à chaque retour de visibilité
src/ui/useAsyncData.ts                 lecture IndexedDB → état React
src/ui/Sheet.tsx                       feuille modale, pas de fermeture au clic sur le fond
src/ui/Toast.tsx                       annonce d'annulation, fenêtre de 4 s
src/ui/Badges.tsx                      pastilles de fautes + résumé live d'un joueur
src/app/new-match/page.tsx             date, adversaire, roster pré-coché, création rapide de joueur
src/app/page.tsx                       matchs non terminés + « Nouveau match »
src/app/match/page.tsx                 écran de saisie complet
tests/features/press.test.tsx          25 tests — le geste et ce qu'il écrit en base
tests/features/screens.test.tsx        47 tests — carrousel, header, fiche LF, Sheet, Toast, badges
```

### Vérifications effectuées en fin de Phase 3

- `pnpm verify` (typecheck + lint + test + build) → au vert, 4 routes `(Static)`
- `pnpm test` → 313 tests passés (239 en phase 2, 74 nouveaux)
- `pnpm test:coverage` → global 98,83 % lignes · 97,77 % stmts · 97,13 % fonctions · 94,34 %
  branches. `features/match` à 96,45 % lignes
- `pnpm format:check` → conforme
- `pnpm lint` → aucune erreur, aucun avertissement (règle `react-hooks/set-state-in-effect`
  incluse)

### Fichiers créés en Phase 2

```
src/data/ids.ts           newId() (UUID v4, repli getRandomValues), isUuid()
src/data/schema.ts        lignes persistées (… & Timestamped), V1_SCHEMA/V2_SCHEMA,
                          migrateV1ToV2(), SpaceBunnyDB, db()/setDb()
src/data/outbox.ts        OutboxEntry, enqueue(), peek(), ack(), fail(), pendingCount(),
                          outboxKey(), entryFor(), clear()
src/data/repositories.ts  TeamRepository, PlayerRepository, MatchRepository,
                          ActionRepository + implémentations Dexie, createRepositories(),
                          toTeam/toPlayer/toMatch/toAction, quartersOf()
src/data/index.ts         point d'entrée unique : dataDb(), repos(), setRepos()
tests/data/schema.test.ts       migration v1→2 réelle (base v1 créée à la main), index, idempotence
tests/data/repositories.test.ts CRUD complet, tri roster, seq atomique sous concurrence,
                          voidAction/voidGroup/undoLast, stats cohérentes après annulation
tests/data/outbox.test.ts       déduplication par ligne, conservation des échecs, tri du drain,
                              atomicité mutation+outbox
tests/data/index.test.ts        paresse des singletons, curseur de sync
tests/data/ids.test.ts          UUID v4 + repli Safari < 15.4
```

### Vérifications effectuées en fin de Phase 2

- `pnpm verify` (typecheck + lint + test + build) → au vert, 4 routes `(Static)`
- `pnpm test` → 239 tests passés (115 en phase 1, 124 nouveaux)
- `pnpm test:coverage` → `src/data` : 100 % lignes · 100 % fonctions · 99,59 % branches
- `pnpm format:check` → conforme
- Aucun import de React dans `src/data` ; le domaine reste importable sans IndexedDB

### Fichiers créés en Phase 1

```
src/domain/types.ts   schémas Zod Action/Match/Player/Team, Quarter, FOUL_LIMIT, isActive
src/domain/rules.ts   StatDelta, project(), combos.*, awardedFreeThrows(), planActions()
src/domain/stats.ts   PlayerStats, aggregate(), aggregateFor(), teamTotals(),
                      pointsByQuarter(), scoreForQuarters(), cumulativeStats(),
                      pendingFreeThrows(), percentages, formatage
src/domain/undo.ts    undoScope(), applyUndo(), voidActions(), redoHint(), activeCount()
tests/domain/rules.test.ts   80 tests — chaque ligne de la table §1 a un test nommé
tests/domain/undo.test.ts    35 tests — groupes, double-undo, cohérence undo/stats
```

### Vérifications effectuées en fin de Phase 1

- `pnpm verify` (typecheck + lint + test + build) → au vert, 4 routes `(Static)`
- `pnpm test` → 115 tests passés
- `pnpm test:coverage` → `src/domain` : 99,22 % stmts · 97,22 % branches · 100 % lignes
  (seuils configurés à 90 %, donc marge confortable)
- `pnpm format:check` → conforme
- Aucun import de React ni de Dexie dans `src/domain/` — le domaine est testable seul

### Fichiers créés en Phase 0

```
package.json          scripts verify/typecheck/test/coverage, deps phase 1-2 (dexie, zustand, zod)
next.config.ts        output:'export' + trailingSlash + images.unoptimized
tsconfig.json         strict durci (noUncheckedIndexedAccess, noUnusedLocals, noUnusedParameters)
vitest.config.ts      jsdom, alias @/*, seuils de couverture 90 %
playwright.config.ts  viewport Pixel 7, sert out/ en production
eslint.config.mjs     flat config + règles a11y tactiles
.env.example          documente les 2 variables Supabase attendues
.prettierrc.json      formatage
src/app/layout.tsx    metadata, viewport (themeColor, viewportFit, no zoom), lang=fr
src/app/globals.css   thème dark, tokens sémantiques, safe-area, tailles de cibles tactiles
src/app/page.tsx      accueil listant les 4 routes
src/app/{match,history,stats}/page.tsx   placeholders des 3 autres routes
tests/setup.ts        jest-dom, fake-indexeddb, stubs matchMedia + vibrate
tests/smoke.test.ts   vérifie que les tests tournent et que l'alias @/ résout
```

### Commandes utiles

```bash
pnpm dev          # serveur de dev
pnpm verify       # typecheck + lint + test + build  ← à lancer après chaque tâche
pnpm test:coverage  # couverture avec seuils 90 %
```

### Vérifications effectuées en fin de Phase 0

- `pnpm typecheck` → aucune erreur
- `pnpm lint` → aucune erreur
- `pnpm test` → 3 tests passés (jsdom + fake-indexeddb + alias @/)
- `pnpm format:check` → conforme
- `pnpm build` → Turbopack, 4 routes prérendues en `(Static)`, `out/` produit
- `out/index.html`, `out/match/index.html`, `out/history/index.html`, `out/stats/index.html`
  présents — compatible avec un hébergement statique sans règle de réécriture

---

## 8. Questions en attente de validation

Ces quatre points ont été signalés et attendent une réponse explicite. Le plan les applique dans
l'état en attendant ; toute réponse contraire déclenche une correction.

1. **Service worker artisanal plutôt que Serwist** — confirmé ?
   `output: 'export'` + Turbopack (défaut Next 16) est incompatible avec Serwist, qui imposerait
   `next build --webpack` et un plugin non validé sur Next 16.
2. **Règle non-FIBA sur le tir raté + faute** — le tir ne compte pas en FGA. Confirmé comme
   choix délibéré ?
3. **Verrouillage de l'app hors session** — pas de saisie de match sans compte. Confirmé ?
4. **SMTP** — l'écran « mot de passe oublié » est prévu mais ne fonctionnera pas tant qu'aucun
   SMTP n'est configuré. OK ?

---

## 9. Journal de bord

Une entrée par tâche ou groupe de tâches. Format : date · phase · quoi · résultat.

| Date       | Phase | Action                                                                              | Résultat                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------- | ----- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-05 | —     | Plan initial rédigé                                                                 | Stack et phases validées après questions                                                                                                                                                                                                                                                                                                                                                                |
| 2026-10-05 | —     | Passage d'OAuth Google à email + mot de passe Supabase                              | Confirmation email désactivée, zéro email au quotidien, session 30 j                                                                                                                                                                                                                                                                                                                                    |
| 2026-10-05 | 0     | `create-next-app` échoue (dossier `SpaceBunny` avec majuscules + pnpm absent)       | Scaffoldé dans un dossier temporaire, `pnpm` activé via corepack, tout déplacé                                                                                                                                                                                                                                                                                                                          |
| 2026-10-05 | 0     | `next.config.ts` : `output:'export'` + `trailingSlash`                              | Build statique confirmé, 4 routes prérendues                                                                                                                                                                                                                                                                                                                                                            |
| 2026-10-05 | 0     | `tsconfig.json` durci                                                               | `noUncheckedIndexedAccess` etc. pour sécuriser les unions discriminées du domaine                                                                                                                                                                                                                                                                                                                       |
| 2026-10-05 | 0     | Thème dark + tokens tactiles dans `globals.css`                                     | Cibles 44/88px, safe-area, `dvh`, police système (pas de font réseau)                                                                                                                                                                                                                                                                                                                                   |
| 2026-10-05 | 0     | Vitest + ESLint + Prettier + Playwright configurés                                  | Seuils couverture 90 %, règles a11y tactiles                                                                                                                                                                                                                                                                                                                                                            |
| 2026-10-05 | 0     | `pnpm verify`                                                                       | ✅ typecheck + lint + test + build au vert, `out/` produit                                                                                                                                                                                                                                                                                                                                              |
| 2026-10-05 | 0     | `git init` + commit                                                                 | ❌ bloqué : licence Xcode non acceptée (`sudo xcodebuild -license`)                                                                                                                                                                                                                                                                                                                                     |
| 2026-10-05 | 1     | `src/domain/types.ts` — schémas Zod                                                 | `Action` validé au-delà des types : un tir sans `value`/`made`, une période hors 1-4, et `fouled` sur une faute simple sont **rejetés**. Ce dernier garde-fou empêche le double comptage de faute                                                                                                                                                                                                       |
| 2026-10-05 | 1     | `src/domain/rules.ts` — `project()` + `combos.*`                                    | Règle non-FIBA isolée dans `projectShot()`, documentée et testée séparément                                                                                                                                                                                                                                                                                                                             |
| 2026-10-05 | 1     | 🔴 Correction : double comptage des FTA                                             | `+2 FTA` sur le tir fouillé **plus** `+1` par lancer saisi = 4 FTA pour une série de 2. Corrigé : le tir fouillé ne compte que `+1 faute`, `awardedFreeThrows()` renvoie le nombre de lancers dus                                                                                                                                                                                                       |
| 2026-10-05 | 1     | 🔴 Correction : `madeAndFouled` créait une faute en double                          | Une action `foul` séparée s'ajoutait à la faute déjà portée par le `shot`. Le combo ne crée plus qu'**une** action                                                                                                                                                                                                                                                                                      |
| 2026-10-05 | 1     | 🟡 Suppression de `includeVoided`                                                   | `project()` neutralise toujours les actions annulées : le filtre n'aurait eu aucun effet. Retiré plutôt que laissé en place ; `actionsOfMatch()` est le seul moyen de les lire                                                                                                                                                                                                                          |
| 2026-10-05 | 1     | `ActionDraft` en union discriminée                                                  | Champs obligatoires garantis par le type : impossible de compiler un rebond sans `side`. Erreurs à la compilation, pas à l'exécution                                                                                                                                                                                                                                                                    |
| 2026-10-05 | 1     | `src/domain/stats.ts` — agrégats                                                    | `aggregate`, `cumulativeStats`, `pointsByQuarter`, `pendingFreeThrows` (appariement séquentiel par joueur, pas de décompte global)                                                                                                                                                                                                                                                                      |
| 2026-10-05 | 1     | `src/domain/undo.ts` — annulation groupée                                           | `undoScope` + `applyUndo`, fonctions pures. `redoHint` prépare l'affichage « Réfaire : … » du toast                                                                                                                                                                                                                                                                                                     |
| 2026-10-05 | 1     | 🔴 Correction : `applyUndo` perdait des actions                                     | Renvoyait le périmètre annulé au lieu de la liste complète, faisant disparaître les actions non concernées. Corrigé, testé par `activeCount`                                                                                                                                                                                                                                                            |
| 2026-10-05 | 1     | 2 fixtures de test fautives corrigées                                               | `combos.missed(..., 1)` passait `value: 1` (ni 2 ni 3) ; un `matchId` réétiqueté par index dispersait les joueurs sur les 3 matchs                                                                                                                                                                                                                                                                      |
| 2026-10-05 | 1     | `tsconfig.json` : ajout de `vitest/globals`                                         | `describe`/`it`/`expect` n'étaient pas typés                                                                                                                                                                                                                                                                                                                                                            |
| 2026-10-05 | 1     | Installation de `@vitest/coverage-v8`                                               | `pnpm test:coverage` échouait sur une dépendance manquante                                                                                                                                                                                                                                                                                                                                              |
| 2026-10-05 | 1     | Prettier : `semi: true`                                                             | Le formatage initial avait retiré les points-virgules du code généré                                                                                                                                                                                                                                                                                                                                    |
| 2026-10-05 | 1     | `pnpm verify` + couverture                                                          | ✅ 115 tests · domaine 99,22 % stmts, 97,22 % branches, 100 % lignes                                                                                                                                                                                                                                                                                                                                    |
| 2026-10-05 | 2     | `src/data/ids.ts` — `newId()`                                                       | UUID v4 via `crypto.randomUUID`, repli `getRandomValues` pour Safari < 15.4. L'`id` est généré **avant** l'écriture locale : c'est la clé de dédupe de la sync et il doit exister dès le geste du coach                                                                                                                                                                                                 |
| 2026-10-05 | 2     | `src/data/schema.ts` — schéma Dexie v1/v2                                           | Colonnes `updatedAt` (curseur de tirage descendant), index `voidedAt`, `updatedAt`, `[entity+entityId]` sur l'outbox. `V1_SCHEMA` conservé tel quel : le modifier ferait échouer la vérification de l'upgrade                                                                                                                                                                                           |
| 2026-10-05 | 2     | `migrateV1ToV2()` — repli `updatedAt = 0`                                           | `0` et non `Date.now()` : le premier tirage descendant doit rattraper les lignes préexistantes, sinon des matchs saisis avant la mise à jour resteraient invisibles côté serveur, définitivement                                                                                                                                                                                                        |
| 2026-10-05 | 2     | 🔴 `groupId` non indexé sur `actions`                                               | `voidGroup()` — donc l'annulation groupée d'un `2P+F` — imposait un parcours complet de la table. Ajouté à v2 ; un test échouait franchement (`KeyPath groupId on object store actions is not indexed`)                                                                                                                                                                                                 |
| 2026-10-05 | 2     | `src/data/outbox.ts` — une entrée par ligne                                         | Clé primaire déterministe `entity:entityId`. Créer puis annuler remplace l'entrée au lieu de l'accumuler : le cloud ne fait que des upserts, le dernier état suffit                                                                                                                                                                                                                                     |
| 2026-10-05 | 2     | `attempts`/`lastError` conservés au remplacement d'entrée                           | Sinon chaque nouvelle action locale remettait le backoff à zéro — une mutation locale ne rend pas un serveur injoignable joignable                                                                                                                                                                                                                                                                      |
| 2026-10-05 | 2     | `src/data/repositories.ts` — 4 interfaces + implémentations Dexie                   | `append()` attribue `seq` et `id` : impossible d'écrire deux actions de même `seq` lors d'un appui rapide ou d'un double rendu React. `undoLast()` délègue le périmètre à `undoScope()` du domaine                                                                                                                                                                                                      |
| 2026-10-05 | 2     | `nextSeq()` atomique par sérialisation Dexie                                        | Lecture-modification-écriture dans une transaction `rw` unique, sans verrou à écrire. Vérifié par 10 `append()` concurrents → `seq` 0..9 sans doublon                                                                                                                                                                                                                                                   |
| 2026-10-05 | 2     | `lastSeqIn()` via l'index composé `[matchId+seq]`                                   | O(log n) au lieu de O(n) : un match peut compter plusieurs centaines d'événements et on écrit à chaque appui                                                                                                                                                                                                                                                                                            |
| 2026-10-05 | 2     | Validation Zod **avant** écriture                                                   | Une ligne invalide est rejetée avant d'atteindre IndexedDB. Un combo au second draft invalide ne laisse aucune ligne ni entrée d'outbox derrière lui                                                                                                                                                                                                                                                    |
| 2026-10-05 | 2     | `src/data/index.ts` — point d'entrée unique                                         | Les composants obtiennent des repositories, jamais une base. `db()` paresseux : `output: 'export'` prerend dans un Node sans `indexedDB`                                                                                                                                                                                                                                                                |
| 2026-10-05 | 2     | Suppression de `createTestDb()`                                                     | Ne faisait que déléguer au constructeur ; les tests construisent `new SpaceBunnyDb(nom unique)` en direct. `db.ts` fusionné dans `schema.ts`                                                                                                                                                                                                                                                            |
| 2026-10-05 | 2     | Tests : base v1 créée à la main                                                     | `LegacyV1Db` reproduit un upgrade réel — `Dexie.verno` ne permettant pas de le simuler autrement. Vérifie colonnes, valeurs, idempotence et utilité du curseur après migration                                                                                                                                                                                                                          |
| 2026-10-05 | 2     | Test : stats cohérentes après annulation                                            | L'annulation relue **depuis la base** (pas depuis l'objet renvoyé) doit déjà avoir disparaître l'action des points — c'est ce que verra l'écran de saisie                                                                                                                                                                                                                                               |
| 2026-10-05 | 2     | `pnpm verify` + couverture                                                          | ✅ 239 tests · `src/data` 100 % lignes / 100 % fonctions / 99,59 % branches                                                                                                                                                                                                                                                                                                                             |
| 2026-10-05 | 3     | `src/domain/types.ts` — `playerIds` sur `Match`                                     | Manque du **modèle**, pas de l'écran : sans roster par match, un joueur arrivé en cours de saison apparaît dans les feuilles de match où il n'a pas joué, avec des zéros                                                                                                                                                                                                                                |
| 2026-10-05 | 3     | Migration v2 → v3 (`playerIds: []`)                                                 | Roster **vide** et non le roster actuel : attribuer les joueurs d'aujourd'hui à un match d'il y a trois mois donnerait l'illusion qu'ils y ont joué                                                                                                                                                                                                                                                     |
| 2026-10-05 | 3     | `src/features/match/store.ts` — Zustand                                             | Volatile par construction : joueur verrouillé, période, sheet. Toute donnée de saisie qui vivrait ici serait perdue au rechargement PWA, ce que la phase 7 ne pourra pas rattraper                                                                                                                                                                                                                      |
| 2026-10-05 | 3     | `src/ui/usePress.ts` — tap vs appui long                                            | Implémenté **une seule fois** dans tout le projet. L'appui long annule le tap : sans ça, un appui de 600 ms compterait un panier _et_ un raté                                                                                                                                                                                                                                                           |
| 2026-10-05 | 3     | 🔴 Bug : tap sur relâchement sans appui                                             | `onPointerUp` appelait `onTap` sans vérifier qu'un `pointerdown` avait eu lieu. Un second doigt posé et levé vite créait une action fantôme. Corrigé par un `pressing` en ref                                                                                                                                                                                                                           |
| 2026-10-05 | 3     | 🔴 jsdom n'implémente pas `PointerEvent`                                            | React 19 n'abonne pas `pointerdown` sans ce global : les tests d'appui long échouaient sans raison. Un alias `MouseEvent` ne suffisait pas — `isPrimary` n'existe pas sur `MouseEvent`, le hook ignorait donc **tous** les appuis. Polyfill qui recopie `pointerId`/`pointerType`/`isPrimary`/`pressure`                                                                                                |
| 2026-10-05 | 3     | 🔴 La période existait en double source                                             | Store d'un côté, prop de l'autre. Le test enregistrait un tir en Q1 pendant que le composant affichait Q2. Le store est désormais l'unique source ; `ActionGrid` et `CombosBar` le lisent                                                                                                                                                                                                               |
| 2026-10-05 | 3     | `combos.*` abandonnés par la grille                                                 | Ils exigent un `groupId` non vide ; un geste simple n'a pas de groupe, le store en crée un par écriture. Un `groupId: ""` a été essayé et **rejeté par la validation Zod** — le garde-fou a fait son travail                                                                                                                                                                                            |
| 2026-10-05 | 3     | `CombosBar` relit `awardedFreeThrows` sur l'action écrite                           | Jamais déduit du bouton pressé : si la règle métier change, la fiche affiche le bon nombre sans qu'un bouton soit touché                                                                                                                                                                                                                                                                                |
| 2026-10-05 | 3     | `useAsyncData` — `loading` ne repasse jamais à `true`                               | Choix d'ergonomie : après un tir le carrousel doit garder les stats précédentes pendant la relecture. Un « Chargement… » clignotant à chaque panier rendrait l'écran illisible en gymnase                                                                                                                                                                                                               |
| 2026-10-05 | 3     | `Sheet` ne se ferme pas au clic sur le fond                                         | Une annulation accidentelle ferait perdre un combo entier, et le coach ne le verrait pas tout de suite                                                                                                                                                                                                                                                                                                  |
| 2026-10-05 | 3     | `Bouton.tsx` supprimé                                                               | Chaque cible de la grille a son propre état pressé via `usePress`, qu'un bouton générique ne peut pas exposer                                                                                                                                                                                                                                                                                           |
| 2026-10-05 | 3     | `pnpm verify` + couverture                                                          | ✅ 313 tests · global 98,83 % lignes, 97,77 % stmts, 97,13 % fonctions, 94,34 % branches                                                                                                                                                                                                                                                                                                                |
| 2026-10-05 | 3     | `scripts/serve.mjs` + procédure de test local dans README                           | Serveur statique sans dépendance, en-têtes `no-cache`/`immutable` comme Nginx de la phase 7, HTTPS optionnel. Safari refuse IndexedDB en HTTP : un test réussi sur Android ne prouve rien sur iOS                                                                                                                                                                                                       |
| 2026-10-05 | 3     | 🔴 `PlayerSchema` exigeait prénom et nom                                            | « Dupont » seul était rejeté, et sans `catch` dans l'UI l'échec était une promesse rejetée sans message — le bouton paraissait mort. `firstName` peut désormais être vide, `lastName` porte l'identité. `playerLabel`/`playerShortName`/`playerInitial` gèrent la forme sans prénom, sans espace parasite                                                                                               |
| 2026-10-05 | 3     | 🔴 Texte des `<input>` invisible                                                    | La couleur vient de la feuille de l'agent utilisateur, pas du `body` : Tailwind v4 ne réinitialise pas cette propriété. Du texte noir sur fond sombre. Corrigé par une classe commune avec `text-primary` explicite                                                                                                                                                                                     |
| 2026-10-05 | 3     | 🔴 Un tir raté était invisible à l'écran                                            | Il ne changeait ni le score, ni les points du joueur, ni les pastilles — le seul compteur modifié, `fga`, n'était affiché nulle part. Corrigé deux fois : tirs affichés en `réussis/tentés` dans le carrousel, et bannière d'acquittement de 1,1 s nommant l'action                                                                                                                                     |
| 2026-10-05 | 3     | `describeAction()` dans le domaine                                                  | Le vocabulaire vient du domaine, pas des composants : « Panneau 3 pts + faute », « LF raté ». L'UI ne réinvente pas son lexique, et le fil du match de la phase 4 en héritera tel quel                                                                                                                                                                                                                  |
| 2026-10-05 | 3     | 🟡 Écart au plan : FAUTE bloqué à 5 fautes                                          | Décision du commanditaire, le plan §1 disait « pas d'élimination ». Bouton désactivé, compteur affiché, libellé expliquant le blocage. Les autres cibles restent actives                                                                                                                                                                                                                                |
| 2026-10-05 | 3     | 🔴 `awardedFreeThrows()` ignorait l'and-1                                           | Ne renvoyait quelque chose que pour un tir **raté** : `2P+F` n'ouvrait aucune fiche et `pendingFreeThrows()` ne signalait jamais le lancer dû. Désormais 1 lancer après un panier, 2 ou 3 après un tir raté selon sa valeur. Le `undo` d'un and-1 retire panier + faute + lancer d'un bloc                                                                                                              |
| 2026-10-05 | 3     | `usePress` — bouton désactivé n'enregistre rien                                     | Les navigateurs ne dispatchent pas de pointer events sur un `disabled`, mais s'y fier laissait la garantie dépendre du navigateur. Vérification de `currentTarget.disabled` dans le hook, central pour tous les appelants                                                                                                                                                                               |
| 2026-10-05 | 3     | `pnpm verify` + couverture                                                          | ✅ 346 tests · global 98,71 % lignes · validé en local par le commanditaire                                                                                                                                                                                                                                                                                                                             |
| 2026-10-05 | 4     | `src/domain/export.ts` — CSV et JSON purs                                           | Sans dépendance à IndexedDB : testable sans base, réutilisable depuis un tirage cloud. CSV calibré pour Excel FR — séparateur `;`, BOM UTF-8, CRLF ; un CSV à virgules s'ouvre en une seule colonne et le coach ne saura jamais pourquoi                                                                                                                                                                |
| 2026-10-05 | 4     | 🔴 `aggregateFor(actions, "team")` valait zéro                                      | La fonction filtre par `playerId` : une équipe fictive n'a aucune action. Le pourcentage d'équipe restait à « — » jusqu'au premier panier. Corrigé via `teamTotals`, attrapé par le test et non par le type                                                                                                                                                                                             |
| 2026-10-05 | 4     | Clôture verrouillée **dans** la transaction                                         | `append()` refuse un match terminé. Un écran resté ouvert ne peut pas écrire dans une feuille déjà lue — sinon les stats exportées divergent silencieusement. La correction passe par « rouvrir », jamais par un contournement                                                                                                                                                                          |
| 2026-10-05 | 4     | Fiche de clôture : lancers dus affichés avant confirmation                          | Un lancer oublié découvert après clôture oblige à rouvrir, resaisir, refermer. La fiche compte `pendingFreeThrows()` et l'affiche — le seul écart réparable avant le point de non-retour                                                                                                                                                                                                                |
| 2026-10-05 | 4     | `refresh()` dans le store                                                           | La clôture n'écrit pas via `record()` : sans action dédiée, l'écran ne se rafraîchit pas ou doit répliquer l'écriture étrangère. L'état « fini » est dérivé de `match.status`, jamais stocké                                                                                                                                                                                                            |
| 2026-10-05 | 4     | 🔴 E2E : l'écran de match terminé n'avait aucune sortie                             | La barre de saisie disparaît, il ne restait que le bouton retour du navigateur — invisible sur une PWA installée. Le coach était piégé sur la feuille. Ajouté « ‹ Accueil ». C'est exactement ce qu'un smoke test de parcours doit attraper                                                                                                                                                             |
| 2026-10-05 | 4     | Playwright : `scripts/serve.mjs` remplace `npx --yes serve`                         | Mêmes en-têtes de cache que la production (phase 7), aucun téléchargement de paquet au premier lancement. `pnpm e2e:full` enchaîne build puis test — un E2E sur un build périmé est un faux positif                                                                                                                                                                                                     |
| 2026-10-05 | 4     | `pnpm verify` + E2E + couverture                                                    | ✅ 394 tests · 7 E2E Chromium mobile · global 98,54 % lignes                                                                                                                                                                                                                                                                                                                                            |
| 2026-10-06 | 5     | `listByMatches()` dans le repository                                                | Un `anyOf` sur l'index `matchId` au lieu d'une lecture par match : vingt requêtes pour une saison, réduites à une. La méthode était identifiée comme manquante dès la phase 2 et était écrite pour ce besoin                                                                                                                                                                                            |
| 2026-10-06 | 5     | `pnpm verify` + E2E + couverture                                                    | ✅ 424 tests · 7 E2E Chromium mobile · global 98,56 % lignes                                                                                                                                                                                                                                                                                                                                            |
| 2026-10-06 | 5     | `listByMatches()` dans le repository                                                | Un `anyOf` sur l'index `matchId` au lieu d'une lecture par match : vingt requêtes pour une saisonICC réduire à une. La méthode était identifiée comme manquante dès la phase 2, elle était écrite pour ce besoin                                                                                                                                                                                        |
| 2026-10-06 | 3     | ✅ Porte de validation levée                                                        | Test sur téléphone via l'URL déployée, OK. L'accès par IP locale échouait (pare-feu macOS et/ou bail DHCP renouvelé — l'IP a changé de .106 à .155 en cours de session) ; le déploiement HTTPS rend la question sans objet et confirme en négatif que Safari refuse IndexedDB hors contexte sécurisé                                                                                                    |
| 2026-10-06 | 4     | 🔴 Coolify : `ERROR packages field missing or empty`                                | `pnpm-workspace.yaml` ne contenait qu'un bloc `allowBuilds`, sans `packages`. pnpm 12 (version locale) l'accepte, pnpm 9 non. Le build de production ne pouvait donc pas fonctionner avec la version de pnpm choisie par défaut sur le serveur                                                                                                                                                          |
| 2026-10-06 | 4     | `packageManager: pnpm@12.9.1` + `packages: [""."]`                                  | Deux couches indépendantes. (1) La version est épinglée : le build utilise le même pnpm que les tests, `--frozen-lockfile` garde son sens. (2) `packages: ["."]` rend le fichier workspace lisible par pnpm 9 **et** 12 : le build survit même si la version épinglée est ignorée                                                                                                                       |
| 2026-10-06 | 4     | `start`: `node scripts/serve.mjs`                                                   | Railpack annonçait « No start command detected ». `next start` est incompatible avec `output: 'export'`. Réutiliser le serveur statique déjà testé : zéro dépendance, et il lit `PORT`/`HOST` comme le fait Coolify                                                                                                                                                                                     |
| 2026-10-06 | 6     | `supabase/schema.sql` — tables, index, RLS                                          | Idempotent (`create table if not exists`, politiques remplacées). Horodatages en `bigint` et non `timestamptz` : le domaine travaille en `Date.now()`, et le last-write-wins des annulations compare deux `updated_at` — cette comparaison doit être exacte                                                                                                                                             |
| 2026-10-06 | 6     | 🔴 La table `actions` a **`for all`**, pas `for select`                             | Une politique `for select` seule laisse écrire à quiconque. C'est l'erreur classique et elle est invisible tant que personne n'a inséré de données                                                                                                                                                                                                                                                      |
| 2026-10-06 | 6     | `outbox` serveur alimenté par déclencheur, pas par le client                        | Le client n'émet que des upserts, il ne distingue donc pas une création d'une annulation. Une ligne manquante dans le registre signifierait une écriture non tracée                                                                                                                                                                                                                                     |
| 2026-10-06 | 6     | `src/sync/remote.ts` — interface étroite autour de `supabase-js`                    | `supabase-js` est typé via un type `Database` généré que le projet n'a pas ; sans cette adaptation, les réponses remontent en `any` jusqu'aux repositories. Elle rend aussi le moteur testable sans réseau, qui est son environnement normal                                                                                                                                                            |
| 2026-10-06 | 6     | 🔴 Curseur de tirage **par table**, pas global                                      | Un curseur unique serait faux : un match écrit à T+1000 ferait sauter une action écrite à T+500 jamais connue du cloud. Un `syncState` par entité, et une boucle qui draine les pages                                                                                                                                                                                                                   |
| 2026-10-06 | 6     | Échec de poussée = échec **global**, rien n'acquitté                                | Le cloud ne fait que des upserts par `id` : renvoyer un lot déjà accepté ne crée pas de doublon. Le prix — un renvoi — est très inférieur au prix d'une perte                                                                                                                                                                                                                                           |
| 2026-10-06 | 6     | Écart au plan : `?mode=reset-password` remplacé par l'événement `PASSWORD_RECOVERY` | `detectSessionInUrl` lit le **fragment** d'URL (`#access_token=…`), que Supabase utilise pour éviter que le jeton fuite dans les journaux serveur et l'historique. Un query param n'aurait jamais été lu                                                                                                                                                                                                |
| 2026-10-06 | 6     | Écart au plan : le garde-fou est `AuthGate` dans `layout.tsx`                       | `output: 'export'` interdit middleware et route handler. Un garde posé page par page laisserait passer la suivante ; le composant racine est le seul endroit exhaustif                                                                                                                                                                                                                                  |
| 2026-10-06 | 6     | 🔴 `new-match` écrivait les joueurs sous `teamId: "local"`                          | Régression introduite par la phase 6 : `claimTeam()` donne un `uuid` à l'équipe. Le joueur ajouté par la forme rapide partait sous l'ancienne constante — invisible dans le roster affiché, absent de l'historique, jamais synchronisé. Trouvé par les tests E2E, pas par les unitaires                                                                                                                 |
| 2026-10-06 | 6     | État `unconfigured` ajouté à `signed-out`                                           | Sans variables d'environnement, l'app reste utilisable en local au lieu d'afficher une page blanche, et l'écran explique quoi poser. Les `NEXT_PUBLIC_*` étant figées au **build**, le message le dit                                                                                                                                                                                                   |
| 2026-10-06 | 6     | État « appareil rattaché à un autre compte » ajouté                                 | Céder l'équipe au second compte lui donnerait les matchs du premier, et les RLS retireraient au premier l'accès aux siens. Les deux pertes sont irréversibles : refuser est la seule option qui ne casse rien                                                                                                                                                                                           |
| 2026-10-06 | 6b    | `claimTeam()` réécrit `teamId` et supprime l'entrée d'outbox de l'ancienne équipe   | `LOCAL_TEAM_ID` est une constante, identique sur tous les appareils, et `teams.id` est un `uuid` : le second inscrit se ferait rejeter par la clé primaire. Laisser l'entrée obsolète en file enverrait un id non-uuid à chaque cycle, et l'échec bloquerait tout le lot                                                                                                                                |
| 2026-10-06 | 6     | `startSync()` : retour réseau, visibilité, cycle 30 s                               | Le téléphone sort du sac en pleine partie : attendre le timer alors que le signal est revenu serait absurde. Le retour réseau court-circuite le backoff                                                                                                                                                                                                                                                 |
| 2026-10-06 | 6     | Voyant : « erreur » l'emporte sur le compte d'attente                               | Une erreur est la seule situation qui demande une action. Un nombre d'attente la ferait passer inaperçue, et le coach ne verrait jamais pourquoi ses matchs ne remontent pas                                                                                                                                                                                                                            |
| 2026-10-06 | 6     | Tests E2E : session amorcée dans `localStorage`, réseau coupé                       | Un parcours E2E ne peut pas dépendre d'un vrai compte : il créerait un compte par exécution, écrirait dans la base de production et échouerait dès que le réseau manque. L'app démarre exactement comme en production                                                                                                                                                                                   |
| 2026-10-06 | 6     | `playwright.config.ts` charge `.env.local`                                          | `supabase-js` déduit sa clé de stockage du nom d'hôte de l'URL, figée au **build**. Sans la même valeur côté test, la session amorcée arrive sous une autre clé et l'app reste sur l'écran de connexion                                                                                                                                                                                                 |
| 2026-10-06 | 6     | `pnpm verify` + couverture + E2E                                                    | ✅ 536 tests · 9 E2E · global 98,33 % lignes, 97,08 % stmts, 96,49 % fonctions, 90,76 % branches. `src/sync` à 97 % lignes                                                                                                                                                                                                                                                                              |
| 2026-10-06 | 6     | ⏳ **Non vérifié contre un vrai projet**                                            | `supabase/schema.sql` n'a pas été exécuté, la sync n'a pas tourné en conditions réelles. Tout est validé par un faux client. La première vérification terrain est la création d'un compte sur le téléphone                                                                                                                                                                                              |
| 2026-10-06 | 7     | `scripts/make-icons.mjs` — PNG et ICO écrits à la main                              | Aucune dépendance : ImageMagick ou `sharp` ne donnent pas le même résultat selon la plateforme, donc le même code produirait trois icônes différentes sur trois machines. PNG = zlib + CRC-32 ; ICO = entrées PNG, ce qu'acceptent Windows et Safari depuis Vista / iOS 8                                                                                                                               |
| 2026-10-06 | 7     | Ballon dessiné **procéduralement**, trois coutures                                  | Un ballon de basket est un cercle, un fond et trois coutures : cela se calcule par pixel. Un SVG aurait exigé un moteur de rendu, donc une dépendance de plus. Première version : une seule couture verticale — les deux arcs sont symétriques et il en faut deux, sinon le tracé est asymétrique et visible sur une icône carrée                                                                       |
| 2026-10-06 | 7     | Les icônes sont régénérées à chaque `pnpm build`                                    | Sinon elles peuvent diverger du thème. La palette du script est donc **dupliquée** depuis `globals.css` plutôt que lue : le script ne doit pas dépendre de l'ordre de compilation CSS                                                                                                                                                                                                                   |
| 2026-10-06 | 7     | Le pré-cache inclut les **pages HTML**                                              | Contre-intuitif pour un service worker classique, mais `output: 'export'` produit une page par route : sans elles, un rechargement hors-ligne n'a rien à afficher et le pré-cache est « complet » alors que l'app ne démarre pas                                                                                                                                                                        |
| 2026-10-06 | 7     | Chaque route déclarée deux fois : `/match/index.html` et `/match/`                  | `trailingSlash: true` fait que le navigateur demande un chemin de dossier. Sans l'alias, le cache serait complet et la page hors-ligne introuvable — le symptôme le plus déroutant : « ça marche sur l'accueil, pas en plein match »                                                                                                                                                                    |
| 2026-10-06 | 7     | Le manifeste s'auto-exclut du pré-cache                                             | Sans cela, le fichier d'un build précédent entre dans le calcul de la révision du suivant, qui contient lui-même la révision : deux builds du même code donneraient deux valeurs, donc une réinstallation complète à chaque déploiement                                                                                                                                                                 |
| 2026-10-06 | 7     | Révision = hash des **contenus**, pas `Date.now()`                                  | Un déploiement sans changement ne doit pas forcer le coach à retélécharger 1,7 Mo — en gymnase, sur la connexion qui est déjà le point faible                                                                                                                                                                                                                                                           |
| 2026-10-06 | 7     | `cache.addAll` évité, `Promise.allSettled` à la place                               | `addAll` est **atomique** : si un seul fichier manque — un déploiement qui a retiré un vieux bundle — rien n'est mis en cache et l'app ne démarre jamais hors-ligne. Au pire on perd un fichier, jamais l'install                                                                                                                                                                                       |
| 2026-10-06 | 7     | 🔴 Supabase **exclu** de tout cache                                                 | Le cache est la déduction d'une réponse HTTP ; une session et un jeton ne se déduisent pas. Une ligne d'outbox servie depuis le cache serait vidée de sa file et jamais acquittée — donc perdue, définitivement, sans trace                                                                                                                                                                             |
| 2026-10-06 | 7     | `network-first` sur les navigations, et non `cache-first`                           | Chaque route est un HTML distinct : un `cache-first` servirait `/match/index.html` pour `/history/` — l'écran de saisie affiché à la place de l'historique. Le repli sur cache ne sert que quand le réseau manque, donc quand il n'y a pas d'alternative                                                                                                                                                |
| 2026-10-06 | 7     | `/~offline` est la seule route hors `AuthGate`                                      | Elle doit s'afficher avant toute vérification — donc quand il n'y a ni réseau ni session. Si elle dépendait d'IndexedDB ou d'une session, elle échouerait dans le seul cas où elle sert                                                                                                                                                                                                                 |
| 2026-10-06 | 7     | 🔴 `InstallPrompt` n'écoutait `beforeinstallprompt` que sur iOS                     | Testé, et invisible : l'événement ne se produit qu'une fois et rien ne le rejoue. Le coach n'aurait donc **jamais** vu le bouton « Installer » sur Android — le seul navigateur où un dialogue natif existe. L'écoute est maintenant inconditionnelle                                                                                                                                                   |
| 2026-10-06 | 7     | iOS détecté par moteur + points de contact, pas par l'agent utilisateur             | iPadOS 13+ se déclare comme un Mac : sans `maxTouchPoints`, l'écran d'installation ne se serait jamais affiché sur iPad. Tester `userAgent.includes("Safari")` exclurait à l'inverse Chrome sur iOS, qui peut installer nativement                                                                                                                                                                      |
| 2026-10-06 | 7     | 🔴 `--text-muted` ne tenait que 3,77:1 sur les cartes                               | Sous le seuil AA de 4,5:1. `#6b7688` → `#7b889c` : 4,82:1 sur une carte, 5,35:1 sur le fond, même teinte donc hiérarchie visuelle préservée. Constaté par un audit **mesuré**, pas par une relecture de CSS                                                                                                                                                                                             |
| 2026-10-06 | 7     | 🔴 Trois cibles tactiles sous 44 px                                                 | Le sélecteur de période (`w-8` = 32 px), et deux boutons de retour (`px-3` = 32 px). `min-h-tap-min` garantit la **hauteur**, jamais la largeur — la classe était présente, la cible ne l'était pas. Trouvé par mesure après rendu, pas par relecture                                                                                                                                                   |
| 2026-10-06 | 7     | L'audit tactile et contraste est automatisé                                         | Un test qui lit `getBoundingClientRect()` et calcule le ratio WCAG sur les couleurs rendues. Sans lui, la correction ci-dessus aurait été refaite au prochain bouton ajouté                                                                                                                                                                                                                             |
| 2026-10-06 | 7     | `sw.js` et `sw-precache-manifest.json` en `no-cache` sur Nginx                      | Le piège le plus coûteux du déploiement : `sw.js` en cache, c'est un worker qui se met à jour en arrière-plan mais ne s'exécute qu'au **prochain** chargement. Le coach passerait la saison sur une version antérieure, avec un pré-cache d'une autre version                                                                                                                                           |
| 2026-10-06 | 7     | **Test d'offline réel automatisé** (`tests/e2e/offline.spec.ts`)                    | Réseau coupé, rechargement, match en cours retrouvé **avec son score**, saisie hors-ligne persistée après un second rechargement. Le rechargement — et non un changement de route — est ce qui prouve que le HTML survit à un redémarrage du navigateur                                                                                                                                                 |
| 2026-10-06 | 7     | `pnpm verify` + couverture + E2E                                                    | ✅ 563 tests · 18 E2E · global 98,24 % lignes, 96,73 % stmts, 96,61 % fonctions, 90,42 % branches. **Porte de la phase 7 fermée par test automatisé**, plus seulement par test manuel                                                                                                                                                                                                                   |
| 2026-10-06 | 7     | ⏳ **Non vérifié sur téléphone réel**                                               | Installation depuis l'écran d'accueil, `WakeLock` en cours de partie, en-têtes Nginx en production. Ces trois points exigent un iPhone ou un Android et un déploiement Coolify — aucun test automatisé ne les remplace                                                                                                                                                                                  |
| 2026-10-06 | 8     | `scripts/check-bundle.mjs` — budget qui **échoue le build**                         | Un budget qui n'échoue pas ne protège de rien : la régression arrive par un `import` oublié ou une mise à jour de dépendance, et personne ne la voit avant que le coach attende en gymnase. Mesure sur `node:zlib`, donc identique sur le Mac, le VPS et une CI                                                                                                                                         |
| 2026-10-06 | 8     | Mesure sur le **premier écran**, pas sur le total du build                          | Le total inclut le service worker, les icônes et les fichiers RSC : il ne dit rien de ce que le téléphone attend. Le budget porte sur les ressources référencées par le HTML de l'accueil — seul chiffre qui se translate en secondes d'attente                                                                                                                                                         |
| 2026-10-06 | 8     | `browserslist` ajouté, polyfills core-js toujours présents                          | Le build embarquait ~120 ko gzippés de polyfills pour un `browserslist` absent, qui fait viser « tous les navigateurs » — donc IE 11. **La correction n'a rien retiré** (378 ko avant, 378 après) : le poids vient de Zod et Dexie, pas des polyfills. Le budget reste sous la barre, donc le gain n'était pas nécessaire — mais la cible est maintenant explicite, et non « tout le monde » par défaut |
| 2026-10-06 | 8     | Le smoke test vérifie l'**enchaînement**, pas chaque écran                          | Les tests fins passent sur une application dont le parcours global est cassé, et l'inverse. D'où un test unique qui crée, saisit, change de joueur, change de période, annule, clôture, relit l'historique et les stats cumulées                                                                                                                                                                        |
| 2026-10-06 | 8     | Le score du header est celui de la **période courante**, pas un cumul               | Le smoke test l'a vérifié en passant : supposer l'inverse, c'est échouer sur une règle métier — la plus visible de l'application. Le test passe maintenant par Q3, vérifie le zéro, revient en Q1, et l'annulation y est prouvée par une baisse d'**exactement** un point                                                                                                                               |
| 2026-10-06 | 8     | Les totaux des stats cumulées sont lus **par position de colonne**                  | `getByText("19")` trouve « 19 paniers à 2 points » avant « 19 points ». Le nom du joueur est un `th` de portée ligne, donc un `rowheader` : il ne compte pas dans les cellules, et les points sont la deuxième, pas la troisième                                                                                                                                                                        |
| 2026-10-06 | 8     | 🔴 E2E : `getByRole("button", {name: "X"})` matche par sous-ensemble                | Le header porte « Annuler la dernière action » **et** la barre porte « Annuler » ; la barre porte « Terminer » **et** la fiche de clôture aussi. Sans `exact`, le test échoue sur une ambiguïté de libellé et non sur un comportement. Trois occurrences dans le smoke test                                                                                                                             |
| 2026-10-06 | 8     | E2E : deux ajouts de joueur doivent être **attendus** entre eux                     | Sans attente, le deuxième remplissage vise le nœud que le roster est en train de remplacer, et le bouton reste désactivé sur un nom vide. Échec intermittent, sans rapport avec la fonctionnalité testée                                                                                                                                                                                                |
| 2026-10-06 | 8     | `pnpm verify` + couverture + E2E + budget                                           | ✅ 563 tests · 19 E2E · 98,24 % lignes, 96,73 % stmts, 96,61 % fonctions, 90,29 % branches · premier écran 377,7 ko pour un budget de 400 ko. **Phase 8 close**                                                                                                                                                                                                                                         |

---

## 10. Correctifs après la phase 8

Trois demandes du commanditaire, traitées dans l'ordre. Les deux premières
partageaient la même cause racine — `useMatchData` ne fournissait qu'une carte de
statistiques par période, et le carrousel comme le header en dépendaient.

### 🔴 Les fautes repartaient de zéro à chaque période

`useMatchData` filtrait les actions **par période** avant d'agréger, et le
compteur de fautes en était issu. Conséquence : la limite à cinq se réarmait à
chaque quart temps, et un joueur sorti en Q1 pouvait reprendre le terrain en
prenant cinq fautes de plus. La feuille de match aurait compté dix fautes là où
la règle en compte cinq.

La règle métier est **par rencontre**, pas par période. `foulsByPlayer` est
donc agrégé sur toutes les actions, et alimente le carrousel comme le bouton
FAUTE — ce dernier parce qu'il porte le blocage à cinq.

Corrigé au passage : `FoulDots` était entièrement en `aria-hidden`, ce qui
rendait le compteur invisible aux lecteurs d'écran. Les pastilles sont
décoratives ; le nombre, non — c'est lui qui porte le seuil d'élimination.

### 🔴 Le score du header se remettait à zéro entre les périodes

Le score affiché était la somme des points **de la période**. C'est le chiffre
que le coach annonce au banc : il ne peut pas disparaître en passant de Q2 à Q3.
`totalPoints` est désormais calculé sur toutes les actions, et non sur la somme
des joueurs affichés — une action dont le joueur aurait quitté le roster ne doit
pas disparaître du score.

Les points **du carrousel** restent par période : « combien a-t-il mis ce
quart-ci » est la question pendant une période. Le détail par période est
également disponible dans la feuille de match, via son sélecteur.

### Ajout — suppression d'un match

Bouton dans l'historique **et** sur l'accueil, pour les matchs en cours comme
terminés. Un match en cours est précisément celui qu'on crée par erreur ;
n'ouvrir la suppression que sur les matchs terminés obligerait à clôturer un
match pour pouvoir l'effacer.

Trois décisions qui méritent d'être notées :

1. **La confirmation annonce le nombre d'actions.** « 40 actions seront perdues »
   est le seul énoncé qui permet de vérifier qu'on choisit le bon match : deux
   matchs contre la même équipe sont courants dans une saison.
2. **La suppression traverse la synchronisation.** Une suppression purement locale
   ferait revenir le match au tirage suivant — un fantôme impossible à expliquer.
   L'outbox gagne donc une opération `delete`, qui part **avant** les upserts et
   dans l'ordre inverse : une action ne peut pas être écrite après la suppression
   de son match.
3. **Les entrées `upsert` en attente sont purgées avant de poser les `delete`.**
   Dans l'autre ordre, l'upsert d'une action jamais synchronisée remplacerait la
   suppression, et le cloud recréerait le match au cycle suivant.

Pas de corbeille : elle exigerait un état supplémentaire dans l'outbox, donc un
cas de résolution de plus dans un module déjà complexe, et une corbeille vide qui
ne se vide jamais ressemble à un bug.

### Fichiers touchés par les correctifs

```
src/features/match/PlayerCarousel.tsx    foulsByPlayer séparé de statsByPlayer
src/features/match/MatchHeader.tsx       reçoit `score`, ne l'additionne plus
src/ui/Badges.tsx                        compteur de fautes hors aria-hidden
src/data/schema.ts                       OutboxEntry.operation
src/data/outbox.ts                       enqueueDelete()
src/data/repositories.ts                 MatchRepository.delete()
src/sync/remote.ts                       deleteByIds()
src/sync/engine.ts                       suppressions avant upserts, ordre inverse
src/features/match/DeleteMatchButton.tsx confirmation + appel au repository
src/features/history/useHistoryData.ts   actionCounts par match, `revision`
src/app/history/page.tsx                 bouton sur les deux sections
src/app/page.tsx                         bouton sur les matchs en cours
```

| Date       | Phase | Action                                                 | Résultat                                                                                                                                                                                                                                                                                        |
| ---------- | ----- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-06 | —     | 🔴 Fautes remises à zéro chaque période                | `useMatchData` filtrait par période avant d'agréger, donc la limite à cinq se réarmait à chaque quart temps. Un joueur sorti en Q1 pouvait en prendre cinq de plus, et la feuille en comptait dix. `foulsByPlayer` agrège sur le match entier — c'est la règle métier, pas un choix d'affichage |
| 2026-10-06 | —     | `FoulDots` était entièrement `aria-hidden`             | Le compteur de fautes était invisible aux lecteurs d'écran. Les pastilles sont décoratives ; le nombre porte le seuil d'élimination, donc il est sorti du `aria-hidden`                                                                                                                         |
| 2026-10-06 | —     | 🔴 Score du header remis à zéro par période            | C'est le chiffre que le coach annonce au banc. `totalPoints` est calculé sur toutes les actions, pas sur la somme des joueurs affichés : une action dont le joueur aurait quitté le roster ne doit pas disparaître du score                                                                     |
| 2026-10-06 | —     | Le smoke test avait **validé la mauvaise règle**       | Il vérifiait que le score tombait à zéro en Q3 — exactement l'inverse de la demande. Corrigé, il vérifie maintenant que le cumul ne bouge pas, et que les fautes de Turing restent à 1/5 en passant de Q1 à Q3                                                                                  |
| 2026-10-06 | —     | Ajout — suppression d'un match                         | Bouton dans l'historique et sur l'accueil. Confirmation nommant le nombre d'actions, bouton « Garder » en sortie de secours, erreur affichée sans fermer la fiche                                                                                                                               |
| 2026-10-06 | —     | L'outbox gagne une opération `delete`                  | Une suppression purement locale ferait revenir le match au tirage suivant — un fantôme. Les suppressions partent avant les upserts, en ordre inverse : une action ne peut pas être écrite après la suppression de son match                                                                     |
| 2026-10-06 | —     | Les `upsert` en attente sont purgés avant les `delete` | Dans l'autre ordre, l'upsert d'une action jamais synchronisée remplacerait la suppression et le cloud recréerait le match au cycle suivant                                                                                                                                                      |
| 2026-10-06 | —     | `deleteByIds()` regroupe les suppressions d'une table  | Une requête par action doublerait les allers-retours réseau d'une suppression — en gymnase, c'est le seul moment où le réseau manque déjà                                                                                                                                                       |
| 2026-10-06 | —     | `useHistoryData(revision)` pour forcer la relecture    | `useAsyncData` ne se rejoue pas : sans ça, le match effacé resterait à l'écran — le pire rendu possible pour un bouton « Supprimer »                                                                                                                                                            |
| 2026-10-06 | —     | `pnpm verify` + couverture + E2E                       | ✅ 593 tests · 21 E2E · 98,25 % lignes, 96,76 % stmts, 96,53 % fonctions, 90,29 % branches. Budget de bundle respecté                                                                                                                                                                           |
