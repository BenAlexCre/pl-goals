-- Rigorous UX verification pass — CRITICAL, previously-undiscovered bug:
-- pot creation has never worked in production for any real user (zero
-- rows ever existed in `pots` before this migration). Root-caused via a
-- live reproduction (real signup, real JWT, real REST calls against
-- production) rather than assumed from reading code.
--
-- useCreatePot() (frontend/src/hooks/usePots.js) does two sequential
-- inserts: (1) `pots.insert(row).select().single()` to get the new pot
-- back, then (2) `pot_members.insert({pot_id, user_id: creator, role:
-- 'admin'})`. Both steps were individually reasonable but together formed
-- two separate circular RLS dependencies:
--
-- 1. `pots_select_member`'s SELECT policy (`is_pot_member(id)`) governs
--    the RETURNING clause of step 1's own INSERT (Postgres RLS SELECT
--    policies apply to `INSERT ... RETURNING`, confirmed live: the exact
--    same insert succeeded with `Prefer: return=minimal` and failed with
--    `return=representation`). The creator isn't a pot_member yet at that
--    point — step 2 hasn't run — so the row they just inserted was
--    invisible to their own INSERT...RETURNING.
--
-- 2. Even with (1) fixed, step 2 would have failed identically:
--    `pot_members_insert_admin`'s with_check is `is_pot_admin(pot_id) OR
--    is_app_admin()` — requiring the inserting user to ALREADY be an
--    admin of that pot to insert ANY pot_members row, including the very
--    first one that would make them admin. No path existed for a normal
--    user to ever become a pot's first member.
--
-- Fix, both narrowly scoped to the legitimate "creator bootstraps their
-- own new pot" case, changing nothing about who can join/manage an
-- EXISTING pot:

drop policy if exists "pots_select_member" on public.pots;
create policy "pots_select_member"
on public.pots for select to authenticated
using (is_pot_member(id) OR created_by = auth.uid());

drop policy if exists "pot_members_insert_admin" on public.pot_members;
create policy "pot_members_insert_admin"
on public.pot_members for insert to authenticated
with check (
  is_pot_admin(pot_id)
  OR is_app_admin()
  OR (
    -- Bootstrap case: the pot's own creator adding themselves as its
    -- first (and only, at this point) admin member. Scoped tightly —
    -- only the creator, only role='admin', only for themselves, and only
    -- when the pot genuinely has no members yet — so this can't be
    -- reused to add a second unauthorized admin or join someone else's
    -- pot.
    role = 'admin'
    AND user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.pots p WHERE p.id = pot_members.pot_id AND p.created_by = auth.uid())
    AND NOT EXISTS (SELECT 1 FROM public.pot_members pm2 WHERE pm2.pot_id = pot_members.pot_id)
  )
);

comment on policy "pots_select_member" on public.pots is
  'Live-review fix: added `OR created_by = auth.uid()` so a creator can see (and INSERT...RETURNING) their own pot before pot_members exists for it. Membership-based visibility for everyone else is unchanged.';

comment on policy "pot_members_insert_admin" on public.pot_members is
  'Live-review fix: added a narrowly-scoped bootstrap clause so a pot''s creator can insert their own first admin membership row (previously impossible — is_pot_admin(pot_id) can never be true before this row exists). Existing admin/app-admin add-member paths unchanged.';
