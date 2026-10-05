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

| Sujet | Décision |
|---|---|
| Cible | PWA mobile-first, installable iOS + Android |
| Format | 5x5, 4 périodes de 8 min, 5 fautes éliminatoire |
| Chrono de jeu | **Non implémenté** — seule la sélection de période compte (stats par quart temps) |
| Saisie | Joueur verrouillé + tap = réussi, appui long 400 ms = manqué |
| Périmètre | Mes joueurs uniquement — **pas** de score adverse, pas de stats adverses |
| Fautes | Compteur simple (5 pastilles). Pas d'élimination, pas de LF suggérés, pas de bonus |
| Effectif | Une seule équipe, roster persistant enrichi match après match |
| Écrans | Match en cours, historique des matchs, stats cumulées. **Pas** d'écran scoreboard public |
| Hors-ligne | Garanti. Build 100 % statique, source de vérité en IndexedDB |
| Compte | **Obligatoire.** Email + mot de passe Supabase, confirmation d'email désactivée |
| Hébergement | VPS Coolify, déploiement push depuis GitHub |

### Règles métier à respecter

**Comptage des tirs** (implémenté dans `src/domain/rules.ts`, fonction unique et documentée) :

| Situation | FGA | FGM | Points | Fautes | FTA |
|---|---|---|---|---|---|
| Tir 2 ou 3 pts réussi | +1 | +1 | +2 / +3 | — | — |
| Tir 2 ou 3 pts raté | +1 | — | — | — | — |
| Tir réussi + faute sifflée (and-1) | +1 | +1 | +2 / +3 | +1 | +1 |
| Tir **raté** + faute sifflée | — | — | — | +1 | +2, ou **+3** si tentative à 3 pts |
| Lancer réussi | — | — | +1 | — | +1 |
| Lancer raté | — | — | — | — | +1 |
| Faute simple | — | — | — | +1 | — |

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

| Paquet | Version |
|---|---|
| next | 16.3.8 |
| react | 19.3.0 |
| tailwindcss | 4.3.3 |
| dexie | 4.4.6 |
| zustand | 5.0.15 |
| @tanstack/react-query | 5.104.1 |
| @supabase/supabase-js | 2.117.2 |
| zod | 4.6.5 |
| vitest | 5.0.3 |
| @playwright/test | 1.63.0 |

### Contraintes techniques ayant dicté l'architecture

| Fait vérifié | Conséquence retenue |
|---|---|
| Next 16 utilise **Turbopack par défaut** | Le plugin PWA historique `@ducanh2912/next-pwa` est inutilisable |
| `output: 'export'` **interdit** les routes dynamiques sans `generateStaticParams` | Pas de `/match/[id]`. Routes fixes + query param : `/match?m=<uuid>` |
| `output: 'export'` **interdit** les Route Handlers dynamiques | Le mode Turbopack de Serwist (qui repose sur `app/serwist/[path]/route.ts`) est exclu |
| `@serwist/next` v9.5.13 (mode webpack) fonctionne | Imposerait `next build --webpack`. Non retenu, voir ci-dessous |

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
  id: string          // uuid client — sert aussi de clé de dédupe à la sync
  matchId: string
  playerId: string
  seq: number         // monotonique, ordre chronologique
  quarter: 1 | 2 | 3 | 4
  kind: 'shot' | 'foul' | 'free_throw' | 'rebound' | 'assist'
      | 'turnover' | 'steal' | 'block' | 'substitution'
  value?: 2 | 3      // points visés (shot)
  made?: boolean     // shot / free_throw
  fouled?: boolean   // le tir a donné lieu à une faute sifflée
  groupId?: string   // lie les événements d'un même combo (undo groupé)
  voidedAt?: number | null
}
```

### Tables

| Table | Champs clés | Index |
|---|---|---|
| `teams` | `id`, `name`, `ownerId`, `updatedAt` | `ownerId`, `updatedAt` |
| `players` | `id`, `teamId`, `firstName`, `lastName`, `number`, `updatedAt` | `teamId`, `[teamId+number]`, `updatedAt` |
| `matches` | `id`, `teamId`, `opponentName`, `date`, `status: draft\|live\|finished`, `createdAt`, `finishedAt`, `updatedAt` | `teamId`, `status`, `date`, `updatedAt` |
| `actions` | voir ci-dessus + `updatedAt` | `[matchId+seq]`, `[matchId+quarter]`, `playerId`, `groupId`, `voidedAt`, `updatedAt` |
| `syncState` | `key`, `lastPulledAt`, `updatedAt` | `updatedAt` |
| `outbox` | `id` (= `entity:entityId`), `entity`, `entityId`, `payload`, `createdAt`, `attempts`, `lastError` | `[entity+entityId]`, `createdAt` |

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
    persistSession: true,      // localStorage → survit au redémarrage et au mode avion
    autoRefreshToken: true,    // refresh silencieux en tâche de fond
    detectSessionInUrl: true,  // requis pour le lien de reset de mot de passe
  },
})
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

| Où | Quoi |
|---|---|
| Authentication → Sign In / Email | **Cocher "Confirm email" → OFF** (point critique) |
| Authentication → URL Configuration | Site URL = domaine de prod ; `Redirect URLs` = `https://domaine/` et `/` |
| Authentication → Sessions | `Session time limit` 30 jours, refresh token rotation ON |
| Auth → Providers | Email activé (par défaut) |

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
Une première version faisait `+2 FTA` sur le tir fouillé, *plus* `+1` par lancer saisi :
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
  que demander au domaine (`undoScope()`) *quel* est le périmètre, puis délègue l'écriture.
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

**Durée** : ~1 à 1,5 jour · **Statut** : ⬜ À faire — **prochaine étape**

Objectif : la saisie en temps réel, testable sur un vrai téléphone. **On s'arrête ici pour ton
retour ergonomique avant d'écrire la moindre ligne de stats.**

Ce qui est déjà disponible côté données : `append()` écrit un combo entier et attribue `seq`
et `id`, `undoLast()` et `voidGroup()` gèrent l'annulation, `listByMatch()` rend le fil
ordonné. La phase 3 n'a donc plus à se soucier de la persistance.

Tâches :

- [ ] Zustand : store de match (`playerId` verrouillé, `quarter`, sheet ouverte)
- [ ] Écran `/` — liste des matchs en cours + « Nouveau match »
- [ ] Écran `/new-match` — date, adversaire, sélection des joueurs depuis le roster (création rapide
      d'un joueur si absent : numéro + nom)
- [ ] Écran `/match?m=<uuid>` selon le layout §4
- [ ] Carrousel joueurs : numéro, nom, points live, pastilles de fautes, état verrouillé
- [ ] Grille d'actions : tap vs appui long 400 ms, haptique
- [ ] Bandeau de combos : `2P+F`, `3P+F`, `R+F+2LF`, `R+F+3LF`
- [ ] Mini-sheet de saisie des LF (2 ou 3 lancers, compteurs, boutons ✓ / ✗)
- [ ] Undo groupé + toast 4 s
- [ ] Sélecteur de période (Q1–Q4) + score dans le header
- [ ] Wake Lock + `visualViewport` (clavier qui ne casse pas le layout)

**PORTE** : tu installes l'app sur ton téléphone, tu simules un match complet, tu me fais un
retour sur l'ergonomie. **Rien n'est écrit dans les phases suivantes avant ton feu vert.**

---

### Phase 4 — Clôture et feuille de match

**Durée** : ~0,5 à 1 jour · **Statut** : ⬜ À faire

Objectif : terminer un match proprement et lire le résultat.

Tâches :

- [ ] Action « Terminer le match » avec confirmation
- [ ] Feuille de match : score total et par période, ligne par joueur
      (`2/6 à 3pts`, `4/8 LF`, fautes, rebonds, passes, pertes, contres, interceptions)
- [ ] Reprise d'un match en cours au lancement : bandeau « Reprendre le match du 12/03 »
- [ ] Export CSV et JSON du match
- [ ] Tests Playwright : créer un match → saisir 10 actions → vérifier le score

---

### Phase 5 — Historique et stats cumulées

**Durée** : ~1 à 1,5 jour · **Statut** : ⬜ À faire

Objectif : l'écran « les matchs précédents » et l'écran « mes stats cumulées ».

Tâches :

- [ ] `/history` : matchs terminés + en cours, badge de statut, tri par date
- [ ] Détail d'un match historique : feuille de match, consultation par période
- [ ] `/stats` : cumul par joueur — points totaux, points/match, paniers 2P et 3P (réussis/tentés),
      % de réussite global et par type, rebonds, passes, pertes, contres, interceptions, fautes
- [ ] Tri par colonne · filtres
- [ ] Export CSV des stats cumulées

Vérification : les moyennes sont cohérentes avec le total / nombre de matchs (test unitaire).

---

### Phase 6 — Supabase : auth et sync

**Durée** : ~1 jour · **Statut** : ⬜ À faire

Objectif : compte obligatoire et synchronisation cloud. Le poste le moins risqué du projet,
l'auth étant réduite à deux clics de dashboard.

Tâches :

- [ ] `.env.local` + `.env.example` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`)
- [ ] `src/sync/supabase-client.ts` avec la config auth §5
- [ ] Store d'auth Zustand : session, chargement, `signIn`, `signUp`, `signOut`, `onAuthStateChange`
- [ ] Écran de connexion `/` : email, mot de passe, « mot de passe oublié »
- [ ] Écran d'inscription : email, mot de passe, confirmation → session immédiate
- [ ] Écran « mot de passe oublié » + gestion `PASSWORD_RECOVERY` via le query param `?mode=reset-password`
- [ ] Garde-fou : `Guard` bloquant l'accès aux routes de match si session absente
- [ ] SQL Supabase : tables `teams`, `players`, `matches`, `actions` + `outbox` côté serveur
- [ ] RLS : `auth.uid() = teams.owner_id`, politiques sur chaque table
- [ ] Moteur de sync : drain de l'outbox (upsert par `id`), pull par curseur `updated_at`,
      backoff exponentiel, retry manuel depuis l'indicateur du header
- [ ] Indicateur d'état de sync dans le header : synchronisé / en cours / hors-ligne / erreur
- [ ] Création du `teamId` à l'inscription

---

### Phase 6b — Données orphelines

**Durée** : ~0,25 jour · **Statut** : ⬜ À faire

Objectif : ne jamais perdre de données, y compris dans le cas de figure où l'app est utilisée
avant que l'auth soit configurée.

Tâches :

- [ ] Au premier login, associer les données locales existantes au `teamId` créé côté cloud
- [ ] Upload de l'outbox accumulée avant login
- [ ] Test de non-régression : données créées hors-ligne → login → toutes présentes dans le cloud

---

### Phase 7 — PWA et robustesse

**Durée** : ~0,5 à 1 jour · **Statut** : ⬜ À faire

Objectif : le mode hors-ligne est garanti, pas supposé.

Tâches :

- [ ] `app/manifest.json` : nom, `display: standalone`, `orientation: portrait`,
      `theme_color`, icônes 192 / 512 + version maskable
- [ ] Icônes générées (192, 512, maskable, favicon) — pas de placeholder
- [ ] Script post-build : parcourt `out/` et génère `sw-precache-manifest.json`
- [ ] `public/sw.js` : `cache-first` sur les assets hashés, `network-first` + fallback sur les
      navigations, `skipWaiting` + `clientsClaim`, purge des anciens caches à l'activation
- [ ] Page `/~offline` de fallback
- [ ] **Test d'offline réel** : build de prod, mode avion, rechargement complet, match en cours
      toujours là
- [ ] Prompts d'installation iOS (non supporté par l'API) et Android
- [ ] En-têtes Nginx pour Coolify : `sw.js` et `manifest.json` en `no-cache`,
      assets hashés en `immutable`
- [ ] Audit des cibles tactiles (≥ 44 px mini, ≥ 88 px actions principales) et des contrastes

---

### Phase 8 — Finition

**Durée** : ~0,5 jour · **Statut** : ⬜ À faire

Objectif : propre, documenté, prêt à déployer.

Tâches :

- [ ] Smoke test Playwright : match complet de bout en bout
- [ ] Budget de bundle vérifié au build
- [ ] `README.md` : procédure de build, config Nginx, checklist dashboard Supabase, config Coolify
- [ ] Relance complète : `pnpm typecheck && pnpm lint && pnpm test && pnpm build`

---

## 7. État actuel

| | |
|---|---|
| **Phase courante** | Phase 3 — Prototype tactile · **PORTE DE VALIDATION** |
| **Prochaine étape** | Store Zustand de match (`playerId` verrouillé, `quarter`, sheet ouverte), puis écran `/` |
| **Dernière action** | Phase 2 terminée : 239 tests, `src/data` couvert à 100 % lignes / 99,6 % branches |
| **Phases terminées** | Phase 0, Phase 1, Phase 2 |
| **Porte de validation** | Phase 3 — **en attente du retour terrain** |
| **Blocage** | `git init` impossible : licence Xcode non acceptée sur cette machine |

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

| Date | Phase | Action | Résultat |
|---|---|---|---|
| 2026-10-05 | — | Plan initial rédigé | Stack et phases validées après questions |
| 2026-10-05 | — | Passage d'OAuth Google à email + mot de passe Supabase | Confirmation email désactivée, zéro email au quotidien, session 30 j |
| 2026-10-05 | 0 | `create-next-app` échoue (dossier `SpaceBunny` avec majuscules + pnpm absent) | Scaffoldé dans un dossier temporaire, `pnpm` activé via corepack, tout déplacé |
| 2026-10-05 | 0 | `next.config.ts` : `output:'export'` + `trailingSlash` | Build statique confirmé, 4 routes prérendues |
| 2026-10-05 | 0 | `tsconfig.json` durci | `noUncheckedIndexedAccess` etc. pour sécuriser les unions discriminées du domaine |
| 2026-10-05 | 0 | Thème dark + tokens tactiles dans `globals.css` | Cibles 44/88px, safe-area, `dvh`, police système (pas de font réseau) |
| 2026-10-05 | 0 | Vitest + ESLint + Prettier + Playwright configurés | Seuils couverture 90 %, règles a11y tactiles |
| 2026-10-05 | 0 | `pnpm verify` | ✅ typecheck + lint + test + build au vert, `out/` produit |
| 2026-10-05 | 0 | `git init` + commit | ❌ bloqué : licence Xcode non acceptée (`sudo xcodebuild -license`) |
| 2026-10-05 | 1 | `src/domain/types.ts` — schémas Zod | `Action` validé au-delà des types : un tir sans `value`/`made`, une période hors 1-4, et `fouled` sur une faute simple sont **rejetés**. Ce dernier garde-fou empêche le double comptage de faute |
| 2026-10-05 | 1 | `src/domain/rules.ts` — `project()` + `combos.*` | Règle non-FIBA isolée dans `projectShot()`, documentée et testée séparément |
| 2026-10-05 | 1 | 🔴 Correction : double comptage des FTA | `+2 FTA` sur le tir fouillé **plus** `+1` par lancer saisi = 4 FTA pour une série de 2. Corrigé : le tir fouillé ne compte que `+1 faute`, `awardedFreeThrows()` renvoie le nombre de lancers dus |
| 2026-10-05 | 1 | 🔴 Correction : `madeAndFouled` créait une faute en double | Une action `foul` séparée s'ajoutait à la faute déjà portée par le `shot`. Le combo ne crée plus qu'**une** action |
| 2026-10-05 | 1 | 🟡 Suppression de `includeVoided` | `project()` neutralise toujours les actions annulées : le filtre n'aurait eu aucun effet. Retiré plutôt que laissé en place ; `actionsOfMatch()` est le seul moyen de les lire |
| 2026-10-05 | 1 | `ActionDraft` en union discriminée | Champs obligatoires garantis par le type : impossible de compiler un rebond sans `side`. Erreurs à la compilation, pas à l'exécution |
| 2026-10-05 | 1 | `src/domain/stats.ts` — agrégats | `aggregate`, `cumulativeStats`, `pointsByQuarter`, `pendingFreeThrows` (appariement séquentiel par joueur, pas de décompte global) |
| 2026-10-05 | 1 | `src/domain/undo.ts` — annulation groupée | `undoScope` + `applyUndo`, fonctions pures. `redoHint` prépare l'affichage « Réfaire : … » du toast |
| 2026-10-05 | 1 | 🔴 Correction : `applyUndo` perdait des actions | Renvoyait le périmètre annulé au lieu de la liste complète, faisant disparaître les actions non concernées. Corrigé, testé par `activeCount` |
| 2026-10-05 | 1 | 2 fixtures de test fautives corrigées | `combos.missed(..., 1)` passait `value: 1` (ni 2 ni 3) ; un `matchId` réétiqueté par index dispersait les joueurs sur les 3 matchs |
| 2026-10-05 | 1 | `tsconfig.json` : ajout de `vitest/globals` | `describe`/`it`/`expect` n'étaient pas typés |
| 2026-10-05 | 1 | Installation de `@vitest/coverage-v8` | `pnpm test:coverage` échouait sur une dépendance manquante |
| 2026-10-05 | 1 | Prettier : `semi: true` | Le formatage initial avait retiré les points-virgules du code généré |
| 2026-10-05 | 1 | `pnpm verify` + couverture | ✅ 115 tests · domaine 99,22 % stmts, 97,22 % branches, 100 % lignes |
| 2026-10-05 | 2 | `src/data/ids.ts` — `newId()` | UUID v4 via `crypto.randomUUID`, repli `getRandomValues` pour Safari < 15.4. L'`id` est généré **avant** l'écriture locale : c'est la clé de dédupe de la sync et il doit exister dès le geste du coach |
| 2026-10-05 | 2 | `src/data/schema.ts` — schéma Dexie v1/v2 | Colonnes `updatedAt` (curseur de tirage descendant), index `voidedAt`, `updatedAt`, `[entity+entityId]` sur l'outbox. `V1_SCHEMA` conservé tel quel : le modifier ferait échouer la vérification de l'upgrade |
| 2026-10-05 | 2 | `migrateV1ToV2()` — repli `updatedAt = 0` | `0` et non `Date.now()` : le premier tirage descendant doit rattraper les lignes préexistantes, sinon des matchs saisis avant la mise à jour resteraient invisibles côté serveur, définitivement |
| 2026-10-05 | 2 | 🔴 `groupId` non indexé sur `actions` | `voidGroup()` — donc l'annulation groupée d'un `2P+F` — imposait un parcours complet de la table. Ajouté à v2 ; un test échouait franchement (`KeyPath groupId on object store actions is not indexed`) |
| 2026-10-05 | 2 | `src/data/outbox.ts` — une entrée par ligne | Clé primaire déterministe `entity:entityId`. Créer puis annuler remplace l'entrée au lieu de l'accumuler : le cloud ne fait que des upserts, le dernier état suffit |
| 2026-10-05 | 2 | `attempts`/`lastError` conservés au remplacement d'entrée | Sinon chaque nouvelle action locale remettait le backoff à zéro — une mutation locale ne rend pas un serveur injoignable joignable |
| 2026-10-05 | 2 | `src/data/repositories.ts` — 4 interfaces + implémentations Dexie | `append()` attribue `seq` et `id` : impossible d'écrire deux actions de même `seq` lors d'un appui rapide ou d'un double rendu React. `undoLast()` délègue le périmètre à `undoScope()` du domaine |
| 2026-10-05 | 2 | `nextSeq()` atomique par sérialisation Dexie | Lecture-modification-écriture dans une transaction `rw` unique, sans verrou à écrire. Vérifié par 10 `append()` concurrents → `seq` 0..9 sans doublon |
| 2026-10-05 | 2 | `lastSeqIn()` via l'index composé `[matchId+seq]` | O(log n) au lieu de O(n) : un match peut compter plusieurs centaines d'événements et on écrit à chaque appui |
| 2026-10-05 | 2 | Validation Zod **avant** écriture | Une ligne invalide est rejetée avant d'atteindre IndexedDB. Un combo au second draft invalide ne laisse aucune ligne ni entrée d'outbox derrière lui |
| 2026-10-05 | 2 | `src/data/index.ts` — point d'entrée unique | Les composants obtiennent des repositories, jamais une base. `db()` paresseux : `output: 'export'` prerend dans un Node sans `indexedDB` |
| 2026-10-05 | 2 | Suppression de `createTestDb()` | Ne faisait que déléguer au constructeur ; les tests construisent `new SpaceBunnyDb(nom unique)` en direct. `db.ts` fusionné dans `schema.ts` |
| 2026-10-05 | 2 | Tests : base v1 créée à la main | `LegacyV1Db` reproduit un upgrade réel — `Dexie.verno` ne permettant pas de le simuler autrement. Vérifie colonnes, valeurs, idempotence et utilité du curseur après migration |
| 2026-10-05 | 2 | Test : stats cohérentes après annulation | L'annulation relue **depuis la base** (pas depuis l'objet renvoyé) doit déjà avoir disparaître l'action des points — c'est ce que verra l'écran de saisie |
| 2026-10-05 | 2 | `pnpm verify` + couverture | ✅ 239 tests · `src/data` 100 % lignes / 100 % fonctions / 99,59 % branches |