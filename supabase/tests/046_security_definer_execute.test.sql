-- ISSUE-84 / migration 046 — SECURITY DEFINER EXECUTE privileges.
-- Run with `supabase test db` (local stack). Wrapped in a transaction and
-- rolled back: leaves no data behind.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(31);

-- 1. Privilege matrix -------------------------------------------------------
-- Write/trigger functions: service_role only.
select ok(not has_function_privilege('anon', 'public.refresh_gameweek_deadlines()', 'execute'),          'anon cannot execute refresh_gameweek_deadlines');
select ok(not has_function_privilege('authenticated', 'public.refresh_gameweek_deadlines()', 'execute'), 'authenticated cannot execute refresh_gameweek_deadlines');
select ok(has_function_privilege('service_role', 'public.refresh_gameweek_deadlines()', 'execute'),      'service_role can execute refresh_gameweek_deadlines');
select ok(not has_function_privilege('anon', 'public.trigger_refresh_gameweek_deadlines()', 'execute'),          'anon cannot execute trigger_refresh_gameweek_deadlines');
select ok(not has_function_privilege('authenticated', 'public.trigger_refresh_gameweek_deadlines()', 'execute'), 'authenticated cannot execute trigger_refresh_gameweek_deadlines');
select ok(has_function_privilege('service_role', 'public.trigger_refresh_gameweek_deadlines()', 'execute'),      'service_role can execute trigger_refresh_gameweek_deadlines');
select ok(not has_function_privilege('anon', 'public.handle_new_user()', 'execute'),          'anon cannot execute handle_new_user');
select ok(not has_function_privilege('authenticated', 'public.handle_new_user()', 'execute'), 'authenticated cannot execute handle_new_user');
select ok(has_function_privilege('service_role', 'public.handle_new_user()', 'execute'),      'service_role can execute handle_new_user');
select ok(not has_function_privilege('anon', 'public.create_entry_payment()', 'execute'),          'anon cannot execute create_entry_payment');
select ok(not has_function_privilege('authenticated', 'public.create_entry_payment()', 'execute'), 'authenticated cannot execute create_entry_payment');
select ok(has_function_privilege('service_role', 'public.create_entry_payment()', 'execute'),      'service_role can execute create_entry_payment');

-- Read-only RLS helpers: authenticated + service_role, not anon.
select ok(not has_function_privilege('anon', 'public.is_pot_member(uuid)', 'execute'),    'anon cannot execute is_pot_member');
select ok(has_function_privilege('authenticated', 'public.is_pot_member(uuid)', 'execute'), 'authenticated can execute is_pot_member');
select ok(has_function_privilege('service_role', 'public.is_pot_member(uuid)', 'execute'),  'service_role can execute is_pot_member');
select ok(not has_function_privilege('anon', 'public.is_pot_admin(uuid)', 'execute'),     'anon cannot execute is_pot_admin');
select ok(has_function_privilege('authenticated', 'public.is_pot_admin(uuid)', 'execute'),  'authenticated can execute is_pot_admin');
select ok(not has_function_privilege('anon', 'public.is_banned()', 'execute'),            'anon cannot execute is_banned');
select ok(has_function_privilege('authenticated', 'public.is_banned()', 'execute'),         'authenticated can execute is_banned');
select ok(not has_function_privilege('anon', 'public.is_email_verified()', 'execute'),    'anon cannot execute is_email_verified');
select ok(has_function_privilege('authenticated', 'public.is_email_verified()', 'execute'), 'authenticated can execute is_email_verified');

-- No policy that uses these helpers may apply to anon/PUBLIC (otherwise anon
-- queries would start failing with permission errors instead of empty results).
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and (coalesce(qual,'') || coalesce(with_check,'')) ~ '(is_pot_member|is_pot_admin|is_banned|is_email_verified)'
      and not (roles = array['authenticated']::name[])),
  0, 'every policy using the helpers is TO authenticated only');

-- 2. Behaviour as each role -------------------------------------------------
-- anon: direct calls are refused (PostgREST /rpc maps 42501 to 401/403).
set local role anon;
select throws_ok('select public.refresh_gameweek_deadlines()', '42501', null, 'anon call to refresh_gameweek_deadlines is refused');
select throws_ok($$select public.is_pot_member('00000000-0000-0000-0000-000000000000')$$, '42501', null, 'anon call to is_pot_member is refused');
-- anon reading an RLS-protected table still gets rows-or-nothing, not an error.
select lives_ok('select count(*) from public.pots', 'anon can still query pots (RLS returns no rows, no permission error)');
reset role;

-- authenticated: helpers work; the write function is refused.
select set_config('request.jwt.claims', json_build_object('sub', (select id::text from auth.users limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$select public.is_pot_member('00000000-0000-0000-0000-000000000000')$$, 'authenticated can call is_pot_member');
select lives_ok('select public.is_banned()', 'authenticated can call is_banned (Edge Function RPC path)');
select lives_ok('select count(*) from public.pots', 'authenticated pots query works through is_pot_member policy');
select throws_ok('select public.refresh_gameweek_deadlines()', '42501', null, 'authenticated call to refresh_gameweek_deadlines is refused');
reset role;

-- Triggers still fire for roles without EXECUTE on the trigger function:
-- a fixtures change by service_role recomputes the gameweek deadline.
set local role service_role;
select lives_ok($$
  update public.fixtures set kickoff_utc = kickoff_utc
  where id = (select id from public.fixtures where gameweek_id is not null and kickoff_utc is not null
              and status not in ('postponed','cancelled','tbd') limit 1)
$$, 'fixtures update fires trigger_refresh_gameweek_deadlines without error');
select lives_ok('select public.refresh_gameweek_deadlines()', 'service_role can still call refresh_gameweek_deadlines');
reset role;

select * from finish();
rollback;
