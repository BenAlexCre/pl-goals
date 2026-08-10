-- Product rule revision, 2026-08-09 (repo owner decision, "Design A" —
-- see docs/decisions.md § Pick 5 jackpot and season rollover for the full
-- review and approved design). Pick 5's win condition changes from
-- "rank 1 of the gameweek" to "exactly 5/5" — most weeks now have zero
-- winners, and an unclaimed week's net prize accumulates into the next
-- gameweek's pool until someone hits 5/5, or the season ends, in which
-- case it rolls into a new pot for next season.
--
-- The ONLY schema change this design needs: pots_rollover_source_lms_only
-- (013_lms_wipeout_and_rollover.sql) hard-restricts rollover_source_pot_id
-- to game_type = 'last_man_standing'. Pick 5 needs the identical mechanism
-- (a new draft pot, created automatically, carrying forward an unclaimed
-- balance) — reusing every other rollover column/index/trigger as-is:
--   - rollover_source_pot_id / carry_over_amount / rollover_generation:
--     already generic pots columns, never LMS-specific at the schema
--     level (only this one CHECK constraint made them so).
--   - pot_prizes.rollover: already documented generically ("true only for
--     a settled row where [the mode's own resolution] produced no
--     winner... false for every ordinary settled row (Pick 5 jackpots,
--     LMS/Predictor pots that had a real winner)" — 013's own comment
--     already anticipated Pick 5 using this column, unchanged).
--   - the client-INSERT column-privilege restriction on
--     rollover_source_pot_id/carry_over_amount/rollover_generation
--     (013's own grant statement) already covers every game_type equally
--     — it was never mode-scoped, only column-scoped.
-- No new columns, no new tables — this is a one-line constraint widening.

alter table public.pots
  drop constraint pots_rollover_source_lms_only;

alter table public.pots
  add constraint pots_rollover_source_lms_or_pick5_only
  check (
    rollover_source_pot_id is null
    or game_type in ('last_man_standing', 'pick5')
  );

comment on constraint pots_rollover_source_lms_or_pick5_only on public.pots is
  'GE-5.2 / Pick 5 jackpot rollover (2026-08-09): rollover_source_pot_id may only be set on an LMS or Pick 5 pot — Score Predictor has no rollover concept of its own (see decisions.md § Score Predictor architecture review, the still-undecided two_halves payout question is unrelated). Widened from pots_rollover_source_lms_only, which this migration drops, when Pick 5 gained the identical need.';
