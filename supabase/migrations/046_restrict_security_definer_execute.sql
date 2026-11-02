-- Security hardening — remove unnecessary EXECUTE on SECURITY DEFINER functions
-- (ISSUE-84, 2026-11-02).
--
-- Supabase's security advisor (anon_security_definer_function_executable)
-- reported that the anon role — anyone holding the public anon key, i.e. any
-- visitor — can execute these eight SECURITY DEFINER functions. They run with
-- their owner's privileges, so EXECUTE should be limited to callers that need it.
--
-- Audit (callers verified across migrations, RLS policies, Edge Functions and
-- the frontend; production policy roles verified from a schema dump):
--
--   refresh_gameweek_deadlines()        WRITES every public.gameweeks row.
--     Only caller: trigger_refresh_gameweek_deadlines() (fixtures trigger),
--     which runs as the function owner. No RPC caller anywhere. Anonymous
--     POST /rest/v1/rpc/refresh_gameweek_deadlines could force full-table
--     rewrites, row locks and realtime traffic on demand.
--   trigger_refresh_gameweek_deadlines() trigger function (fixtures)
--   handle_new_user()                    trigger function (auth.users)
--   create_entry_payment()               trigger function (user_entries, legacy)
--     Trigger functions do not need EXECUTE granted to the role whose statement
--     fires the trigger; nobody calls them directly.
--   is_pot_member(uuid), is_pot_admin(uuid)
--     Read-only. Used by 22 RLS policies, all `TO authenticated`.
--   is_banned(), is_email_verified()
--     Read-only. Used by the pots INSERT policy (`TO authenticated`); is_banned()
--     is also called via RPC by Edge Functions with the signed-in user's token
--     (_shared/requireVerifiedActiveUser.ts).
--
-- No policy that references any of these applies to anon or PUBLIC, so anonymous
-- queries never evaluate them: removing anon access cannot turn an empty result
-- into a permission error.
--
-- EXECUTE is granted to PUBLIC by default and anon inherits PUBLIC, so PUBLIC
-- must be revoked as well as anon. service_role keeps EXECUTE on all eight
-- (Edge Functions and operational scripts). Owners keep EXECUTE implicitly.
--
-- REVOKE only removes grants made by the current role. Production's owners are
-- postgres (the role migrations run as); the guard at the end makes this
-- migration fail — rather than silently succeed — if any grant survives.
--
-- Rollback: GRANT EXECUTE ON FUNCTION <each> TO anon, authenticated; (and PUBLIC)
-- — see docs/finalisation-status.md.

-- Write / trigger functions: service_role only.
revoke execute on function public.refresh_gameweek_deadlines()         from public, anon, authenticated;
revoke execute on function public.trigger_refresh_gameweek_deadlines() from public, anon, authenticated;
revoke execute on function public.handle_new_user()                    from public, anon, authenticated;
revoke execute on function public.create_entry_payment()               from public, anon, authenticated;

-- Read-only RLS helpers: signed-in users and service_role.
revoke execute on function public.is_pot_member(uuid)  from public, anon;
revoke execute on function public.is_pot_admin(uuid)   from public, anon;
revoke execute on function public.is_banned()          from public, anon;
revoke execute on function public.is_email_verified()  from public, anon;

grant execute on function public.is_pot_member(uuid)  to authenticated, service_role;
grant execute on function public.is_pot_admin(uuid)   to authenticated, service_role;
grant execute on function public.is_banned()          to authenticated, service_role;
grant execute on function public.is_email_verified()  to authenticated, service_role;
grant execute on function public.refresh_gameweek_deadlines()         to service_role;
grant execute on function public.trigger_refresh_gameweek_deadlines() to service_role;
grant execute on function public.handle_new_user()                    to service_role;
grant execute on function public.create_entry_payment()               to service_role;

-- Guard: the intended end state, or the migration aborts.
do $$
declare
  r record;
  expect_auth boolean;
  n int := 0;
begin
  for r in
    select p.oid, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('refresh_gameweek_deadlines','trigger_refresh_gameweek_deadlines',
                        'handle_new_user','create_entry_payment',
                        'is_pot_member','is_pot_admin','is_banned','is_email_verified')
  loop
    n := n + 1;
    expect_auth := r.proname in ('is_pot_member','is_pot_admin','is_banned','is_email_verified');
    if has_function_privilege('anon', r.oid, 'execute') then
      raise exception '046: anon can still execute %', r.proname;
    end if;
    if has_function_privilege('authenticated', r.oid, 'execute') <> expect_auth then
      raise exception '046: unexpected authenticated EXECUTE on % (expected %)', r.proname, expect_auth;
    end if;
    if not has_function_privilege('service_role', r.oid, 'execute') then
      raise exception '046: service_role lost EXECUTE on %', r.proname;
    end if;
  end loop;
  if n <> 8 then
    raise exception '046: expected 8 functions, found %', n;
  end if;
end
$$;
