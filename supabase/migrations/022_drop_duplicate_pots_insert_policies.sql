-- Phase 7 Stage 2 Slice 2 — found while live-verifying 021's own new
-- league-activity check, not assumed.
--
-- 021_pots_require_active_league.sql tightened pots_insert_authenticated's
-- WITH CHECK to also require an active league. Live-verifying it (a direct
-- REST insert against a league flipped to is_active=false) still
-- succeeded — RLS policies for the same command are OR'd together
-- (021's own comment already states this), and a live audit of every
-- INSERT policy on public.pots found two more, undocumented, out-of-band
-- policies with the identical bare `with check (created_by = auth.uid())`
-- shape 021 replaced: "authenticated can create pots" and "users can
-- create own pots". Neither appears in any migration file (grepped
-- supabase/migrations/ for both names, zero matches) — the same
-- out-of-band pattern 012_drop_undocumented_rls_policies.sql already
-- documented and partially cleaned up for pots' DELETE policy, and the
-- same pattern ISSUE-28 (docs/current-state.md) classified these two
-- specific policies under at the time (2026-08-05) as "harmless
-- duplicates" — a correct classification then, since
-- pots_insert_authenticated's own check was identically permissive. It is
-- no longer correct: 021 made pots_insert_authenticated strictly more
-- restrictive, so these two duplicates now actively undermine the new
-- invariant rather than merely duplicating it. Dropping both is the
-- smallest fix — pots_insert_authenticated alone already covers every
-- legitimate insert path (confirmed live: the one real caller,
-- components/pot/potManager.jsx's useCreatePot, only ever sets
-- created_by = auth.uid() plus an active league_id).

drop policy if exists "authenticated can create pots" on public.pots;
drop policy if exists "users can create own pots" on public.pots;
