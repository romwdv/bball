-- =============================================================================
-- Stats Basket — schéma Supabase
-- =============================================================================
-- À exécuter une seule fois, dans l'éditeur SQL du dashboard Supabase
-- (ou `psql` contre la base du projet). Le fichier est **idempotent** :
-- `create table if not exists` et des politiques remplacées, donc le réexécuter
-- après une correction ne casse rien.
--
-- Trois partis pris, à lire avant de modifier quoi que ce soit.
--
-- 1. **Horodatages en `bigint` (ms depuis epoch), pas en `timestamptz`.**
--    Le domaine travaille en `Date.now()` de bout en bout : `voidedAt`,
--    `updatedAt`, `createdAt`, `finishedAt` sont des nombres, et les statistiques
--    cumulées les comparent et les additionnent. Un `timestamptz` obligerait à
--    convertir à chaque frontière ; surtout, le *last-write-wins* des annulations
--    compare deux `updated_at`, et cette comparaison doit être exacte.
--
-- 2. **Colonnes en `snake_case`.** Le domaine est en `camelCase`. La conversion
--    est explicite, entité par entité, dans `src/sync/mapping.ts`, et testée.
--    Aucune conversion implicite n'est tolérée : c'est le seul endroit du projet
--    où une faute de frappe ferait perdre des données en silence.
--
-- 3. **`id` en `uuid`, généré par le client.** Une action est identifiée avant
--    d'être écrite : c'est ce qui rend l'upsert idempotent et la résolution de
--    conflit un simple dédupe par `id` (PLAN.md §5). Aucune séquence serveur,
--    donc aucun aller-retour réseau pour obtenir un identifiant.
--
-- ⚠️ **Les RLS sont le seul garde-fou de sécurité.** La clé publishable est
-- publique par conception : n'importe qui peut l'utiliser depuis la console. Une
-- politique manquante ou trop lax, c'est une base lisible par tous les comptes.
-- Les politiques ci-dessous sont donc volontairement strites, et RLS n'est jamais
-- désactivé.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- teams — un compte, une équipe
-- -----------------------------------------------------------------------------
-- `owner_id` est le pivot de toute la sécurité : c'est l'uid de Supabase Auth,
-- écrit une seule fois par le client, à la création (phase 6b, `claimTeam()`).
--
create table if not exists public.teams (
  id uuid primary key,
  name text not null,
  owner_id uuid not null references auth.users (id) on delete cascade,
  updated_at bigint not null default 0
);

comment on table public.teams is
  'Une équipe par compte. owner_id est le pivot des politiques RLS.';

create index if not exists teams_owner_id_idx on public.teams (owner_id);
-- Curseur de tirage descendant (`updated_at > lastPulledAt`) : une seule ligne à
-- lire, l'index évite un seq scan de la table.
create index if not exists teams_updated_at_idx on public.teams (updated_at);

-- -----------------------------------------------------------------------------
-- players — roster de l'équipe, enrichi match après match
-- -----------------------------------------------------------------------------
create table if not exists public.players (
  id uuid primary key,
  team_id uuid not null references public.teams (id) on delete cascade,
  first_name text not null default '',
  last_name text not null,
  number integer,
  updated_at bigint not null default 0,
  -- Un numéro ne peut être porté que par un joueur. Sans cette contrainte, deux
  -- joueurs "n°4" remontent du cloud et le carrousel affiche deux cibles
  -- identiques : le bug le plus coûteux à diagnostiquer en bord de terrain.
  constraint players_team_number_key unique (team_id, number)
);

comment on table public.players is
  'Roster persistant de l''équipe, partagé par tous les matchs.';

create index if not exists players_team_id_idx on public.players (team_id);
create index if not exists players_updated_at_idx on public.players (updated_at);

-- -----------------------------------------------------------------------------
-- matches
-- -----------------------------------------------------------------------------
create table if not exists public.matches (
  id uuid primary key,
  team_id uuid not null references public.teams (id) on delete cascade,
  opponent_name text not null,
  -- Date de la rencontre, `YYYY-MM-DD`. Le fuseau du coach n'a aucune incidence
  -- sur une date de match : un `timestamptz` afficherait la veille à une
  -- rencontre jouée le soir.
  date date not null,
  -- Roster du match : un joueur arrivé en retard n'a pas joué les trois premiers
  -- quarts, et la feuille de match doit le dire.
  player_ids uuid[] not null default '{}',
  status text not null default 'draft'
    check (status in ('draft', 'live', 'finished')),
  created_at bigint not null default 0,
  finished_at bigint,
  updated_at bigint not null default 0
);

comment on table public.matches is
  'Feuilles de match. player_ids est le roster figé au moment du match.';

create index if not exists matches_team_id_idx on public.matches (team_id);
create index if not exists matches_status_idx on public.matches (status);
create index if not exists matches_date_idx on public.matches (date);
create index if not exists matches_updated_at_idx on public.matches (updated_at);

-- -----------------------------------------------------------------------------
-- actions — le journal append-only
-- -----------------------------------------------------------------------------
-- Aucune statistique n'est stockée : le score est recalculé par `aggregate()`.
-- Ce qui est stocké, ce sont des événements immuables, soft-deleted via
-- `voided_at`. D'où l'unicité sur `(match_id, seq)` : `seq` est attribué côté
-- client dans une transaction Dexie, mais la contrainte est la seule chose qui
-- empêche deux actions d'ordonner le même rang si deux appareils se reconnectent
-- après une longue coupure.
--
create table if not exists public.actions (
  id uuid primary key,
  match_id uuid not null references public.matches (id) on delete cascade,
  player_id uuid not null,
  seq integer not null,
  quarter integer not null check (quarter between 1 and 4),
  kind text not null check (
    kind in (
      'shot', 'foul', 'free_throw', 'rebound', 'assist',
      'turnover', 'steal', 'block', 'substitution'
    )
  ),
  value smallint check (value in (2, 3)),
  made boolean,
  fouled boolean,
  -- `rebound` uniquement : offensif ou défensif, deux compteurs distincts dans
  -- les statistiques.
  side text check (side in ('offensive', 'defensive')),
  group_id uuid,
  voided_at bigint,
  updated_at bigint not null default 0,
  constraint actions_match_seq_key unique (match_id, seq)
);

comment on table public.actions is
  'Événements immuables du match. voided_at non nul = annulation (soft-delete).';

create index if not exists actions_match_quarter_idx
  on public.actions (match_id, quarter);
create index if not exists actions_player_id_idx on public.actions (player_id);
create index if not exists actions_group_id_idx on public.actions (group_id);
-- Partiel sur les actions annulées : le tirage descendant et les statistiques ne
-- lisent presque jamais ces lignes, qui sont pourtant nombreuses en fin de saison.
create index if not exists actions_voided_at_idx
  on public.actions (voided_at)
  where voided_at is not null;
create index if not exists actions_updated_at_idx on public.actions (updated_at);

-- -----------------------------------------------------------------------------
-- outbox — registre serveur des mutations reçues
-- -----------------------------------------------------------------------------
-- La file d'attente *locale* (`src/data/outbox.ts`) garantit qu'aucune mutation
-- n'est perdue entre l'écriture locale et l'envoi. Celle-ci est son pendant
-- côté serveur : un registre **append-only** de tout ce qui entre en base.
--
-- Elle ne sert pas à résoudre les conflits — la résolution est un dédupe par
-- `id` (PLAN.md §5) — mais à trois choses concrètes :
--   1. diagnostiquer « mon match n'est pas remonté » sans client de debug ;
--   2. savoir quand et par quel appareil une action a été écrite ;
--   3. fournir un point d'entrée unique pour un futur audit ou une purge.
--
-- Alimentée par déclencheur et non par le client : celui-ci n'émet que des
-- upserts, il ne distingue donc pas une création d'une annulation, et une ligne
-- manquante ici signifierait une écriture non tracée.
--
create table if not exists public.outbox (
  id bigint generated always as identity primary key,
  entity text not null check (
    entity in ('teams', 'players', 'matches', 'actions')
  ),
  entity_id uuid not null,
  operation text not null check (operation in ('insert', 'update')),
  updated_at bigint not null,
  recorded_at bigint not null default (extract(epoch from now()) * 1000)::bigint
);

comment on table public.outbox is
  'Registre serveur des mutations appliquées. Append-only, alimenté par trigger.';

create index if not exists outbox_entity_entity_id_idx
  on public.outbox (entity, entity_id);
create index if not exists outbox_recorded_at_idx on public.outbox (recorded_at);

-- Un déclencheur par table : le code est identique, seule la table change.
create or replace function public.log_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.outbox (entity, entity_id, operation, updated_at)
  values (
    tg_table_name,
    (new).id,
    case when tg_op = 'INSERT' then 'insert' else 'update' end,
    (new).updated_at
  );
  return new;
end;
$$;

drop trigger if exists teams_log_mutation on public.teams;
create trigger teams_log_mutation
  after insert or update on public.teams
  for each row execute function public.log_mutation();

drop trigger if exists players_log_mutation on public.players;
create trigger players_log_mutation
  after insert or update on public.players
  for each row execute function public.log_mutation();

drop trigger if exists matches_log_mutation on public.matches;
create trigger matches_log_mutation
  after insert or update on public.matches
  for each row execute function public.log_mutation();

drop trigger if exists actions_log_mutation on public.actions;
create trigger actions_log_mutation
  after insert or update on public.actions
  for each row execute function public.log_mutation();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
-- Modèle : `auth.uid() = teams.owner_id`. Les tables enfants ne portent pas
-- `owner_id` — le dupliquer créerait une seconde source de vérité à tenir à
-- jour, donc une source de désynchronisation. Elles héritent du propriétaire par
-- jointure, ce qui rend impossible d'oublier la règle sur une colonne.
--
-- Chaque politique est un `for all`, donc couvre SELECT, INSERT, UPDATE **et**
-- DELETE. Une politique `for select` seule laisserait écrire à quiconque :
-- l'erreur classique, invisible tant que personne n'a inséré de données.
--
-- Le rôle `anon` n'est délibérément mentionné nulle part : il n'a aucun droit et
-- aucune politique ne s'applique à lui, donc la clé publishable utilisée sans
-- session ne renvoie aucune ligne.
--
-- -----------------------------------------------------------------------------
-- Privilèges
-- -----------------------------------------------------------------------------
-- **À exécuter avant toute vérification : c'est la première cause de « ça ne
-- synchronise pas ».**
--
-- Écrire les politiques RLS ne suffit pas. PostgreSQL teste d'abord les
-- **privilèges** du rôle, et un `create table` lancé dans l'éditeur SQL crée la
-- table **sans** accorder le moindre droit. Le rôle `authenticated` reçoit donc
-- `401 permission denied for table teams` — y compris avec une session
-- parfaitement valide. Le message ne parle ni de RLS ni de session, ce qui
-- envoie chercher au mauvais endroit pendant une heure.
--
-- Le dashboard n'a pas ce problème parce que sa création de table passe par un
-- script qui pose les droits en même temps. Notre SQL, non.
--
grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.teams, public.players, public.matches, public.actions
  to authenticated;

-- Le registre est alimenté par le déclencheur, jamais écrit par le client : seule
-- la lecture est ouverte. Autoriser l'écriture donnerait au client le moyen
-- d'effacer la trace que l'on cherche justement à conserver.
grant select on public.outbox to authenticated;

-- `anon` n'est **volontairement pas** accordée : la clé publishable est publique,
-- et le droit serait inutile puisque les RLS renverraient déjà zéro ligne. Deux
-- barrières plutôt qu'une — et c'est la seule table où l'absence de droit
-- remplace une politique.

alter table public.teams enable row level security;
alter table public.players enable row level security;
alter table public.matches enable row level security;
alter table public.actions enable row level security;
alter table public.outbox enable row level security;

drop policy if exists "teams: le propriétaire" on public.teams;
create policy "teams: le propriétaire"
  on public.teams
  for all
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "players: via l'équipe" on public.players;
create policy "players: via l'équipe"
  on public.players
  for all
  to authenticated
  using (
    exists (
      select 1 from public.teams t
      where t.id = players.team_id and t.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.teams t
      where t.id = players.team_id and t.owner_id = auth.uid()
    )
  );

drop policy if exists "matches: via l'équipe" on public.matches;
create policy "matches: via l'équipe"
  on public.matches
  for all
  to authenticated
  using (
    exists (
      select 1 from public.teams t
      where t.id = matches.team_id and t.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.teams t
      where t.id = matches.team_id and t.owner_id = auth.uid()
    )
  );

-- Les actions n'ont pas de `team_id` : le propriétaire est résolu par le match.
drop policy if exists "actions: via le match" on public.actions;
create policy "actions: via le match"
  on public.actions
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.matches m
      join public.teams t on t.id = m.team_id
      where m.id = actions.match_id and t.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.matches m
      join public.teams t on t.id = m.team_id
      where m.id = actions.match_id and t.owner_id = auth.uid()
    )
  );

-- Le registre est **en lecture seule** pour le client : il est alimenté par le
-- déclencheur, jamais écrit par l'app. Autoriser l'écriture donnerait au client
-- le moyen d'effacer la trace que l'on cherche justement à conserver.
--
-- Le filtre passe par les quatre tables, car `outbox` ne porte pas d'`owner_id` :
-- il ne connaît que des `entity_id`.
drop policy if exists "outbox: lecture du propriétaire" on public.outbox;
create policy "outbox: lecture du propriétaire"
  on public.outbox
  for select
  to authenticated
  using (
    (entity = 'teams' and exists (
      select 1 from public.teams t
      where t.id = outbox.entity_id and t.owner_id = auth.uid()
    ))
    or (entity = 'players' and exists (
      select 1
      from public.players p
      join public.teams t on t.id = p.team_id
      where p.id = outbox.entity_id and t.owner_id = auth.uid()
    ))
    or (entity = 'matches' and exists (
      select 1
      from public.matches m
      join public.teams t on t.id = m.team_id
      where m.id = outbox.entity_id and t.owner_id = auth.uid()
    ))
    or (entity = 'actions' and exists (
      select 1
      from public.actions a
      join public.matches m on m.id = a.match_id
      join public.teams t on t.id = m.team_id
      where a.id = outbox.entity_id and t.owner_id = auth.uid()
    ))
  );
