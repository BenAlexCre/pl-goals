-- Milestone 4, Slice 2 (pick submission) — docs/game-engine.md § GE-5.1.
--
-- pick5_picks: the third leg of Pick 5's re-platformed shape described in
-- GE-5.1 (game_entries + game_entry_pick5 + pick5_picks). Mirrors the
-- prototype's user_entry_picks table structure and its
-- recompute-goal-threshold-on-change trigger exactly — that part of the
-- prototype was a working, correct design (docs/game-engine.md § GE-15: the
-- prototype's actual bugs were the missing lms_tiebreak_picks table and an
-- invalid 'winner' enum value, not this table). What's new here is the
-- parent (game_entries, not user_entries) and the RLS model.
--
-- RLS model deliberately departs from the prototype's user_entry_picks
-- policies (which allowed direct client insert/update while pending): picks
-- can only be written through the submit-pick5-picks Edge Function, which
-- calls the Game Engine's validateEntry() (GE-6) before persisting anything.
-- Allowing a direct client insert here would let a user bypass validateEntry()
-- entirely (eligibility, goalkeeper exclusion, exact-5 count) via a
-- structurally-valid but business-rule-invalid INSERT. This is the same
-- reasoning 005_game_engine_shared_platform_rls.sql already applied to
-- game_entry_pick5 (zero client-insert policy) — extended here to the picks
-- themselves, which is the actual GE-10 boundary ("no business logic in SQL,"
-- which includes not letting SQL/RLS alone gate a business-rule-bearing
-- write). GE-8.1's "RLS policy plus a trigger calling validateEntry() again"
-- narrative predates this and is inconsistent with GE-6 (validateEntry is a
-- TypeScript method invoked by an Edge Function, not something a SQL trigger
-- can call) — flagged for a doc correction alongside this migration rather
-- than silently followed.

create table public.pick5_picks (
  id bigserial primary key,
  game_entry_id uuid not null references public.game_entries(id) on delete cascade,
  pick_position int not null check (pick_position between 1 and 5),
  player_id bigint not null references public.players(id),
  goal_threshold int not null default 1
    check (goal_threshold >= 1),
  goals_scored int not null default 0
    check (goals_scored >= 0),
  result pick_result not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_entry_id, pick_position)
);

comment on table public.pick5_picks is
  'GE-5.1. Written only by submit-pick5-picks (service role) after Pick5Engine.validateEntry() passes — no client-reachable insert/update/delete policy exists on this table, by design (see migration header).';
comment on constraint pick5_picks_game_entry_id_fkey on public.pick5_picks is
  'Cascade is correct here, same reasoning as game_entry_pick5: a pick row has no independent existence once its parent game_entries row is gone, and carries no financial data.';

create index idx_pick5_picks_entry on public.pick5_picks (game_entry_id);
create index idx_pick5_picks_player on public.pick5_picks (player_id);

create trigger trg_pick5_picks_updated_at
before update on public.pick5_picks
for each row execute function public.set_updated_at();

-- Same derivation the prototype's recompute_goal_thresholds() performed for
-- user_entry_picks, scoped to the new parent column name. A player picked N
-- times within one entry needs N goals for *each* of those picks to count as
-- a win (docs/business-rules.md § How scoring works) — this is a count
-- derived from sibling rows, not a scoring decision, so it stays in SQL per
-- GE-10 ("SQL functions derive or guard column values only").
-- Handles all three trigger operations explicitly rather than collapsing to
-- "the row's player_id," because UPDATE is the one case with two players to
-- reconcile: moving a position from player A to player B must recompute
-- *both* A's remaining count (may now be lower) and B's new count (may now
-- be higher) — not just B's, which is all a naive "use new.player_id"
-- version would do.
create or replace function public.recompute_pick5_goal_thresholds()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    update public.pick5_picks
    set goal_threshold = (
      select count(*) from public.pick5_picks
      where game_entry_id = old.game_entry_id and player_id = old.player_id
    )
    where game_entry_id = old.game_entry_id and player_id = old.player_id;
    return old;
  end if;

  update public.pick5_picks
  set goal_threshold = (
    select count(*) from public.pick5_picks
    where game_entry_id = new.game_entry_id and player_id = new.player_id
  )
  where game_entry_id = new.game_entry_id and player_id = new.player_id;

  if tg_op = 'UPDATE' and old.player_id is distinct from new.player_id then
    update public.pick5_picks
    set goal_threshold = (
      select count(*) from public.pick5_picks
      where game_entry_id = old.game_entry_id and player_id = old.player_id
    )
    where game_entry_id = old.game_entry_id and player_id = old.player_id;
  end if;

  return new;
end;
$$;

-- "update of player_id" (not a bare "after update") matters here: picks are
-- written via upsert (game_entry_id, pick_position) from submit-pick5-picks,
-- so resubmitting a full 5-pick set runs as five per-row UPDATEs, not
-- INSERTs, once the positions already exist. Without this, changing which
-- player occupies a position on a resubmission would leave every affected
-- player's goal_threshold stale.
create trigger trg_pick5_goal_thresholds
after insert or delete or update of player_id on public.pick5_picks
for each row execute function public.recompute_pick5_goal_thresholds();

alter table public.pick5_picks enable row level security;

create policy "pick5_picks_select_member"
on public.pick5_picks for select
to authenticated
using (
  exists (
    select 1 from public.game_entries ge
    where ge.id = game_entry_id and public.is_pot_member(ge.pot_id)
  )
);
