-- RLS for every table created in 004_game_engine_shared_platform.sql.
-- Same pattern established for the Phase 1 security remediation: select
-- gated on pot membership, insert gated on self + membership where a client
-- should ever create the row, and no client-reachable update/delete on any
-- column a Game Engine method derives (GE-11). Reuses the existing
-- is_pot_member/is_pot_admin/is_app_admin helpers — no new auth primitive.
--
-- Revised after docs/schema-review.md #9: row-level policies alone don't stop
-- a user from writing an unintended column in the same statement as a
-- legitimate one, so the two update policies below are paired with a
-- column-level revoke/grant narrowing what "update" is actually allowed to
-- touch.

alter table public.pot_prizes enable row level security;
alter table public.game_entries enable row level security;
alter table public.game_entry_pick5 enable row level security;
alter table public.game_entry_lms enable row level security;
alter table public.game_entry_predictor enable row level security;
alter table public.pot_standings_snapshots enable row level security;
alter table public.notifications enable row level security;

-- GE-4.4 pot_prizes: read-only for pot members. total_amount/is_settled are
-- written only by the settlement Edge Functions (service role, bypasses RLS).
create policy "pot_prizes_select_member"
on public.pot_prizes for select
to authenticated
using (public.is_pot_member(pot_id));

-- GE-4.5 game_entries: pot members can see entries; a member can create their
-- own and edit it while still pending, mirroring user_entries' existing
-- policies (GE-5.1 carries this behavior forward for Pick 5's cutover in
-- Milestone 4). payout_amount/settled_at/status are never client-writable —
-- enforced at the column level, not just by the row-level USING clause,
-- since a "pending" row is still a row a member can otherwise legitimately
-- touch.
create policy "game_entries_select_member"
on public.game_entries for select
to authenticated
using (public.is_pot_member(pot_id));

create policy "game_entries_insert_own"
on public.game_entries for insert
to authenticated
with check (user_id = auth.uid() and public.is_pot_member(pot_id));

create policy "game_entries_update_own_pending"
on public.game_entries for update
to authenticated
using (user_id = auth.uid() and status = 'pending' and public.is_pot_member(pot_id));

revoke update on public.game_entries from authenticated;
grant update (updated_at) on public.game_entries to authenticated;

comment on policy "game_entries_update_own_pending" on public.game_entries is
  'schema-review.md #9: row-level check only. The column-level grant below is what actually limits an authenticated user to no game_entries columns beyond updated_at (which set_updated_at() overwrites anyway) — payout_amount, status, and settled_at can only change via the settlement Edge Functions (service role, bypasses RLS and column grants both).';

-- GE-4.5 thin per-mode extension tables: read-only. Every column on these
-- tables is Game-Engine-derived (picks_won, competitive_status, total_points,
-- etc.) — creation and mutation happen only via a security-definer function
-- or the settlement Edge Functions, never a direct client insert/update.
create policy "game_entry_pick5_select_member"
on public.game_entry_pick5 for select
to authenticated
using (
  exists (
    select 1 from public.game_entries ge
    where ge.id = game_entry_id and public.is_pot_member(ge.pot_id)
  )
);

create policy "game_entry_lms_select_member"
on public.game_entry_lms for select
to authenticated
using (
  exists (
    select 1 from public.game_entries ge
    where ge.id = game_entry_id and public.is_pot_member(ge.pot_id)
  )
);

create policy "game_entry_predictor_select_member"
on public.game_entry_predictor for select
to authenticated
using (
  exists (
    select 1 from public.game_entries ge
    where ge.id = game_entry_id and public.is_pot_member(ge.pot_id)
  )
);

-- GE-4.6 pot_standings_snapshots: read-only for pot members, matches the
-- existing leaderboard_snapshots pattern (no client insert/update/delete).
create policy "pot_standings_snapshots_select_member"
on public.pot_standings_snapshots for select
to authenticated
using (public.is_pot_member(pot_id));

-- GE-4.8 notifications: a user sees and can mark-read only their own inbox.
-- No client insert/delete — rows are written only by notifyUsers(). Column
-- grant restricts "update" to read_at only, per schema-review.md #9 — a user
-- can mark a notification read but cannot rewrite its type/payload/pot_id.
create policy "notifications_select_own"
on public.notifications for select
to authenticated
using (user_id = auth.uid());

create policy "notifications_update_own"
on public.notifications for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;
