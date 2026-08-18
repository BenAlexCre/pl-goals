import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

// Phase 8D, Part 7/8/9 — Super Admin platform administration. Same auth
// pattern as admin-actions/index.ts: a user-scoped client resolves the
// caller's identity, a service-role client does the actual work, with
// authorization checked explicitly in code. Deliberately requires
// app_metadata.role === 'super_admin' strictly — never app_admin — for
// every action in this file: user search/inspection, banning, and role
// management are platform-governance actions, one level above the
// operational admin duties app_admin already has (Manual jobs, Payment
// verification, Rollover management), per the hierarchy the user described
// this session.
//
// grant_app_admin/revoke_app_admin are the ONLY way this file ever writes
// app_metadata.role, and they only ever write 'app_admin' or clear it —
// 'super_admin' is never an accepted value for either action's target role,
// closing the self-escalation path structurally (Part 6/18): even a
// compromised super_admin session cannot mint a second super_admin through
// this API. The only way to create a super_admin is the separate, manual,
// service-role-only provisioning script documented in DEPLOYMENT.md (Part 10).

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

interface AuthUserLike {
  id: string
  email?: string
  email_confirmed_at?: string | null
  banned_until?: string | null
  app_metadata?: Record<string, unknown>
  created_at?: string
}

async function writeAuditLog(
  adminClient: SupabaseClient,
  actorId: string,
  action: string,
  targetUserId: string | null,
  metadata: Record<string, unknown> | null
) {
  const { error } = await adminClient.from('admin_audit_log').insert({
    actor_id: actorId,
    action,
    target_user_id: targetUserId,
    metadata,
  })
  if (error) throw new Error(`Failed to write audit log: ${error.message}`)
}

// GoTrue's admin listUsers() has no server-side search — at this project's
// real scale (a handful of local accounts, confirmed via the live database
// before writing this, not assumed) a single bounded scan is simpler and
// more correct than a two-step profiles-then-getUserById join, and correctly
// searches email too, not just display_name/username. Revisit with real
// pagination only if this project's user count ever approaches this cap.
const LIST_USERS_PAGE_SIZE = 200

async function fetchAllAuthUsers(adminClient: SupabaseClient): Promise<AuthUserLike[]> {
  const { data, error } = await adminClient.auth.admin.listUsers({ page: 1, perPage: LIST_USERS_PAGE_SIZE })
  if (error) throw new Error(`Failed to list users: ${error.message}`)
  return (data.users ?? []) as AuthUserLike[]
}

function roleOf(user: AuthUserLike): string {
  const role = user.app_metadata?.role
  return typeof role === 'string' ? role : 'user'
}

function isBannedNow(user: AuthUserLike): boolean {
  return !!user.banned_until && new Date(user.banned_until).getTime() > Date.now()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonResponse({ error: 'Missing auth header' }, 401)

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  )

  const { data: userData, error: authError } = await userClient.auth.getUser()
  if (authError || !userData.user) return jsonResponse({ error: 'Unauthorized' }, 401)
  if (userData.user.app_metadata?.role !== 'super_admin') {
    return jsonResponse({ error: 'Forbidden — super_admin only' }, 403)
  }
  const callerId = userData.user.id

  const body = await req.json().catch(() => ({}))
  const { action } = body

  try {
    switch (action) {
      case 'list_users': {
        const search = typeof body.search === 'string' ? body.search.trim().toLowerCase() : ''
        const authUsers = await fetchAllAuthUsers(adminClient)

        const { data: profiles, error: profilesError } = await adminClient
          .from('profiles')
          .select('id, username, display_name, is_demo, created_at')
        if (profilesError) throw new Error(`Failed to load profiles: ${profilesError.message}`)
        const profileById = new Map((profiles ?? []).map((p: { id: string }) => [p.id, p]))

        const { data: memberships, error: membershipsError } = await adminClient
          .from('pot_members')
          .select('user_id, role')
        if (membershipsError) throw new Error(`Failed to load memberships: ${membershipsError.message}`)
        const potCounts = new Map<string, { member: number; admin: number }>()
        for (const m of (memberships ?? []) as { user_id: string; role: string }[]) {
          const entry = potCounts.get(m.user_id) ?? { member: 0, admin: 0 }
          if (m.role === 'admin') entry.admin++
          entry.member++
          potCounts.set(m.user_id, entry)
        }

        const rows = authUsers
          .map((u) => {
            const profile = profileById.get(u.id) as
              | { username: string; display_name: string; is_demo: boolean; created_at: string }
              | undefined
            const counts = potCounts.get(u.id) ?? { member: 0, admin: 0 }
            return {
              id: u.id,
              email: u.email ?? '',
              display_name: profile?.display_name ?? null,
              username: profile?.username ?? null,
              is_demo: profile?.is_demo ?? false,
              email_verified: !!u.email_confirmed_at,
              banned: isBannedNow(u),
              role: roleOf(u),
              pot_count: counts.member,
              pot_admin_count: counts.admin,
              created_at: u.created_at ?? profile?.created_at ?? null,
            }
          })
          .filter((row) => {
            if (!search) return true
            return (
              row.email.toLowerCase().includes(search) ||
              (row.display_name ?? '').toLowerCase().includes(search) ||
              (row.username ?? '').toLowerCase().includes(search)
            )
          })
          .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))

        return jsonResponse({ users: rows })
      }

      case 'inspect_user': {
        const targetUserId = body.target_user_id
        if (typeof targetUserId !== 'string') return jsonResponse({ error: 'target_user_id is required' }, 400)

        const { data: authUser, error: authUserError } = await adminClient.auth.admin.getUserById(targetUserId)
        if (authUserError || !authUser.user) return jsonResponse({ error: 'User not found' }, 404)

        const { data: profile, error: profileError } = await adminClient
          .from('profiles')
          .select('id, username, display_name, is_demo, created_at')
          .eq('id', targetUserId)
          .maybeSingle()
        if (profileError) throw new Error(`Failed to load profile: ${profileError.message}`)

        const { data: memberships, error: membershipsError } = await adminClient
          .from('pot_members')
          .select('role, pots(id, name, game_type, status)')
          .eq('user_id', targetUserId)
        if (membershipsError) throw new Error(`Failed to load pot memberships: ${membershipsError.message}`)

        const u = authUser.user as unknown as AuthUserLike
        return jsonResponse({
          id: u.id,
          email: u.email ?? '',
          email_verified: !!u.email_confirmed_at,
          banned: isBannedNow(u),
          banned_until: u.banned_until ?? null,
          role: roleOf(u),
          created_at: u.created_at ?? null,
          profile: profile ?? null,
          pots: memberships ?? [],
        })
      }

      case 'ban_user': {
        const targetUserId = body.target_user_id
        const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null
        if (typeof targetUserId !== 'string') return jsonResponse({ error: 'target_user_id is required' }, 400)
        if (targetUserId === callerId) return jsonResponse({ error: 'You cannot ban your own account' }, 400)

        const { data: targetUser, error: targetError } = await adminClient.auth.admin.getUserById(targetUserId)
        if (targetError || !targetUser.user) return jsonResponse({ error: 'User not found' }, 404)
        if (roleOf(targetUser.user as unknown as AuthUserLike) === 'super_admin') {
          return jsonResponse({ error: 'Cannot ban a Super Admin account' }, 403)
        }

        // GoTrue requires a duration string, not a boolean/timestamp; ~100
        // years is this project's way of expressing "indefinite" within
        // that API shape. It does not revoke any already-issued, unexpired
        // session token — GoTrue has no such mechanism — it only refuses
        // future sign-ins/refreshes. Real-time enforcement against a
        // currently-valid token is is_banned() (migration 027), checked by
        // every competition-mutating RLS policy/Edge Function; this is the
        // deliberate, documented "blocked on next protected request" answer
        // to Part 8's own question, not a gap.
        const { error: banError } = await adminClient.auth.admin.updateUserById(targetUserId, {
          ban_duration: '876000h',
        })
        if (banError) throw new Error(`Failed to ban user: ${banError.message}`)

        await writeAuditLog(adminClient, callerId, 'user_banned', targetUserId, { reason })
        return jsonResponse({ success: true })
      }

      case 'unban_user': {
        const targetUserId = body.target_user_id
        if (typeof targetUserId !== 'string') return jsonResponse({ error: 'target_user_id is required' }, 400)

        const { error: unbanError } = await adminClient.auth.admin.updateUserById(targetUserId, {
          ban_duration: 'none',
        })
        if (unbanError) throw new Error(`Failed to unban user: ${unbanError.message}`)

        await writeAuditLog(adminClient, callerId, 'user_unbanned', targetUserId, null)
        return jsonResponse({ success: true })
      }

      case 'grant_app_admin':
      case 'revoke_app_admin': {
        const targetUserId = body.target_user_id
        if (typeof targetUserId !== 'string') return jsonResponse({ error: 'target_user_id is required' }, 400)
        if (targetUserId === callerId) return jsonResponse({ error: 'You cannot change your own role' }, 400)

        const { data: targetUser, error: targetError } = await adminClient.auth.admin.getUserById(targetUserId)
        if (targetError || !targetUser.user) return jsonResponse({ error: 'User not found' }, 404)

        const currentMetadata = { ...(targetUser.user.app_metadata ?? {}) } as Record<string, unknown>
        if (currentMetadata.role === 'super_admin') {
          return jsonResponse({ error: "Cannot change a Super Admin's role through this action" }, 403)
        }

        // Reconstructs the full desired app_metadata object rather than
        // trusting updateUserById's merge behavior for a `null`/removed
        // key — correct regardless of whether the SDK merges or replaces.
        if (action === 'grant_app_admin') {
          currentMetadata.role = 'app_admin'
        } else {
          delete currentMetadata.role
        }

        const { error: updateError } = await adminClient.auth.admin.updateUserById(targetUserId, {
          app_metadata: currentMetadata,
        })
        if (updateError) throw new Error(`Failed to update role: ${updateError.message}`)

        await writeAuditLog(
          adminClient,
          callerId,
          action === 'grant_app_admin' ? 'app_admin_granted' : 'app_admin_removed',
          targetUserId,
          null
        )
        return jsonResponse({ success: true })
      }

      case 'overview_stats': {
        const authUsers = await fetchAllAuthUsers(adminClient)
        const totalUsers = authUsers.length
        const bannedUsers = authUsers.filter(isBannedNow).length
        const appAdmins = authUsers.filter((u) => roleOf(u) === 'app_admin').length
        const superAdmins = authUsers.filter((u) => roleOf(u) === 'super_admin').length

        const { count: activePots, error: potsError } = await adminClient
          .from('pots')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'active')
        if (potsError) throw new Error(`Failed to count active pots: ${potsError.message}`)

        const { data: demoSession, error: demoError } = await adminClient
          .from('demo_sessions')
          .select('status, gameweek_status')
          .in('status', ['draft', 'active'])
          .maybeSingle()
        if (demoError) throw new Error(`Failed to check demo status: ${demoError.message}`)

        return jsonResponse({
          total_users: totalUsers,
          active_users: totalUsers - bannedUsers,
          banned_users: bannedUsers,
          app_admins: appAdmins,
          super_admins: superAdmins,
          active_pots: activePots ?? 0,
          demo_status: demoSession ? demoSession.status : 'none',
        })
      }

      case 'list_audit_log': {
        const limit = Number.isInteger(body.limit) ? Math.min(body.limit, 100) : 50
        const { data: entries, error: entriesError } = await adminClient
          .from('admin_audit_log')
          .select('id, actor_id, action, target_user_id, metadata, created_at')
          .order('created_at', { ascending: false })
          .limit(limit)
        if (entriesError) throw new Error(`Failed to load audit log: ${entriesError.message}`)

        const ids = [...new Set((entries ?? []).flatMap((e: { actor_id: string | null; target_user_id: string | null }) => [e.actor_id, e.target_user_id].filter(Boolean)))] as string[]
        let profileById = new Map<string, { display_name: string; username: string }>()
        if (ids.length > 0) {
          const { data: profiles, error: profilesError } = await adminClient
            .from('profiles')
            .select('id, display_name, username')
            .in('id', ids)
          if (profilesError) throw new Error(`Failed to load audit log profiles: ${profilesError.message}`)
          profileById = new Map((profiles ?? []).map((p: { id: string; display_name: string; username: string }) => [p.id, p]))
        }

        const rows = (entries ?? []).map((e: { id: number; actor_id: string | null; action: string; target_user_id: string | null; metadata: unknown; created_at: string }) => ({
          ...e,
          actor: e.actor_id ? profileById.get(e.actor_id) ?? null : null,
          target: e.target_user_id ? profileById.get(e.target_user_id) ?? null : null,
        }))

        return jsonResponse({ entries: rows })
      }

      default:
        return jsonResponse({ error: `Unknown action: ${action}` }, 400)
    }
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500)
  }
})
