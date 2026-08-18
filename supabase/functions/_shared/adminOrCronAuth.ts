// Launch Readiness Sprint 1A — Security & Authorisation (2026-08-10,
// resolves ISSUE-26). compute-deadlines/compute-scores/settle-gameweek/
// sync-fixtures previously had NO application-level auth check at all —
// each built a service-role client unconditionally and trusted Kong's
// default `verify_jwt`, which only demands *some* valid JWT (the public
// anon key, embedded in the frontend bundle, satisfies it) — not a
// specific caller. Any anon-key-bearing caller could invoke settlement,
// scoring, deadline computation, or an external-API-billed fixture sync,
// repeatedly and directly.
//
// Fixed by requiring one of exactly two callers, mirroring admin-actions'
// own already-proven pattern rather than inventing a new one:
//   1. The real cron caller — pg_cron sends
//      `Authorization: Bearer <service_role_key>` (see
//      006_fix_cron_job_headers.sql) — checked by exact string comparison
//      against the function's own service-role secret, the standard way
//      an Edge Function recognizes "this is genuinely the platform itself
//      calling," not a rotating per-user token to verify.
//   2. A signed-in super admin — AdminDashboard.jsx's "Manual jobs"
//      buttons call these same functions using the signed-in user's own
//      session token, not the service-role key (confirmed by reading
//      hooks/useAdmin.js's useTriggerSync).
// Anything else (anon key, a signed-in non-admin user, a plain app_admin,
// no Authorization header at all) is rejected.
//
// Phase 10B, Part 23 — tightened from `role === 'app_admin'` to
// `role === 'super_admin'`, the user's own explicit instruction (Manual
// Jobs triggers platform-wide sync/scoring/settlement, reserved for
// platform ownership — same reasoning already applied to Demo Centre in
// Phase 8D). This also fixes a real, confirmed-live mismatch the old
// check had: it accepted the literal string 'app_admin' only, so a
// super_admin — who is supposed to inherit every app_admin capability —
// was actually being REJECTED by this exact check the whole time,
// despite AdminDashboard.jsx's frontend showing them the buttons. That
// mismatch is now moot: this checks `super_admin` only, matching what
// the frontend gate now also requires.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export async function isAuthorizedAdminOrCron(req: Request): Promise<boolean> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return false

  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (serviceRoleKey && token === serviceRoleKey) return true

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data, error } = await userClient.auth.getUser()
  if (error || !data.user) return false

  return data.user.app_metadata?.role === 'super_admin'
}
