-- Phase 8D — Authentication, Identity & Super Admin.
--
-- Roles stay JWT-claim-based (auth.users.raw_app_meta_data ->> 'role',
-- already the existing app_admin mechanism — see is_app_admin() below and
-- _shared/adminOrCronAuth.ts) rather than a new profiles column: role
-- grants only ever happen via a service-role Edge Function calling
-- auth.admin.updateUserById(), the identical trust model app_admin already
-- has, so widening the vocabulary to include 'super_admin' extends the
-- existing mechanism instead of inventing a parallel one.
--
-- Banning reuses Supabase Auth's own native auth.users.banned_until
-- (auth.admin.updateUserById(uid, { ban_duration })) rather than a new
-- profiles.account_status column — GoTrue itself already refuses sign-in/
-- token-refresh for a banned user with zero custom code. The one real gap
-- this migration closes is a *currently valid, not-yet-expired* JWT still
-- being able to act — is_banned()/is_email_verified() below check
-- auth.users directly, live, on every call, so enforcement never depends on
-- a claim baked into a token that predates the ban/verification.
--
-- Both new predicate functions are security definer, owned by postgres
-- (same owner as the already-accepted handle_new_user()/redeem_invite()),
-- because auth.users is not otherwise readable by the authenticated role —
-- the minimum new security-definer surface this requires, not a new
-- pattern.

create or replace function public.is_email_verified()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from auth.users
    where id = auth.uid() and email_confirmed_at is not null
  );
$$;

comment on function public.is_email_verified() is
  'Phase 8D. True iff the calling user (auth.uid()) has a confirmed email, read live from auth.users.email_confirmed_at — never cached in a JWT claim, so this reflects verification the instant it happens, not only after the caller''s next token refresh.';

create or replace function public.is_banned()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from auth.users
    where id = auth.uid() and banned_until is not null and banned_until > now()
  );
$$;

comment on function public.is_banned() is
  'Phase 8D. True iff the calling user is currently banned, read live from auth.users.banned_until (GoTrue''s own native ban mechanism, set via auth.admin.updateUserById). Checked directly rather than via a JWT claim so a ban takes effect on this caller''s very next request, not only once their existing token expires or refreshes.';

-- Widen is_app_admin() (002_rls_policies.sql) to also accept super_admin —
-- not a rename, an extension: the stated role hierarchy has Super Admin
-- inheriting every app_admin capability, so every existing app_admin-gated
-- surface (RLS policies, adminOrCronAuth.ts, useIsAppAdmin()) should also
-- admit a super_admin with zero further changes. Purely additive: today,
-- with no super_admin account provisioned yet, this is a no-op for every
-- existing app_admin.
create or replace function public.is_app_admin()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') in ('app_admin', 'super_admin'), false);
$$;

-- Strict check for the small number of surfaces that must never admit a
-- plain app_admin (role/ban management, Demo Centre per the user's own
-- explicit Part 11 decision this session).
create or replace function public.is_super_admin()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'super_admin', false);
$$;

comment on function public.is_super_admin() is
  'Phase 8D. Strict super_admin-only check, distinct from the widened is_app_admin() (which now also accepts super_admin). Used where app_admin must NOT be sufficient: role/ban management (super-admin-actions Edge Function) and Demo Centre (this session''s own explicit tightening from app_admin).';

-- pots_insert_authenticated (002_rls_policies.sql, tightened by
-- 021_pots_require_active_league.sql) — same drop/recreate discipline
-- those migrations already established, adding the verification/ban gate
-- Part 5 requires for pot creation specifically.
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
  and public.is_email_verified()
  and not public.is_banned()
);

comment on policy "pots_insert_authenticated" on public.pots is
  'GE-2, extended Phase 8D. A pot can only be created by the caller themselves, against a currently active league, by a verified, non-banned account. See 021''s own comment for the league-activity half of this check, unchanged here.';

-- redeem_invite() (004_game_engine_shared_platform.sql) — same function,
-- same signature, two guards added at the top. No client-side change
-- needed; useMembership.js's useRedeemInvite() already just calls this RPC
-- and surfaces whatever error it raises.
create or replace function public.redeem_invite(p_invite_code text)
returns public.pot_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pot_id uuid;
  v_member public.pot_members;
begin
  if not public.is_email_verified() then
    raise exception 'Please verify your email address before joining a pot';
  end if;

  if public.is_banned() then
    raise exception 'This account is suspended and cannot join pots';
  end if;

  select id into v_pot_id
  from public.pots
  where invite_code = p_invite_code;

  if v_pot_id is null then
    raise exception 'Invalid invite code';
  end if;

  if exists (
    select 1 from public.pot_members
    where pot_id = v_pot_id and user_id = auth.uid()
  ) then
    raise exception 'Already a member of this pot';
  end if;

  insert into public.pot_members (pot_id, user_id, role)
  values (v_pot_id, auth.uid(), 'member')
  returning * into v_member;

  return v_member;
end;
$$;

-- Super Admin audit log — genuinely new shape, not a duplicate of anything
-- existing: 020_reinstatement_audit.sql's own precedent ("one fact gets two
-- columns, not a table") applies to a single durable fact per row; this is
-- a heterogeneous event log (ban/unban/role grant/revoke/demo actions),
-- which is a different problem and has no existing table to extend.
create table public.admin_audit_log (
  id bigserial primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  target_user_id uuid references public.profiles(id),
  metadata jsonb,
  created_at timestamptz not null default now()
);

comment on table public.admin_audit_log is
  'Phase 8D. Super Admin action log — user_banned/user_unbanned/app_admin_granted/app_admin_removed/demo_* etc. Written exclusively by super-admin-actions'' service-role client (no INSERT/UPDATE/DELETE grant to authenticated below). actor_id/target_user_id are nullable only to keep a future system-initiated action (no human actor) representable, not to survive account deletion: both FKs are the default NO ACTION, matching this codebase''s existing accountability-column precedent (entry_payments.marked_by, game_entries.reinstated_by, demo_sessions.created_by all block deleting the referenced profile the same way) — confirmed live before writing this comment, not assumed. Deleting a user who has ever appeared in this log requires deleting their audit rows first, same operational reality those columns already have.';

create index idx_admin_audit_log_created_at on public.admin_audit_log (created_at desc);
create index idx_admin_audit_log_target on public.admin_audit_log (target_user_id);

alter table public.admin_audit_log enable row level security;

create policy "admin_audit_log_select_super_admin"
on public.admin_audit_log for select
to authenticated
using (public.is_super_admin());

-- No insert/update/delete policy, and no grant to authenticated on this
-- table at all — same "only a service-role client can write" shape as
-- game_entry_pick5 (get-or-create-pick5-entry's own comment) and
-- demo_sessions' service-role-only Edge Functions.
