-- Security hardening — pin search_path on SECURITY DEFINER functions.
--
-- Found 2026-11-02 (finalisation audit) via pg_proc: these four functions run
-- with their owner's privileges but inherit the CALLER's search_path
-- (Supabase advisor: function_search_path_mutable). A SECURITY DEFINER
-- function whose name resolution can be influenced by the caller is the
-- textbook privilege-escalation shape; pinning search_path removes it.
--
-- Why '' (empty) is safe here: every object these bodies reference is already
-- schema-qualified (public.pot_members, public.entry_payments,
-- public.profiles, auth.uid()) — verified against pg_proc.prosrc before
-- writing this migration, and verified in a rolled-back transaction that
-- is_pot_member / is_pot_admin (used by RLS policies throughout
-- 002_rls_policies.sql) return identical results afterwards.
--
-- ALTER FUNCTION ... SET only changes the function's configuration; bodies,
-- grants, owners and the triggers/policies that call them are untouched.
--
-- Scope: the four SECURITY DEFINER functions on main. Any future SECURITY
-- DEFINER function should declare `set search_path = ''` at creation.

alter function public.is_pot_member(uuid)  set search_path = '';
alter function public.is_pot_admin(uuid)   set search_path = '';
alter function public.create_entry_payment() set search_path = '';
alter function public.handle_new_user()    set search_path = '';
