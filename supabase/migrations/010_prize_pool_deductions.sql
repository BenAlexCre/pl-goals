-- DESIGN ONLY — NOT APPLIED. Drafted for review ahead of Milestone 4 Slice 8,
-- per the repo owner's explicit "design it, review it, do not apply it"
-- instruction. docs/decisions.md § Prize pool deductions (Admin Fee, Charity
-- Fee) records the full investigation this migration implements.
--
-- Configuration (admin_fee_*/charity_fee_*) lives on pots — shared platform
-- data, reusable by every mode's awardPrize() (Pick 5 now; LMS/Predictor
-- later), per GE-3's platform/mode boundary. The calculated OUTCOME for a
-- specific competition instance (gross/admin fee/charity fee/net, in euros,
-- not config) lives on pot_prizes — one row per instance, per the pot_prizes
-- lifecycle decision (lazy creation inside awardPrize()).

create type public.fee_type as enum ('none', 'fixed', 'percentage');

alter table public.pots
  add column admin_fee_type public.fee_type not null default 'none',
  add column admin_fee_amount numeric(10,2),
  add column admin_fee_percentage numeric(5,2),
  add column charity_fee_type public.fee_type not null default 'none',
  add column charity_fee_amount numeric(10,2),
  add column charity_fee_percentage numeric(5,2);

-- "Never both fixed and percentage" (explicit requirement) enforced
-- structurally, not just trusted to application code — matching this
-- project's own established pattern (GE-13: "explicit column, not an
-- inference from nullability alone" for pot_scope/entry_scope). The type
-- discriminator is the source of truth; each value column is populated only
-- when its own type is selected, enforced by CHECK, not convention.
alter table public.pots
  add constraint pots_admin_fee_consistency check (
    (admin_fee_type = 'none' and admin_fee_amount is null and admin_fee_percentage is null)
    or (admin_fee_type = 'fixed' and admin_fee_amount is not null and admin_fee_percentage is null)
    or (admin_fee_type = 'percentage' and admin_fee_percentage is not null and admin_fee_amount is null)
  ),
  add constraint pots_charity_fee_consistency check (
    (charity_fee_type = 'none' and charity_fee_amount is null and charity_fee_percentage is null)
    or (charity_fee_type = 'fixed' and charity_fee_amount is not null and charity_fee_percentage is null)
    or (charity_fee_type = 'percentage' and charity_fee_percentage is not null and charity_fee_amount is null)
  ),
  add constraint pots_admin_fee_amount_check check (admin_fee_amount is null or admin_fee_amount >= 0),
  add constraint pots_admin_fee_percentage_check check (admin_fee_percentage is null or (admin_fee_percentage >= 0 and admin_fee_percentage <= 100)),
  add constraint pots_charity_fee_amount_check check (charity_fee_amount is null or charity_fee_amount >= 0),
  add constraint pots_charity_fee_percentage_check check (charity_fee_percentage is null or (charity_fee_percentage >= 0 and charity_fee_percentage <= 100));

comment on column public.pots.admin_fee_type is
  'Prize pool deduction config (GE-4.1 extension). None/fixed/percentage — never both fixed and percentage, enforced by pots_admin_fee_consistency. Config only; the calculated euro amount for a specific competition instance is recorded on pot_prizes, not here.';
comment on column public.pots.charity_fee_type is
  'Same shape and reasoning as admin_fee_type — a second, independent optional deduction.';

-- These are exactly as fairness-critical as entry_fee once money/picks are
-- committed (GE-2) — changing the deduction rate mid-competition would be
-- the identical problem entry_fee's own immutability already guards
-- against. Extends the existing trigger function (create or replace — this
-- is a new migration adding to prevent_pot_contract_change()'s guarded
-- column set, not a rewrite of the migration that first created it).
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
     or new.admin_fee_type is distinct from old.admin_fee_type
     or new.admin_fee_amount is distinct from old.admin_fee_amount
     or new.admin_fee_percentage is distinct from old.admin_fee_percentage
     or new.charity_fee_type is distinct from old.charity_fee_type
     or new.charity_fee_amount is distinct from old.charity_fee_amount
     or new.charity_fee_percentage is distinct from old.charity_fee_percentage
  then
    select exists (
      select 1 from public.game_entries where pot_id = old.id
    ) into v_has_entries;

    if v_has_entries then
      raise exception 'pot terms (entry_fee, end_gameweek_id, predictor_cycle_mode, predictor_scorer_scope, admin_fee_*, charity_fee_*) cannot change once the pot has entries';
    end if;
  end if;

  return new;
end;
$$;

-- pot_prizes: rename total_amount -> gross_amount (zero live rows exist —
-- confirmed live before drafting this — so this is a clean rename, not a
-- data migration). Add the calculated deduction outcome columns. net_amount
-- is GENERATED, not independently writable — same reasoning Milestone 2's
-- review already applied to remove game_entries.settled ("two independently
-- writable columns for one fact is a drift risk," GE-13): net can never
-- silently disagree with gross/admin_fee_amount/charity_fee_amount because
-- it isn't a fourth fact, it's a computation of the other three.
alter table public.pot_prizes
  rename column total_amount to gross_amount;

alter table public.pot_prizes
  rename constraint pot_prizes_total_amount_check to pot_prizes_gross_amount_check;

alter table public.pot_prizes
  add column admin_fee_amount numeric(10,2) not null default 0
    check (admin_fee_amount >= 0),
  add column charity_fee_amount numeric(10,2) not null default 0
    check (charity_fee_amount >= 0),
  add column net_amount numeric(10,2)
    generated always as (gross_amount - admin_fee_amount - charity_fee_amount) stored
    check (net_amount >= 0);

comment on column public.pot_prizes.gross_amount is
  'The full prize pool before deductions, for this specific competition instance (entry_fee x verified-paid settled entries at award time) — GE-4.4. Was named total_amount before this migration; renamed for clarity now that gross/net are distinct concepts, done while the table has zero live rows.';
comment on column public.pot_prizes.admin_fee_amount is
  'The calculated euro amount actually deducted for this instance — derived from pots.admin_fee_type/amount/percentage at award time, not the config itself. 0 if pots.admin_fee_type was ''none''.';
comment on column public.pot_prizes.charity_fee_amount is
  'Same shape and reasoning as admin_fee_amount, for the independent charity deduction.';
comment on column public.pot_prizes.net_amount is
  'gross_amount - admin_fee_amount - charity_fee_amount, generated (never independently written). The Game Engine distributes only this amount, never gross_amount — the CHECK (>= 0) makes a fee configuration that would exceed the gross pool a hard write failure, not a silent negative/clamped value, so awardPrize() must handle that case explicitly rather than ever produce one.';
