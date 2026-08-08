-- Milestone 6, Slice 2 (pick submission) — docs/game-engine.md § GE-5.3.
--
-- Named predictor_fixture_picks, not predictor_picks — the obvious name
-- collides with the retired prototype's own supabase_admin-owned
-- predictor_picks table (ISSUE-20: "isolate, don't delete yet"), the exact
-- same collision lms_team_picks was named to avoid (015_lms_picks.sql) and
-- flagged, in that migration's own comment, as certain to repeat here.
-- Confirmed live before writing this (not assumed): predictor_picks already
-- exists, owned by supabase_admin, 0 rows.
--
-- One row per (game_entry_id, gameweek_id) — a season-scoped game_entries
-- row (GE-4.5, same shape as LMS) gets a fresh prediction every gameweek.
-- Mirrors lms_team_picks/pick5_picks wherever the shape is genuinely shared
-- (RLS model, no client-insert policy, updated_at trigger, on delete
-- cascade from game_entries since a pick has no independent existence and
-- carries no financial data itself) and departs where Score Predictor's
-- own rules genuinely differ — every departure is explained below.
--
-- Milestone 6 architecture review (docs/decisions.md § Score Predictor
-- architecture review) flagged five open product questions before this
-- table could be designed. Two were resolved as part of designing this
-- migration, not invented:
--
--   1. How is a draw predicted? Resolved by construction, not by adding a
--      column: GE-5.3 itself states scoring is "5 points exact score, OR
--      3 for correct winner (mutually exclusive)" — that framing only
--      makes sense if both are evaluated against ONE scoreline prediction,
--      not two independent picks. So this table stores only
--      predicted_home_score/predicted_away_score; "correct winner" is
--      derived at scoring time by comparing the sign of the predicted
--      score difference against the actual one. A draw is simply the case
--      predicted_home_score = predicted_away_score — no sentinel value
--      needed. This also fixes what looks like a real prototype bug: its
--      predicted_winner_team_id was NOT NULL, with no way to represent "no
--      winner" (a draw) at all.
--
--   2. Is the goalscorer prediction mandatory or optional? Repo owner
--      decided, 2026-08-06: optional. goalscorer_player_id is nullable —
--      PredictorEngine.validateEntry() accepts a pick with no scorer
--      guess; the entry simply isn't eligible for that gameweek's scorer
--      bonus. This is a genuine, decided product rule, not a default
--      guessed at here.
--
-- Two more remain genuinely open and are deliberately NOT encoded into
-- this schema, to avoid guessing at real product rules:
--
--   3. The scorer bonus's point value is not needed by this table at all
--      — only by calculateScore() (a future slice), which is what
--      actually computes and writes points_awarded below.
--
--   4. predictor_cycle_mode = 'two_halves' governs some "reuse
--      restriction" per GE-5.3's own text, but neither which
--      predictions it restricts nor how "half" is computed is specified
--      anywhere reliable (only the retired, already-known-buggy prototype
--      suggests a shape, via its own half_cycle column and per-half
--      unique constraints — not treated as authoritative, same stance
--      this whole rebuild has taken toward every prototype object).
--      Deliberately no half_cycle column and no reuse-restricting unique
--      constraint here — adding either now would mean guessing at an
--      undecided rule and then needing to migrate again once it's
--      actually decided, the exact mistake 013_lms_wipeout_and_rollover.sql's
--      own predecessor draft made. PredictorEngine.validateEntry() (this
--      slice) does not enforce any reuse restriction — flagged as
--      incomplete, not silently omitted; see decisions.md.
--
-- No `result pick_result` column, unlike pick5_picks/lms_team_picks —
-- deliberate, not an oversight. pick_result's won/lost vocabulary fits a
-- binary outcome; Score Predictor's outcome is a point value (0, 3, or 5,
-- plus a bonus) with no natural won/lost label, and forcing one on would
-- be inventing a mapping nobody's approved. points_awarded being null vs.
-- populated already distinguishes "not yet resolved" from "resolved" —
-- the one fact pick_result's 'pending' state exists to capture for the
-- other two modes — without a second, partially-redundant column.

create table public.predictor_fixture_picks (
  id bigserial primary key,
  game_entry_id uuid not null references public.game_entries(id) on delete cascade,
  gameweek_id bigint not null references public.gameweeks(id) on delete restrict,
  fixture_id bigint not null references public.fixtures(id) on delete restrict,
  predicted_home_score int not null check (predicted_home_score >= 0),
  predicted_away_score int not null check (predicted_away_score >= 0),
  goalscorer_player_id bigint references public.players(id) on delete restrict,
  points_awarded int check (points_awarded >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_entry_id, gameweek_id)
);

comment on table public.predictor_fixture_picks is
  'GE-5.3. Written only by submit-predictor-picks (service role) after PredictorEngine.validateEntry() passes — no client-reachable insert/update/delete policy exists on this table, same reasoning as pick5_picks/lms_team_picks. Named predictor_fixture_picks, not predictor_picks, to avoid colliding with the retired prototype''s own supabase_admin-owned predictor_picks table (ISSUE-20) — confirmed live, not theoretical.';
comment on constraint predictor_fixture_picks_game_entry_id_fkey on public.predictor_fixture_picks is
  'Cascade is correct here, same reasoning as pick5_picks/lms_team_picks: a pick row has no independent existence once its parent game_entries row is gone, and carries no financial data.';
comment on column public.predictor_fixture_picks.goalscorer_player_id is
  'GE-5.3. Nullable, decided 2026-08-06 (Milestone 6 Slice 2 architecture review): the goalscorer prediction is optional. A pick with no scorer guess is a fully valid submission — it is simply never eligible for that gameweek''s scorer bonus.';
comment on column public.predictor_fixture_picks.points_awarded is
  'GE-6 calculateScore() territory (not written by this migration or Slice 2) — null means not yet resolved, a non-negative integer once scored. No separate result/status column: unlike pick_result''s won/lost vocabulary, Score Predictor''s outcome is a point value with no natural binary label, and null-vs-populated already distinguishes unresolved from resolved.';
comment on constraint predictor_fixture_picks_game_entry_id_gameweek_id_key on public.predictor_fixture_picks is
  'GE-5.3: one fixture predicted per gameweek — enforced here, not just in PredictorEngine.validateEntry(), same "constraint not just convention" standard the rest of this schema holds to.';

create index idx_predictor_fixture_picks_entry on public.predictor_fixture_picks (game_entry_id);
create index idx_predictor_fixture_picks_fixture on public.predictor_fixture_picks (fixture_id);

create trigger trg_predictor_fixture_picks_updated_at
before update on public.predictor_fixture_picks
for each row execute function public.set_updated_at();

alter table public.predictor_fixture_picks enable row level security;

create policy "predictor_fixture_picks_select_member"
on public.predictor_fixture_picks for select
to authenticated
using (
  exists (
    select 1 from public.game_entries ge
    where ge.id = game_entry_id and public.is_pot_member(ge.pot_id)
  )
);
