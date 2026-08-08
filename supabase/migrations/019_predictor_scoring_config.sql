-- Milestone 6, Slice 4 (scoring) — docs/game-engine.md § GE-5.3 / GE-6.
--
-- Repo owner decision, 2026-08-08 (asked directly rather than guessing —
-- the original AskUserQuestion offered fixed 5/3/2 point values, and the
-- repo owner asked for configurable-per-pot instead, defaulting to
-- 5/3/2): Score Predictor's three point values (exact scoreline, correct
-- result, goalscorer bonus) are per-pot settings, not fixed platform
-- constants — same shape as `predictor_cycle_mode`/`predictor_scorer_scope`
-- (010/004) and `admin_fee_*`/`charity_fee_*` (010): configuration on
-- `pots`, guarded by the existing contract-immutability trigger once a pot
-- has entries (GE-2), with sensible defaults so most organisers never need
-- to touch them.
--
-- Named predictor_exact_score_points / predictor_correct_result_points /
-- predictor_scorer_bonus_points, not e.g. exact_score_points, to keep the
-- existing predictor_* naming convention `pots` already uses
-- (predictor_cycle_mode, predictor_scorer_scope) — a future reader
-- scanning `\d pots` can immediately tell which columns are Score
-- Predictor-specific without reading a comment.
--
-- GE-5.3's own text ("5 points exact score, OR 3 for correct winner
-- (mutually exclusive), plus a scorer bonus") is the *default* shape, now
-- configurable rather than hard-coded — a pot admin could, for instance,
-- set predictor_correct_result_points = predictor_exact_score_points to
-- stop rewarding exact precision over a plain correct result, or set
-- predictor_scorer_bonus_points high enough to rival the base points.
-- Deliberately NO ordering constraint between the three (e.g. exact >=
-- result >= bonus) — no existing pot-config column in this schema
-- constrains one setting's value relative to another's (admin_fee_percentage
-- and charity_fee_percentage are independent; entry_fee has no relation to
-- any fee), and inventing one here would be a new, unasked-for rule.

alter table public.pots
  add column predictor_exact_score_points int not null default 5
    check (predictor_exact_score_points >= 0),
  add column predictor_correct_result_points int not null default 3
    check (predictor_correct_result_points >= 0),
  add column predictor_scorer_bonus_points int not null default 2
    check (predictor_scorer_bonus_points >= 0);

comment on column public.pots.predictor_exact_score_points is
  'GE-5.3: only meaningful when game_type = score_predictor. Points awarded for predicting a fixture''s exact scoreline. Default 5 (GE-5.3''s own stated default). Immutable once the pot has entries (trg_pots_contract_immutable).';
comment on column public.pots.predictor_correct_result_points is
  'GE-5.3: only meaningful when game_type = score_predictor. Points awarded for predicting the correct result (winner, or a draw) without the exact scoreline — mutually exclusive with predictor_exact_score_points on any single prediction, never both. Default 3. Immutable once the pot has entries.';
comment on column public.pots.predictor_scorer_bonus_points is
  'GE-5.3: only meaningful when game_type = score_predictor. Points awarded when the optional goalscorer prediction is correct (scope controlled independently by predictor_scorer_scope) — always additive, on top of exact-score or correct-result points, never mutually exclusive with either. Default 2. Immutable once the pot has entries.';

-- Same "fairness-critical once real picks are committed" guarded set as
-- entry_fee/predictor_cycle_mode/predictor_scorer_scope/admin_fee_*/
-- charity_fee_*/wipeout_resolution/season_end_tie_rule/start_gameweek_id —
-- create or replace, not a rewrite of the migration that first created
-- this function (004_game_engine_shared_platform.sql), same pattern
-- 010/013 already used to extend it.
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

  if new.rollover_source_pot_id is distinct from old.rollover_source_pot_id
     or new.carry_over_amount is distinct from old.carry_over_amount
     or new.rollover_generation is distinct from old.rollover_generation
  then
    raise exception 'pots.rollover_source_pot_id, pots.carry_over_amount, and pots.rollover_generation cannot be changed after creation (GE-5.2)';
  end if;

  if new.entry_fee is distinct from old.entry_fee
     or new.end_gameweek_id is distinct from old.end_gameweek_id
     or new.predictor_cycle_mode is distinct from old.predictor_cycle_mode
     or new.predictor_scorer_scope is distinct from old.predictor_scorer_scope
     or new.admin_fee_type is distinct from old.admin_fee_type
     or new.admin_fee_amount is distinct from old.admin_fee_amount
     or new.admin_fee_percentage is distinct from old.admin_fee_percentage
     or new.charity_fee_type is distinct from old.charity_fee_type
     or new.charity_fee_amount is distinct from old.charity_fee_amount
     or new.charity_fee_percentage is distinct from old.charity_fee_percentage
     or new.wipeout_resolution is distinct from old.wipeout_resolution
     or new.season_end_tie_rule is distinct from old.season_end_tie_rule
     or new.start_gameweek_id is distinct from old.start_gameweek_id
     or new.predictor_exact_score_points is distinct from old.predictor_exact_score_points
     or new.predictor_correct_result_points is distinct from old.predictor_correct_result_points
     or new.predictor_scorer_bonus_points is distinct from old.predictor_scorer_bonus_points
  then
    select exists (
      select 1 from public.game_entries where pot_id = old.id
    ) into v_has_entries;

    if v_has_entries then
      raise exception 'pot terms (entry_fee, end_gameweek_id, predictor_cycle_mode, predictor_scorer_scope, admin_fee_*, charity_fee_*, wipeout_resolution, season_end_tie_rule, start_gameweek_id, predictor_exact_score_points, predictor_correct_result_points, predictor_scorer_bonus_points) cannot change once the pot has entries';
    end if;
  end if;

  return new;
end;
$$;

-- Additive column-privilege grant — Postgres accumulates GRANT INSERT (col)
-- statements rather than replacing the existing set, so this does not need
-- to repeat 013_lms_wipeout_and_rollover.sql's full column list, only add
-- the three new ones. Same reasoning as that migration's own grant: an
-- authenticated pot-creation request must be able to set these (they're
-- ordinary, non-privileged config, not something only the Game Engine
-- should ever set — unlike rollover_source_pot_id/carry_over_amount/
-- rollover_generation, which are deliberately excluded from any client
-- grant).
grant insert (
  predictor_exact_score_points, predictor_correct_result_points, predictor_scorer_bonus_points
) on public.pots to authenticated;

-- predictor_fixture_picks: two new facts needed for PredictorEngine.calculateScore()
-- (Slice 4) to correctly maintain game_entry_predictor's exact_score_count/
-- correct_scorer_count as the points-per-outcome values above are now
-- configurable, not fixed. Without these, aggregating "how many of this
-- entry's picks were an exact score" from points_awarded alone would be
-- ambiguous the moment a pot's predictor_correct_result_points +
-- predictor_scorer_bonus_points happens to equal predictor_exact_score_points
-- — a real, not hypothetical, collision now that all three are
-- independently configurable. Both boolean, not null default false — the
-- pick's own resolution state is already tracked by points_awarded's
-- nullability (Slice 2), so these don't need a separate "unresolved"
-- state; they simply start false and are set once, together with
-- points_awarded, the one time a pick is actually resolved.
alter table public.predictor_fixture_picks
  add column is_exact_score boolean not null default false,
  add column scorer_bonus_awarded boolean not null default false;

comment on column public.predictor_fixture_picks.is_exact_score is
  'GE-6 calculateScore() territory. Set once, alongside points_awarded, when the fixture finishes. Exists separately from points_awarded because the point VALUES are now per-pot configurable (019_predictor_scoring_config.sql) and could collide (e.g. correct-result + scorer-bonus points equalling exact-score points) — this is the unambiguous source of truth game_entry_predictor.exact_score_count aggregates from.';
comment on column public.predictor_fixture_picks.scorer_bonus_awarded is
  'GE-6 calculateScore() territory. Same reasoning as is_exact_score — the unambiguous source of truth game_entry_predictor.correct_scorer_count aggregates from, independent of the configurable point value.';
