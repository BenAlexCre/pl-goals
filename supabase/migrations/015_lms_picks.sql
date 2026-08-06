-- Milestone 5, Slice 2 (pick submission) — docs/game-engine.md § GE-5.2.
--
-- Named lms_team_picks, not lms_picks — the obvious name collides with the
-- retired prototype's own supabase_admin-owned lms_picks table (ISSUE-20:
-- "isolate, don't delete yet"), confirmed live the moment this migration
-- was first attempted ("relation lms_picks already exists"). Same collision
-- would hit predictor_picks in Milestone 6 — worth remembering then, not
-- solved here since that table doesn't exist yet.
--
-- One row per (game_entry_id, gameweek_id) — a season-scoped game_entries
-- row gets a fresh pick every gameweek, unlike Pick 5's gameweek-scoped
-- entry which gets one full pick set per row. Mirrors pick5_picks
-- (007_pick5_picks.sql) wherever the shape is genuinely shared (RLS model,
-- no-client-insert policy, updated_at trigger) and departs only where LMS
-- itself differs: one team, not five players; result reuses the existing
-- pick_result enum (001_initial_schema.sql) rather than inventing a
-- parallel one, since 'pending'/'won'/'lost'/'void' already mean exactly
-- what an LMS pick's outcome needs.
--
-- No cycle/current_cycle column here or anywhere else in this table — per
-- 014_lms_remove_cycle.sql, a team may never be picked twice across the
-- whole competition, enforced by unique (game_entry_id, team_id) below with
-- no cycle scoping whatsoever.

create table public.lms_team_picks (
  id bigserial primary key,
  game_entry_id uuid not null references public.game_entries(id) on delete cascade,
  gameweek_id bigint not null references public.gameweeks(id) on delete restrict,
  team_id bigint not null references public.teams(id) on delete restrict,
  result pick_result not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_entry_id, gameweek_id),
  unique (game_entry_id, team_id)
);

comment on table public.lms_team_picks is
  'GE-5.2. Written only by submit-lms-pick (service role) after LmsEngine.validateEntry() passes — no client-reachable insert/update/delete policy exists on this table, same reasoning as pick5_picks (007_pick5_picks.sql). Named lms_team_picks, not lms_picks, to avoid colliding with the retired prototype''s own supabase_admin-owned lms_picks table (ISSUE-20) — confirmed live, not theoretical.';
comment on constraint lms_team_picks_game_entry_id_fkey on public.lms_team_picks is
  'Cascade is correct here, same reasoning as pick5_picks: a pick row has no independent existence once its parent game_entries row is gone, and carries no financial data.';
comment on constraint lms_team_picks_game_entry_id_team_id_key on public.lms_team_picks is
  'GE-5.2: a team may never be picked twice across the whole competition (no cycles, decided 2026-08-05) — enforced here, not just in LmsEngine.validateEntry(), same "constraint not just convention" standard the rest of this schema holds to.';

create index idx_lms_team_picks_entry on public.lms_team_picks (game_entry_id);
create index idx_lms_team_picks_team on public.lms_team_picks (team_id);

create trigger trg_lms_team_picks_updated_at
before update on public.lms_team_picks
for each row execute function public.set_updated_at();

alter table public.lms_team_picks enable row level security;

create policy "lms_team_picks_select_member"
on public.lms_team_picks for select
to authenticated
using (
  exists (
    select 1 from public.game_entries ge
    where ge.id = game_entry_id and public.is_pot_member(ge.pot_id)
  )
);
