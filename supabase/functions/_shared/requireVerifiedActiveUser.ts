import type { SupabaseClient, User } from 'https://esm.sh/@supabase/supabase-js@2'

// Phase 8D — Part 5's enforcement boundary for "competition actions"
// (submitting picks/predictions; entry creation). Pot creation and pot
// joining are gated directly in Postgres (pots_insert_authenticated's WITH
// CHECK, redeem_invite() — see migration 027) since those are plain RLS
// inserts / a single RPC with no Edge Function in front of them; every
// other competition-mutating action already goes through an Edge Function
// with this exact "forwarded JWT -> user-scoped client resolves caller"
// shape (get-or-create-*-entry, submit-*-picks), so one shared check here
// covers all of them without duplicating the logic six times.
//
// email_confirmed_at is read directly off the already-resolved user object
// (auth.getUser() returns it for free — confirmed live via a direct
// /auth/v1/user call before writing this, not assumed). banned_until is
// NOT included in that response (confirmed the same way — it's privileged,
// admin-only information), so ban status needs one small extra RPC call
// against is_banned() (migration 027), the same security-definer function
// RLS uses — one source of truth, not a second implementation of "is this
// user banned."

export interface VerifiedActiveCheck {
  ok: boolean
  status: number
  error?: string
}

export async function requireVerifiedActiveUser(
  userClient: SupabaseClient,
  user: User
): Promise<VerifiedActiveCheck> {
  if (!user.email_confirmed_at) {
    return { ok: false, status: 403, error: 'Please verify your email address before doing this' }
  }

  const { data: banned, error } = await userClient.rpc('is_banned')
  if (error) {
    return { ok: false, status: 500, error: `Failed to check account status: ${error.message}` }
  }
  if (banned) {
    return { ok: false, status: 403, error: 'This account is suspended' }
  }

  return { ok: true, status: 200 }
}
