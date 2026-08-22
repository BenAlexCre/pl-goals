-- Remediation (red-team audit Priority 3, authorized) — user_entries and
-- user_entry_picks are the FIRST-generation retired prototype (001_initial_
-- schema.sql, postgres-owned — a different, unrelated case from ISSUE-20/
-- ISSUE-21's supabase_admin-owned second prototype for LMS/Predictor, which
-- remains untouched by this migration). docs/current-state.md's 2026-08-05
-- entry (ISSUE-33/-42) already documents no frontend code has created a
-- user_entries row since the Pick 5 Game Engine cutover — confirmed again
-- this session by a repo-wide grep (only frontend/src/lib/gameAPI.js and
-- frontend/src/components/entryBuilder.jsx reference these tables, and
-- neither is imported anywhere in frontend/src).
--
-- Despite that, RLS still let any authenticated pot member INSERT into
-- user_entries directly via PostgREST — and trg_create_entry_payment
-- (001_initial_schema.sql) fires AFTER INSERT ON user_entries, meaning that
-- write would also silently spawn a real row in entry_payments, a table
-- the CURRENT payment-verification system actively reads (frontend/src/
-- hooks/useAdmin.js's usePaymentStatus/useMarkPayment). This was a live,
-- reachable data-integrity path, not just dead-table clutter — currently
-- dormant only because both tables have 0 rows (verified live).
--
-- compute-scores/index.ts and settle-gameweek/index.ts no longer read or
-- write either table (removed in this same remediation) or leaderboard_
-- snapshots, so nothing legitimate needs write access via any route.
--
-- SELECT policies (user_entries_select_member, picks_select_member) are
-- deliberately left in place — read-only, harmless, and preserve visibility
-- for any historical rows if the tables are read directly during a future
-- investigation. Per explicit instruction: tables themselves, their
-- indexes/triggers/functions, and leaderboard_snapshots (schema/RLS) are
-- NOT touched by this migration — only the obsolete INSERT/UPDATE/DELETE
-- write policies on user_entries/user_entry_picks.

drop policy if exists "user_entries_insert_own" on public.user_entries;
drop policy if exists "user_entries_update_own_pending" on public.user_entries;

drop policy if exists "picks_insert_own" on public.user_entry_picks;
drop policy if exists "picks_update_own" on public.user_entry_picks;
drop policy if exists "picks_delete_own" on public.user_entry_picks;

comment on table public.user_entries is
  'Remediation (red-team audit Priority 3) — retired prototype table (Milestone 4 Pick 5 cutover, 2026-08-05, superseded by game_entries/pick5_picks). No frontend code writes here anymore; compute-scores/settle-gameweek no longer read or write it either. INSERT/UPDATE write policies revoked this migration; SELECT policy kept. 0 rows as of this migration. Not dropped yet — see migration 041 header for full reasoning.';

comment on table public.user_entry_picks is
  'Remediation (red-team audit Priority 3) — retired prototype table, same status as user_entries (see that table''s comment). INSERT/UPDATE/DELETE write policies revoked this migration; SELECT policy kept. 0 rows as of this migration. Not dropped yet.';
