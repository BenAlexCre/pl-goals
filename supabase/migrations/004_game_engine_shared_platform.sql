-- Milestone 2 (docs/game-engine.md): shared schema, shared payment architecture,
-- shared entry architecture. Written to be correct when replayed from scratch
-- against an empty database, per engineering-principles.md's "every schema
-- change is a migration" rule — supabase/migrations/ must stay trustworthy as
-- the source of truth, so this does not special-case the live project's
-- current, out-of-band state.
--
-- IMPORTANT — sequencing dependency, not yet satisfied on the live project:
-- pots.game_type/entry_fee/end_gameweek_id/predictor_cycle_mode, and the
-- game_type/predictor_cycle_mode/lms_status enum types, already exist live
-- today, but as prototype objects owned by supabase_admin (see current-state.md
-- and the ownership investigation in session-log.md). This migration creates
-- the real, postgres-owned versions under the same names. It CANNOT be applied
-- to the current live database until those prototype objects are removed first
-- (a manual step — dropping them requires supabase_admin-level access, which
-- this project's postgres role does not have; see the ownership investigation
-- for why). On a fresh database (`supabase db reset`, or a new environment)
-- this migration is self-contained and needs no such prerequisite.
--
-- Revised after docs/schema-review.md: applies every Critical / Required-before-
-- launch finding from that review (cascade->restrict, shared pot_scope enum,
-- dropped redundant settled column, broadened contract-immutability trigger,
-- missing check constraints, pot_prizes.updated_at). Findings classified
-- Recommended/Optional (extra indexes, redeem_invite's max_members/status
-- checks, dropping pots.game_type's default) are deliberately not included —
-- see the classification table in session-log.md.
--
-- Every section cites the GE-N id of the docs/game-engine.md paragraph it implements.

-- ---------------------------------------------------------------------------
-- GE-4.1 pots: the game-mode extension. Recreated here (not left as
-- prototype-only) so the migration history is the actual source of truth.
-- ---------------------------------------------------------------------------

create type game_type as enum ('pick5', 'last_man_standing', 'score_predictor');
create type predictor_cycle_mode as enum ('two_halves', 'single_cycle');
create type predictor_scorer_scope as enum ('fixture_only', 'gameweek_wide');

-- Shared scope discriminator (schema-review.md #2) — one representation of
-- "gameweek-scoped vs season-scoped," reused by pot_prizes, game_entries, and
-- entry_payments below, instead of three different ad hoc conventions.
create type pot_scope as enum ('gameweek', 'season');

alter table public.pots
  add column game_type game_type not null default 'pick5',
  add column entry_fee numeric(10,2) not null default 0
    check (entry_fee >= 0),
  add column end_gameweek_id bigint references public.gameweeks(id),
  add column predictor_cycle_mode predictor_cycle_mode not null default 'two_halves',
  add column predictor_scorer_scope predictor_scorer_scope not null default 'gameweek_wide';

comment on column public.pots.game_type is
  'GE-2: immutable after creation, enforced by trg_pots_contract_immutable below.';
comment on column public.pots.predictor_cycle_mode is
  'GE-5.3: only meaningful when game_type = score_predictor. Immutable once the pot has entries (trg_pots_contract_immutable).';
comment on column public.pots.predictor_scorer_scope is
  'GE-5.3: only meaningful when game_type = score_predictor. Whether the goalscorer bonus requires the scorer to have played in the predicted fixture, or anywhere in that gameweek. Immutable once the pot has entries.';

-- schema-review.md #4: broadened from game_type-only to the whole "competition
-- contract" (entry_fee, end_gameweek_id, predictor_cycle_mode,
-- predictor_scorer_scope) — all fairness-critical once real money/picks are
-- committed. game_type stays unconditionally immutable (GE-2); the other four
-- are immutable only once the pot has at least one game_entries row, so a
-- pre-launch admin correction is still possible.
create or replace function public.prevent_pot_contract_change()
returns trigger
language plpgsql
as $$
declare
  v_has_entries boolean;
begin
  if new.game_type is distinct from old.game_type then
    raise exception 'pots.game_type cannot be changed after creation (GE-2)';
  end if;

  if new.entry_fee is distinct from old.entry_fee
     or new.end_gameweek_id is distinct from old.end_gameweek_id
     or new.predictor_cycle_mode is distinct from old.predictor_cycle_mode
     or new.predictor_scorer_scope is distinct from old.predictor_scorer_scope
  then
    select exists (
      select 1 from public.game_entries where pot_id = old.id
    ) into v_has_entries;

    if v_has_entries then
      raise exception 'pot terms (entry_fee, end_gameweek_id, predictor_cycle_mode, predictor_scorer_scope) cannot change once the pot has entries';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_pots_contract_immutable
before update on public.pots
for each row execute function public.prevent_pot_contract_change();

-- ---------------------------------------------------------------------------
-- GE-4.3 entry_payments: generalized from gameweek-only to also support a
-- single whole-pot payment for season-scoped modes. Existing rows are
-- unaffected — every current row already has a non-null gameweek_id, and the
-- new scope column defaults to 'gameweek' to match that exactly.
-- ---------------------------------------------------------------------------

alter table public.entry_payments
  alter column gameweek_id drop not null,
  add column scope pot_scope not null default 'gameweek';

alter table public.entry_payments
  add constraint entry_payments_scope_consistency
  check (
    (scope = 'season' and gameweek_id is null)
    or (scope = 'gameweek' and gameweek_id is not null)
  );

create unique index entry_payments_pot_user_season_key
  on public.entry_payments (pot_id, user_id)
  where gameweek_id is null;

comment on column public.entry_payments.scope is
  'GE-4.3 / schema-review.md #2: gameweek = per-gameweek payment (Pick 5), season = one whole-pot payment (LMS, Predictor). Consistency with gameweek_id enforced by entry_payments_scope_consistency.';

-- ---------------------------------------------------------------------------
-- GE-4.4 pot_prizes — replaces the retired prototype's gameweek_pots, which
-- turned out to be Pick 5's own unbuilt weekly-jackpot feature, not an
-- LMS/Predictor concern. One table, a scope discriminator, serves both shapes.
-- ---------------------------------------------------------------------------

create table public.pot_prizes (
  id uuid primary key default gen_random_uuid(),
  pot_id uuid not null references public.pots(id) on delete restrict,
  scope pot_scope not null,
  gameweek_id bigint references public.gameweeks(id) on delete restrict,
  total_amount numeric(10,2) not null default 0
    check (total_amount >= 0),
  is_settled boolean not null default false,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope = 'season' and gameweek_id is null)
    or (scope = 'gameweek' and gameweek_id is not null)
  )
);

comment on constraint pot_prizes_pot_id_fkey on public.pot_prizes is
  'schema-review.md #1: restrict, not cascade — a pot with money attached must never be silently deletable.';

create trigger trg_pot_prizes_updated_at
before update on public.pot_prizes
for each row execute function public.set_updated_at();

create unique index pot_prizes_gameweek_key
  on public.pot_prizes (pot_id, gameweek_id)
  where scope = 'gameweek';

create unique index pot_prizes_season_key
  on public.pot_prizes (pot_id)
  where scope = 'season';

-- ---------------------------------------------------------------------------
-- GE-4.5 game_entries — the shared parent, plus its three thin per-mode
-- extension tables. Only the entry-level shell ships in this milestone; the
-- pick tables themselves (pick5_picks, lms_picks, predictor_picks) are
-- Milestone 4/5/6 work, per docs/game-engine.md's own sequencing.
-- ---------------------------------------------------------------------------

create type lms_competitive_status as enum ('alive', 'eliminated');

create table public.game_entries (
  id uuid primary key default gen_random_uuid(),
  pot_id uuid not null references public.pots(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  gameweek_id bigint references public.gameweeks(id) on delete restrict,
  entry_scope pot_scope not null default 'gameweek',
  status entry_status not null default 'pending',
  payout_amount numeric(10,2) not null default 0
    check (payout_amount >= 0),
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (entry_scope = 'season' and gameweek_id is null)
    or (entry_scope = 'gameweek' and gameweek_id is not null)
  )
);

comment on constraint game_entries_pot_id_fkey on public.game_entries is
  'schema-review.md #1: restrict, not cascade — an entry with payout_amount attached must never be silently deletable.';
comment on column public.game_entries.entry_scope is
  'GE-4.5 / schema-review.md #2: gameweek = a recurring weekly entry (Pick 5). season = one entry for the pot''s whole life (LMS, Predictor). Consistency with gameweek_id enforced by the table check constraint.';
comment on column public.game_entries.status is
  'The single source of truth for this entry''s administrative lifecycle, including settlement (status = ''settled''). schema-review.md #3: there is deliberately no separate "settled" boolean — that was a duplicate of this column and has been removed.';

create trigger trg_game_entries_updated_at
before update on public.game_entries
for each row execute function public.set_updated_at();

-- Pick 5 shape: one entry per (pot, user) per gameweek.
create unique index game_entries_gameweek_key
  on public.game_entries (pot_id, user_id, gameweek_id)
  where gameweek_id is not null;

-- LMS / Predictor shape: exactly one entry per (pot, user) for the pot's whole life.
create unique index game_entries_season_key
  on public.game_entries (pot_id, user_id)
  where gameweek_id is null;

create index idx_game_entries_pot on public.game_entries (pot_id);
create index idx_game_entries_user on public.game_entries (user_id);

create table public.game_entry_pick5 (
  game_entry_id uuid primary key references public.game_entries(id) on delete cascade,
  picks_won int not null default 0,
  picks_total int not null default 5,
  check (picks_won >= 0 and picks_won <= picks_total)
);

comment on constraint game_entry_pick5_game_entry_id_fkey on public.game_entry_pick5 is
  'Cascade is correct here (unlike game_entries itself): this row has no independent existence or financial data of its own once its parent game_entries row is gone.';

create table public.game_entry_lms (
  game_entry_id uuid primary key references public.game_entries(id) on delete cascade,
  competitive_status lms_competitive_status not null default 'alive',
  eliminated_gameweek_id bigint references public.gameweeks(id),
  current_cycle int not null default 1
    check (current_cycle >= 1),
  check ((competitive_status = 'eliminated') = (eliminated_gameweek_id is not null))
);

comment on column public.game_entry_lms.competitive_status is
  'GE-5.2: alive or eliminated only. Winning is represented by payout_amount > 0 and status = settled on the parent game_entries row while still alive — no separate "winner" value, deliberately (see GE-13).';

create table public.game_entry_predictor (
  game_entry_id uuid primary key references public.game_entries(id) on delete cascade,
  total_points int not null default 0
    check (total_points >= 0),
  exact_score_count int not null default 0
    check (exact_score_count >= 0),
  correct_scorer_count int not null default 0
    check (correct_scorer_count >= 0)
);

-- ---------------------------------------------------------------------------
-- GE-4.6 pot_standings_snapshots — replaces the Pick-5-only leaderboard_snapshots.
-- ---------------------------------------------------------------------------

create table public.pot_standings_snapshots (
  id bigserial primary key,
  pot_id uuid not null references public.pots(id) on delete cascade,
  gameweek_id bigint references public.gameweeks(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  rank int not null
    check (rank >= 1),
  score numeric not null default 0,
  meta jsonb,
  snapshot_at timestamptz not null default now()
);

create unique index pot_standings_gameweek_key
  on public.pot_standings_snapshots (pot_id, gameweek_id, user_id)
  where gameweek_id is not null;

create unique index pot_standings_overall_key
  on public.pot_standings_snapshots (pot_id, user_id)
  where gameweek_id is null;

comment on column public.pot_standings_snapshots.meta is
  'GE-4.6: display-only metadata (strike rate, elimination gameweek, exact-score count). Never queried or joined on — see GE-15 on JSON usage.';

-- ---------------------------------------------------------------------------
-- GE-4.7 Invitations — redemption path for the existing (unused) pots.invite_code.
-- Membership creation only; mode-specific entry auto-creation is wired in as
-- each mode's Game Engine lands (Milestones 4-6), not here. max_members/status
-- enforcement (schema-review.md #5) is deliberately deferred to Milestone 7,
-- when this function actually gets a UI caller — see session-log.md.
-- ---------------------------------------------------------------------------

create or replace function public.redeem_invite(p_invite_code text)
returns public.pot_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pot_id uuid;
  v_member public.pot_members;
begin
  select id into v_pot_id
  from public.pots
  where invite_code = p_invite_code;

  if v_pot_id is null then
    raise exception 'Invalid invite code';
  end if;

  if exists (
    select 1 from public.pot_members
    where pot_id = v_pot_id and user_id = auth.uid()
  ) then
    raise exception 'Already a member of this pot';
  end if;

  insert into public.pot_members (pot_id, user_id, role)
  values (v_pot_id, auth.uid(), 'member')
  returning * into v_member;

  return v_member;
end;
$$;

revoke execute on function public.redeem_invite(text) from public, anon;
grant execute on function public.redeem_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- GE-4.8 Notifications — schema only. Delivery mechanism is out of scope
-- (see GE-15); this milestone only establishes the seam every Game Engine's
-- notifyUsers() writes to.
-- ---------------------------------------------------------------------------

create table public.notifications (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  pot_id uuid references public.pots(id) on delete cascade,
  type text not null,
  payload jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_notifications_user on public.notifications (user_id);
