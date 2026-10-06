# Stats Basket — Stats de match de basketball

PWA mobile-first de saisie de statistiques de basketball en bord de terrain.
Hors-ligne garanti, build 100 % statique.

Le cahier des charges, l'état d'avancement et les décisions prises sont dans
[`PLAN.md`](./PLAN.md). C'est le document de référence : le lire avant de
modifier quoi que ce soit.

---

## Compte et synchronisation

L'application **exige un compte** : sans session, elle n'affiche ni la grille de
saisie, ni l'historique, ni les statistiques. C'est délibéré — une saisie faite
sans compte produirait un match que rien ne synchroniserait jamais, et le coach
le vérifierait en fin de partie. Les données déjà saisies avant la première
connexion sont rattachées au compte automatiquement (phase 6b) : rien n'est perdu.

### Ce qu'il faut faire une fois côté Supabase

Dans le dashboard du projet, **Authentication → Sign In / Email** :

- **[ ] Décocher « Confirm email »** — c'est le point critique. Tant qu'il est
  coché, l'inscription n'envoie aucun email et ne crée aucune session : l'écran
  d'inscription échoue avec un message explicite. Le service email par défaut est
  par ailleurs plafonné à 2 emails/heure, ce qui est pourquoi aucun email ne doit
  circuler au quotidien.
- **[ ] Session time limit : 30 jours**, refresh token rotation ON.
- **Authentication → URL Configuration** : Site URL = le domaine de production,
  Redirect URLs = `https://<domaine>/` et `https://<domaine>/`.

Pour que « mot de passe oublié » fonctionne réellement, il faut brancher un SMTP
(Brevo, Resend, SMTP2GO) dans **Authentication → Email**. Tant qu'il n'y en a pas,
l'écran est présent et le bouton échoue proprement — ce n'est pas un oubli, c'est
un choix : aucun mot de passe n'est perdu, il suffit de se souvenir du sien ou de
recréer un compte.

### Créer les tables

Exécuter **`supabase/schema.sql`** dans l'éditeur SQL du dashboard. Le fichier est
idempotent : le réexécuter ne casse rien. Il crée les tables `teams`, `players`,
`matches`, `actions`, le registre `outbox`, les index, accorde les **privilèges**
au rôle `authenticated`, et **active les RLS** avec les politiques
`auth.uid() = teams.owner_id`.

⚠️ Les RLS sont le seul garde-fou : la clé publishable est publique par
conception. Une politique manquante rendrait la base lisible par tous les
comptes. Ne jamais désactiver les RLS, et ne jamais placer une clé
`service_role` dans `src/` — elle contournerait tout.

**Si la synchronisation échoue avec `permission denied for table teams`**, c'est
que le bloc `grant` du fichier n'a pas été exécuté. Le fichier s'exécute en
several fois sans risque : le rejouer réaccorde les droits sans rien casser.

### Variables d'environnement

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<projet>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Deux points qui coûtent cher à retrouver :

- **Seule la clé `publishable` est destinée au client.** C'est la conception de
  Supabase : la sécurité repose sur les RLS. Une clé `service_role` dans le
  bundle reviendrait à publier la base entière.
- **Ces variables sont figées au build**, pas à l'exécution. Les modifier dans
  Coolify impose un nouveau build, pas un simple redémarrage. L'app affiche un
  écran « synchronisation non configurée » si elles manquent — lisible, plutôt
  qu'une page blanche.

---

## Tester en local

### 1. Ce qu'il faut savoir avant de lancer

Trois choses qui font perdre du temps sinon.

**Il faut tester le build, pas `pnpm dev`.** `output: 'export'` produit des
routes prérendues et un `404.html` statique ; le serveur de dev se comporte
différemment. Et le service worker de la phase 7 n'existera qu'en production.

**Safari sur iPhone refuse IndexedDB en HTTP.** C'est la seule vraie difficulté.
Sur `http://192.168.x.x`, Safari ouvre la page mais refuse d'ouvrir la base :
l'app se charge et ne démarre pas. Chrome et Firefox, eux, ouvrent IndexedDB en
HTTP sans broncher — donc **un test réussi sur Android ou desktop ne prouve rien
sur iOS**.

**Il faut être sur le même réseau Wi-Fi** que le Mac, sans isolation AP.

### 2. Sur le Mac (le plus rapide)

```bash
pnpm install
pnpm build
pnpm serve
```

Puis <http://localhost:4321>. `localhost` est un contexte sécurisé, donc Safari
y ouvre IndexedDB normalement, et le test tactile à la souris est possible.

### 3. Sur un téléphone Android

```bash
pnpm build
pnpm serve
```

Le serveur affiche les adresses LAN, par exemple `http://192.168.1.106:4321`.
Tapez-la dans Chrome sur le téléphone. IndexedDB passe en HTTP : ça marche
directement.

### 4. Sur iPhone — certificat local obligatoire

Il faut un certificat reconnu par Safari, sinon `indexedDB` est indisponible.
`mkcert` génère un CA qu'on installe sur le Mac **et** sur le téléphone.

```bash
brew install mkcert
mkcert -install                    # installe le CA dans le trousseau macOS

# Connaissez votre IP locale (affichée par `pnpm serve`) et votre réseau :
mkcert -cert-file .certs/192.168.1.106.pem \
       -key-file  .certs/192.168.1.106-key.pem \
       192.168.1.106 localhost 127.0.0.1

pnpm build
pnpm serve:https
```

Puis, **sur l'iPhone** :

1. Réglages → Général → Informations → Réglages de confiance des certificats
2. Activer la confiance pour l'autorité `mkcert`
3. Ouvrir `https://192.168.1.106:4321` dans Safari — la mention « non
   sécurisé » disparaît une fois la confiance activée

Sans l'étape 2, Safari affichera un avertissement et IndexedDB restera bloqué.

### 5. Ce qu'il faut vérifier sur téléphone

C'est la porte de validation de la phase 3. Ce qui n'est testable qu'en main
propre :

- **[ ] Le geste.** Tap = réussi, appui 400 ms = raté. C'est le point le plus
  incertain du projet : 400 ms est une estimation, pas une mesure. En
  gymnase, si tu confonds les deux, on ajuste la constante `LONG_PRESS_MS`.
- **[ ] Les vibrations.** Le motif doit être distinct entre réussi et raté. Sur
  iOS, `navigator.vibrate` ne fait rien : c'est attendu, le retour visuel (bord
  vert au pressage) prend le relais. Sur Android, ça doit vibrer.
- **[ ]Les encoches.** Le header et la barre de combos ne doivent pas passer
  sous l'encoche ni la barre d'actions. C'est le rôle de `env(safe-area-inset-*)`.
- **[ ] Le compte.** Créer un compte, vérifier que l'app s'ouvre, puis créer un
  match et regarder le voyant en haut de l'écran de saisie passer de
  « n en attente » à « synchronisé ». Couper le réseau pendant une saisie : le
  voyant doit dire « hors-ligne » ou « n en attente », jamais « erreur ».
- **[ ] La reconnexion.** Couper le réseau, saisir, revenir. Un tap sur le
  voyant doit resynchroniser sans attendre.
- **[ ] Le clavier.** Sur `/new-match`, le bouton « Commencer la saisie » doit
  rester atteignable quand le clavier s'ouvre. **Non traité** — c'est
  `visualViewport`, laissé hors phase 3.
- **[ ] Le carrousel.** Faire défiler la liste des joueurs au pouce pendant une
  saisie, sans qu'un scroll n'enregistre un tir.
- **[ ] La fiche de lancers.** Enchaîner `R+F+2LF` puis valider les 2 lancers,
  puis vérifier que le score est bien 2 (et pas 3).

### 6. Ce que les tests automatisés couvrent déjà

536 tests, 98 % de couverture. Le geste tap/appui long, les combos, l'annulation
groupée, la cohérence avec les statistiques, le moteur de synchronisation (perte
de données, ordre de dépendance, curseurs par table, backoff) et le rattachement
des données locales au compte sont testés. **Si le test terrain ne valide que
l'ergonomie et le rendu, la logique est déjà sous contrôle.**

Les tests E2E amorcent une session factice dans `localStorage` et coupent les
appels réseau vers Supabase (`tests/e2e/auth.ts`) : aucun compte réel, aucune
donnée réelle, aucun appel sortant. C'est ce qui rend les parcours reproductibles
et indépendants du réseau.

---

## Commandes

```bash
pnpm dev          # serveur de dev (ne pas utiliser pour valider)
pnpm build        # build statique dans out/
pnpm serve        # sert out/ en HTTP, affiche les URLs LAN
pnpm serve:https  # idem en HTTPS, certificats mkcert dans .certs/
pnpm verify       # typecheck + lint + test + build  ← avant chaque commit
pnpm test         # tests unitaires
pnpm test:coverage
pnpm e2e          # Playwright, mobile viewport
```

## Stack

Next.js 16 (App Router, `output: 'export'`) · React 19 · TypeScript strict ·
Tailwind v4 · Dexie 4 (IndexedDB) · Zustand 5 · Zod 4 · Supabase 2 ·
Vitest 5 · Playwright.

## Déploiement

Push depuis GitHub sur Coolify, build statique servi par Nginx. Voir `PLAN.md`
§7 pour la config Nginx.

Sur Coolify, les deux variables `NEXT_PUBLIC_*` se déclarent dans les
**variables d'environnement de l'application**. Rappel : elles sont lues au
build — les modifier déclenche un redéploiement, pas un redémarrage.

`next.config.ts` impose `output: 'export'` : aucune fonction serveur, aucune
route dynamique. Le lien de réinitialisation de mot de passe revient donc sur
`https://<domaine>/`, où l'application lit le fragment d'URL et ouvre le
formulaire de nouveau mot de passe. Si le lien est renvoyé sur une autre URL,
la session de récupération n'est pas reconnue.

## Point d'attention

`.gitignore` exclut `/out`, `/.next`, `/coverage`, `/.vitest`, `node_modules` et
`.env.local`. `.env.example` est volontairement versionné : il documente les
variables attendues sans exposer de secret.

`PLAN.md` n'est **pas** ignoré : c'est le document de spécification, il doit
être versionné et tenu à jour à chaque fin de phase.
