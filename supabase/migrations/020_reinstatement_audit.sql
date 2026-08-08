-- Prerequisite correction (before Milestone 6 Slice 6) — docs/decisions.md
-- § Late Payment Override (reinstatement).
--
-- New business rule: an organiser/admin may explicitly accept a late
-- payment and choose to reinstate an entry that settlement already voided
-- for non-payment. This must never happen automatically — mark_paid alone
-- never reinstates (see admin-actions/reinstate.ts) — so a durable,
-- queryable record of the explicit override is required for auditability,
-- the same reasoning entry_payments.marked_by/marked_at already serves for
-- the payment-verification decision itself. reinstated_at/reinstated_by
-- record the *reinstatement* decision specifically, which is a distinct
-- fact from "is this entry currently paid" — an entry_payments row can be
-- marked paid at any time, independent of whether an admin has since also
-- chosen to reinstate a voided game_entries row, so this can't be folded
-- into entry_payments without conflating two different decisions.
--
-- Two columns, not one boolean + one timestamp, and not a separate table:
-- reinstated_at alone is sufficient to answer "was this ever reinstated"
-- (null vs non-null) and "when" in one column — a redundant boolean would
-- be exactly the "settled boolean alongside status" mistake this schema
-- already removed once (004/schema-review.md, GE-4.5). reinstated_by
-- mirrors entry_payments.marked_by's own precedent for accountability
-- ("who authorised this"). A separate audit-log table was considered and
-- rejected as more schema than this one fact needs — no other action in
-- this codebase (settle()'s own voiding included) has its own dedicated
-- audit table; game_entries.updated_at plus these two columns is
-- sufficient, consistent with how the rest of this schema tracks
-- who/when for a state change.
--
-- Nullable, both column — every entry that has never been voided-then-
-- reinstated has both null, which is both the correct default and doubles
-- as the retry-safety signal admin-actions/reinstate.ts relies on to
-- distinguish "this entry was never voided" from "reinstatement is
-- mid-flight/being retried" (see that file's own comments).
alter table public.game_entries
  add column reinstated_at timestamptz,
  add column reinstated_by uuid references public.profiles(id);

comment on column public.game_entries.reinstated_at is
  'Late Payment Override: set the moment an admin explicitly reinstates a voided entry after accepting a late payment (admin-actions reinstate_entry). Null for every entry that has never been through this flow. Never set automatically — mark_paid alone never touches this column.';
comment on column public.game_entries.reinstated_by is
  'Late Payment Override: the admin (profiles.id) who authorised the reinstatement — same accountability purpose as entry_payments.marked_by. Null iff reinstated_at is null.';

-- No client grant on either column — this is Game-Engine/admin-action-only
-- state, same category as pots.rollover_source_pot_id/carry_over_amount
-- (013): an ordinary authenticated user must never be able to write
-- either column directly, only admin-actions' service-role client should.
-- authenticated's existing UPDATE grant on game_entries is already
-- narrowed to updated_at only (005/GE-11) via an explicit column-level
-- GRANT, which does not automatically extend to new columns — so no
-- REVOKE is needed here to keep these two columns out of reach; not
-- granting is sufficient. service_role's own broad, table-level access
-- is unaffected by column-level grants and needs no explicit statement
-- here either — verified live after applying this migration, not assumed.
