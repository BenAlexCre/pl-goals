alter table public.profiles enable row level security;
alter table public.seasons enable row level security;
alter table public.leagues enable row level security;
alter table public.teams enable row level security;
alter table public.players enable row level security;
alter table public.player_team_history enable row level security;
alter table public.gameweeks enable row level security;
alter table public.fixtures enable row level security;
alter table public.fixture_events enable row level security;
alter table public.pots enable row level security;
alter table public.pot_members enable row level security;
alter table public.entry_payments enable row level security;
alter table public.user_entries enable row level security;
alter table public.user_entry_picks enable row level security;
alter table public.leaderboard_snapshots enable row level security;
alter table public.sync_runs enable row level security;

create or replace function public.is_pot_member(p_pot_id uuid)
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1 from public.pot_members
    where pot_id = p_pot_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_pot_admin(p_pot_id uuid)
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1 from public.pot_members
    where pot_id = p_pot_id
      and user_id = auth.uid()
      and role = 'admin'
  );
$$;

create or replace function public.is_app_admin()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'app_admin', false);
$$;

create policy "profiles_select_authenticated"
on public.profiles for select
to authenticated
using (true);

create policy "profiles_insert_own"
on public.profiles for insert
to authenticated
with check (id = auth.uid());

create policy "profiles_update_own"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "reference_data_read_seasons"
on public.seasons for select to authenticated using (true);
create policy "reference_data_read_leagues"
on public.leagues for select to authenticated using (true);
create policy "reference_data_read_teams"
on public.teams for select to authenticated using (true);
create policy "reference_data_read_players"
on public.players for select to authenticated using (true);
create policy "reference_data_read_pth"
on public.player_team_history for select to authenticated using (true);
create policy "reference_data_read_gameweeks"
on public.gameweeks for select to authenticated using (true);
create policy "reference_data_read_fixtures"
on public.fixtures for select to authenticated using (true);
create policy "reference_data_read_fixture_events"
on public.fixture_events for select to authenticated using (true);

create policy "pots_select_member"
on public.pots for select
to authenticated
using (public.is_pot_member(id));

create policy "pots_insert_authenticated"
on public.pots for insert
to authenticated
with check (created_by = auth.uid());

create policy "pots_update_admin"
on public.pots for update
to authenticated
using (public.is_pot_admin(id) or public.is_app_admin());

create policy "pot_members_select_member"
on public.pot_members for select
to authenticated
using (public.is_pot_member(pot_id));

create policy "pot_members_insert_admin"
on public.pot_members for insert
to authenticated
with check (public.is_pot_admin(pot_id) or public.is_app_admin());

create policy "pot_members_update_admin"
on public.pot_members for update
to authenticated
using (public.is_pot_admin(pot_id) or public.is_app_admin());

create policy "pot_members_delete_admin_or_self"
on public.pot_members for delete
to authenticated
using (
  user_id = auth.uid()
  or public.is_pot_admin(pot_id)
  or public.is_app_admin()
);

create policy "entry_payments_select_member"
on public.entry_payments for select
to authenticated
using (public.is_pot_member(pot_id));

create policy "entry_payments_insert_admin"
on public.entry_payments for insert
to authenticated
with check (public.is_pot_admin(pot_id) or public.is_app_admin());

create policy "entry_payments_update_admin"
on public.entry_payments for update
to authenticated
using (public.is_pot_admin(pot_id) or public.is_app_admin());

create policy "user_entries_select_member"
on public.user_entries for select
to authenticated
using (public.is_pot_member(pot_id));

create policy "user_entries_insert_own"
on public.user_entries for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.is_pot_member(pot_id)
);

create policy "user_entries_update_own_pending"
on public.user_entries for update
to authenticated
using (
  user_id = auth.uid()
  and status = 'pending'
  and public.is_pot_member(pot_id)
);

create policy "picks_select_member"
on public.user_entry_picks for select
to authenticated
using (
  exists (
    select 1
    from public.user_entries ue
    where ue.id = entry_id
      and public.is_pot_member(ue.pot_id)
  )
);

create policy "picks_insert_own"
on public.user_entry_picks for insert
to authenticated
with check (
  exists (
    select 1
    from public.user_entries ue
    where ue.id = entry_id
      and ue.user_id = auth.uid()
      and ue.status = 'pending'
      and public.is_pot_member(ue.pot_id)
  )
);

create policy "picks_update_own"
on public.user_entry_picks for update
to authenticated
using (
  exists (
    select 1
    from public.user_entries ue
    where ue.id = entry_id
      and ue.user_id = auth.uid()
      and ue.status = 'pending'
  )
);

create policy "picks_delete_own"
on public.user_entry_picks for delete
to authenticated
using (
  exists (
    select 1
    from public.user_entries ue
    where ue.id = entry_id
      and ue.user_id = auth.uid()
      and ue.status = 'pending'
  )
);

create policy "leaderboard_select_member"
on public.leaderboard_snapshots for select
to authenticated
using (public.is_pot_member(pot_id));

create policy "sync_runs_select_admin"
on public.sync_runs for select
to authenticated
using (public.is_app_admin());