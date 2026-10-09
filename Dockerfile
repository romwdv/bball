# =============================================================================
# SpaceBunny — image de production
# =============================================================================
# Deux étapes, et c'est tout : une qui compile, une qui sert.
#
# Pourquoi une image du tout : `next.config.ts` impose `output: 'export'`, le
# build produit un dossier `out/` de ~2 Mo, statique, sans aucune fonction
# serveur. Le Node n'a donc rien à faire à l'exécution — il ne sert qu'à
# compiler. Cette image le fait disparaître de l'image finale.
#
# Ce Dockerfile remplace le build Railpack de Coolify, qui **échouait en OOM** :
# Turbopack a un pic de mémoire supérieur aux 4 Go du VPS, et le build se
# faisait tuer par le noyau (`exit code 137`). Ici le build tourne sur un runner
# GitHub Actions, et le VPS ne fait plus que `docker pull`.
#
# Les variables `NEXT_PUBLIC_*` sont lues **au build** (voir README) : changer
# l'une d'elles impose un nouveau build et un redéploiement, pas un simple
# redémarrage. D'où les `ARG` — sans elles, l'application afficherait un écran
# « synchronisation non configurée » en production.
# =============================================================================


# -----------------------------------------------------------------------------
# Étape 1 — build
# -----------------------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV NEXT_TELEMETRY_DISABLED=1

# ⚠️ `NODE_ENV` n'est volontairement **pas** positionné à `production`.
# C'est un piège qui ne se voit qu'en CI : avec `NODE_ENV=production`, pnpm
# n'installe pas les devDependencies — or le build en a besoin. `tailwindcss`,
# `@tailwindcss/postcss` et `typescript` en font partie, et il n'y a pas de
# `dependencies` qui les fournirait. Le build casserait sur un module introuvable,
# très loin de sa cause. CI est le seul endroit où ce genre de variable se glisse
# en silence, d'où le commentaire.
#
# Corepack avant le `COPY` des manifestes : `pnpm install` doit être déjà
# disponible au moment où les fichiers arrivent. La version est épinglée sur
# celle de `packageManager`, donc le build est reproductible.
RUN corepack enable && corepack prepare pnpm@12.9.1 --activate

# Les manifestes d'abord, le reste ensuite. C'est ce qui rend la couche
# d'install réutilisable : elle n'est invalidée que si un manifeste change, donc
# un simple changement de code source ne re-télécharge pas les 462 paquets.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# Les valeurs arrivent en `--build-arg` (cf. `.github/workflows/deploy.yml`).
# Ce sont des valeurs **publiques par construction** : la clé publishable est
# faite pour être embarquée dans le bundle client, et la sécurité de la base
# repose sur les politiques RLS — voir `supabase/schema.sql`.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

# `pnpm build` enchaîne la génération des icônes, le build Next, le manifeste de
# pré-cache et la vérification du budget de bundle. Un dépassement de budget fait
# donc échouer le build **avant** toute image : c'est une garde, pas un rapport.
RUN pnpm build


# -----------------------------------------------------------------------------
# Étape 2 — service
# -----------------------------------------------------------------------------
FROM nginx:alpine

# Le chemin `/var/www/stats-basket/out` est exactement celui qu'attend le `root`
# de `deploy/nginx.conf` : le fichier est donc réutilisé tel quel, sans être
# modifié, et reste valable s'il est un jour monté dans le panneau Coolify plutôt
# que dans l'image.
COPY --from=build /app/out /var/www/stats-basket/out
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80