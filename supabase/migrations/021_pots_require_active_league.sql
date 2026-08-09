-- Phase 7 Stage 2 Slice 2 — automatic league selection.
--
-- New product rule: pot creation must always reference a currently active
-- league. The frontend now auto-selects the sole active league (or shows a
-- selector among several, or blocks submission if none exist), but per the
-- explicit instruction "the frontend must never be trusted as the only
-- enforcement," the same invariant is enforced here too: an authenticated
-- client can never insert a pots row whose league_id doesn't reference a
-- currently is_active league, regardless of what the client sends.
--
-- Implemented as a WITH CHECK addition to the existing insert policy
-- (pots_insert_authenticated, 002_rls_policies.sql), not a new trigger or
-- function — the smallest change that closes the gap. A CHECK constraint
-- can't express this (it depends on another table's mutable state), so RLS
-- is the correct mechanism, same as this project's own established pattern
-- for cross-row invariants. Postgres has no ALTER POLICY ... WITH CHECK, so
-- the policy is dropped and recreated with the added clause; not a rewrite
-- of 002's own file, an additive migration on top of it, same discipline as
-- every prior pots_* policy extension (e.g. 010, 013, 019's grant/trigger
-- additions).
--
-- Existing pots remain untouched — this only gates new inserts. An existing
-- pot's league later losing is_active status does not retroactively affect
-- it (no UPDATE check added, matching "existing pots remain permanently
-- linked to the league they were created with").

drop policy "pots_insert_authenticated" on public.pots;

create policy "pots_insert_authenticated"
on public.pots for insert
to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.leagues l
    where l.id = league_id
      and l.is_active = true
  )
);

comment on policy "pots_insert_authenticated" on public.pots is
  'GE-2. A pot can only ever be created by the caller themselves (created_by = auth.uid()), against a currently active league (exists check against leagues.is_active) — the same invariant the frontend''s automatic league-selection UX enforces client-side, never trusted as the only enforcement. Added 2026-08-09, Phase 7 Stage 2 Slice 2.';
