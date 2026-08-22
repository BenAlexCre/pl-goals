-- Remediation (C2, red-team audit) — demo_sessions/demo_timeline_events
-- RLS used is_app_admin() on every policy, but demo-generate-data/index.ts
-- (and its sibling demo-teardown/demo-gameweek-control functions) were
-- deliberately tightened to super_admin-only — see that file's own
-- "Phase 8D, Part 11 — tightened from app_admin to super_admin only"
-- comment. RLS was never updated to match, meaning a plain app_admin
-- (not super_admin) could read/write these tables directly via PostgREST,
-- bypassing the Edge Function's own stricter check entirely — RLS, not
-- the Edge Function, is the real boundary for any direct client call.
-- This aligns RLS to the same, already-documented, unambiguous intent.

drop policy if exists "demo_sessions_select_admin" on public.demo_sessions;
drop policy if exists "demo_sessions_insert_admin" on public.demo_sessions;
drop policy if exists "demo_sessions_update_admin" on public.demo_sessions;
drop policy if exists "demo_sessions_delete_admin" on public.demo_sessions;

create policy "demo_sessions_select_super_admin" on public.demo_sessions for select to authenticated using (is_super_admin());
create policy "demo_sessions_insert_super_admin" on public.demo_sessions for insert to authenticated with check (is_super_admin());
create policy "demo_sessions_update_super_admin" on public.demo_sessions for update to authenticated using (is_super_admin());
create policy "demo_sessions_delete_super_admin" on public.demo_sessions for delete to authenticated using (is_super_admin());

drop policy if exists "demo_timeline_events_select_admin" on public.demo_timeline_events;
drop policy if exists "demo_timeline_events_insert_admin" on public.demo_timeline_events;
drop policy if exists "demo_timeline_events_update_admin" on public.demo_timeline_events;
drop policy if exists "demo_timeline_events_delete_admin" on public.demo_timeline_events;

create policy "demo_timeline_events_select_super_admin" on public.demo_timeline_events for select to authenticated using (is_super_admin());
create policy "demo_timeline_events_insert_super_admin" on public.demo_timeline_events for insert to authenticated with check (is_super_admin());
create policy "demo_timeline_events_update_super_admin" on public.demo_timeline_events for update to authenticated using (is_super_admin());
create policy "demo_timeline_events_delete_super_admin" on public.demo_timeline_events for delete to authenticated using (is_super_admin());
