-- DESIGN ONLY — NOT YET APPLIED AT TIME OF WRITING. Drafted for review ahead
-- of Milestone 5 Slice 2, per the repo owner's explicit "design it, review
-- it, do not apply it" instruction (same pattern as
-- 010_prize_pool_deductions.sql). Supersedes an earlier same-name-series
-- draft (013_lms_tie_outcome_and_rollover.sql, never applied, never
-- committed) whose payment-model assumption was overturned — see
-- docs/decisions.md § LMS: Wipeout Resolution, automatic rollover, and a
-- fixed per-competition entry fee for that history, and § the multi-
-- generation rollover review (same file) for this revision's own reasoning.
--
-- Five additions, all GE-3 platform/mode-boundary-respecting (config on
-- pots, same as predictor_cycle_mode/predictor_scorer_scope; calculated
-- per-instance outcome on pot_prizes, same as gross/net_amount):
--
--   1. pots.wipeout_resolution — required LMS setting. Decides the payout
--      ONLY when every remaining player is eliminated in the same gameweek
--      (a "wipeout") — never consulted otherwise (the ordinary case, one
--      survivor, is simply the winner).
--   2. pots.season_end_tie_rule — required LMS setting, independent of
--      wipeout_resolution. Decides the payout when multiple players are
--      still alive at the season's actual final gameweek (not a wipeout).
--   3. pots.start_gameweek_id — the gameweek this LMS competition's picks
--      begin. Anchors a normal pot's one-time entry-window cutoff; for a
--      rollover pot, the organiser chooses it explicitly during the pot's
--      draft phase (any future gameweek, including next season's first —
--      docs/business-rules.md § Last Man Standing).
--   4. pots.rollover_source_pot_id + pots.carry_over_amount — set only by
--      the Game Engine itself, automatically, when a wipeout resolves as
--      roll_prize. No organiser ever creates or links a rollover pot by
--      hand. carry_over_amount belongs to the NEW pot alone — the source
--      pot only ever records that it ended via rollover (pot_prizes.rollover),
--      never the amount itself, so it stays an untouched historical record.
--   5. pots.rollover_generation — 0 for an original competition, N for the
--      Nth rollover in a chain (Pot A gen 0 -> Pot B gen 1 -> Pot C gen 2 ->
--      ...). Set automatically by the Game Engine as source.rollover_generation
--      + 1, same trust boundary as rollover_source_pot_id/carry_over_amount.
--      A platform value (used for lineage/reporting), not a presentation
--      label — the organiser-visible default pot name ("Rollover #2") is
--      derived from it, never the other way around.
--
-- pot_status already has a 'draft' value (001_initial_schema.sql), unused
-- anywhere until now — an automatically-created rollover pot uses it as-is,
-- no enum change needed. This is reuse, not a new mechanism.

create type public.lms_wipeout_resolution as enum ('split_prize', 'roll_prize');
create type public.lms_season_end_tie_rule as enum ('split_prize', 'final_prediction');

alter table public.pots
  add column wipeout_resolution public.lms_wipeout_resolution not null default 'split_prize',
  add column season_end_tie_rule public.lms_season_end_tie_rule not null default 'split_prize',
  add column start_gameweek_id bigint references public.gameweeks(id),
  add column rollover_source_pot_id uuid references public.pots(id) on delete restrict,
  add column carry_over_amount numeric(10,2) not null default 0
    check (carry_over_amount >= 0),
  add column rollover_generation int not null default 0
    check (rollover_generation >= 0);

comment on column public.pots.wipeout_resolution is
  'GE-5.2: only meaningful when game_type = last_man_standing. Applies only to a wipeout (every remaining player eliminated in the same gameweek) — split_prize makes them joint winners; roll_prize means no winner, this pot''s net prize becomes carry_over_amount on a new pot the Game Engine creates automatically (see rollover_source_pot_id). Immutable once the pot has entries.';
comment on column public.pots.season_end_tie_rule is
  'GE-5.2: only meaningful when game_type = last_man_standing. Independent of wipeout_resolution — applies when multiple players are still alive at the season''s actual final gameweek (not a wipeout). split_prize splits the net prize equally; final_prediction has remaining players each submit a winning-team/first-goalscorer/goal-minute prediction, resolved in that priority order. Immutable once the pot has entries.';
comment on column public.pots.start_gameweek_id is
  'GE-5.2: the first gameweek this LMS competition''s picks begin. For a normal pot, the one-time cutoff for the entry window (join before this gameweek''s earliest_kickoff_utc, never again). For a rollover pot, chosen explicitly by the organiser during its draft phase — the next gameweek, any future gameweek, or the first gameweek of the following season. Immutable once the pot has entries.';
comment on column public.pots.rollover_source_pot_id is
  'GE-5.2: set only by the Game Engine itself, automatically, when wipeout_resolution = roll_prize resolves with no winner — never by an organiser, never through the normal pot-creation path (enforced structurally: authenticated clients have no INSERT privilege on this column at all, see the grant/revoke below, not just an RLS row check). Unconditionally immutable, like game_type — this is the pot''s lineage. NULL for every pot that isn''t a Game-Engine-created rollover. Referencing an existing row only (the FK requires it), and never itself editable post-insert, makes an indirect lineage cycle structurally impossible — a pot can only ever point backward to a predecessor that already existed when it was created.';
comment on column public.pots.carry_over_amount is
  'GE-5.2: the source pot''s unclaimed net_amount (see pot_prizes.rollover), copied explicitly onto THIS pot alone at automatic-creation time — the source pot never stores or tracks this figure going forward, only the fact that it rolled over. Added to this competition''s own gross prize pool once it settles. Zero, and meaningless, unless rollover_source_pot_id is set. Unconditionally immutable, same set as rollover_source_pot_id, same client-INSERT restriction.';
comment on column public.pots.rollover_generation is
  'GE-5.2: 0 for an original LMS competition, N for the Nth pot in a rollover chain — set automatically as source.rollover_generation + 1 by the same Game Engine code path that sets rollover_source_pot_id/carry_over_amount, same trust boundary. A platform fact (lineage depth), not a display string — the default pot name ("Rollover #2") is derived from this value, never stored as the source of truth itself. Unconditionally immutable.';

alter table public.pots
  add constraint pots_rollover_source_not_self check (rollover_source_pot_id is null or rollover_source_pot_id <> id),
  add constraint pots_rollover_source_lms_only check (rollover_source_pot_id is null or game_type = 'last_man_standing'),
  add constraint pots_carry_over_requires_rollover_source check (carry_over_amount = 0 or rollover_source_pot_id is not null),
  add constraint pots_rollover_generation_consistency check (
    (rollover_generation = 0 and rollover_source_pot_id is null)
    or (rollover_generation > 0 and rollover_source_pot_id is not null)
  );

-- wipeout_resolution/season_end_tie_rule/start_gameweek_id join entry_fee's
-- existing "fairness-critical once entries exist" guarded set (GE-2);
-- rollover_source_pot_id/carry_over_amount/rollover_generation join
-- game_type's unconditional set instead — all three are set exactly once,
-- atomically, by the Game Engine at the moment it creates the pot, never
-- editable by anyone afterward, entries or not. create or replace, not a
-- rewrite of the migration that first created this function.
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
  then
    select exists (
      select 1 from public.game_entries where pot_id = old.id
    ) into v_has_entries;

    if v_has_entries then
      raise exception 'pot terms (entry_fee, end_gameweek_id, predictor_cycle_mode, predictor_scorer_scope, admin_fee_*, charity_fee_*, wipeout_resolution, season_end_tie_rule, start_gameweek_id) cannot change once the pot has entries';
    end if;
  end if;

  return new;
end;
$$;

alter table public.pot_prizes
  add column rollover boolean not null default false;

comment on column public.pot_prizes.rollover is
  'GE-5.2/GE-4.4: true only for a settled LMS pot_prizes row where wipeout_resolution = roll_prize produced no winner. net_amount on this row is the amount copied onto the new pot''s carry_over_amount at automatic-creation time. false for every ordinary settled row (Pick 5 jackpots, LMS/Predictor pots that had a real winner).';

-- Refinement found during the 2026-08-05 multi-generation rollover review
-- (docs/decisions.md, same section): pots_insert_authenticated
-- (002_rls_policies.sql) only checks `created_by = auth.uid()` — it was
-- never column-restrictive, because nothing insertable before this
-- migration needed to be. That's no longer true: rollover_source_pot_id,
-- carry_over_amount, and rollover_generation must only ever be set by the
-- Game Engine's own automatic rollover-creation code (service role, which
-- bypasses grants same as it bypasses RLS) — never by a client's own pot-
-- creation request, or any authenticated user could fabricate a fake
-- rollover lineage against a real pot they don't even belong to, inventing
-- an arbitrary carry_over_amount that would later be paid out as real
-- prize money. A row-level RLS check can't express "this column may not be
-- set" — column-level privilege is the correct tool, same pattern already
-- used for game_entries/notifications UPDATE (005_game_engine_shared_platform_rls.sql).
-- Every other pots column a legitimate client insert already relies on is
-- listed explicitly (id/created_at/updated_at excluded — always via
-- default, never supplied by any existing caller).
revoke insert on public.pots from authenticated;
grant insert (
  name, description, status, season_id, league_id, created_by, invite_code,
  max_members, game_type, entry_fee, end_gameweek_id, predictor_cycle_mode,
  predictor_scorer_scope, admin_fee_type, admin_fee_amount, admin_fee_percentage,
  charity_fee_type, charity_fee_amount, charity_fee_percentage,
  wipeout_resolution, season_end_tie_rule, start_gameweek_id
) on public.pots to authenticated;

comment on function public.prevent_pot_contract_change() is
  'GE-2/GE-5.2. UPDATE-time guard only (trg_pots_contract_immutable fires before update, never before insert) — pairs with the insert-time column grant above: rollover_source_pot_id/carry_over_amount/rollover_generation can never be set by an authenticated client at insert (no privilege) and can never be changed by anyone at update (this trigger) — the Game Engine''s service-role client is the only path that can ever populate them, and only once, at row creation.';
