import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { teardownDemoData } from '../_shared/demo/teardown.ts'

// Phase 8C, Slice 1 — used by both "Reset Demo" (Part 7: full teardown,
// Demo Centre then offers Generate again) and "Delete Demo Data". Same
// app_admin-only auth pattern as demo-generate-data. Body: { demoSessionId }
// — looked up first so the ordered delete in teardownDemoData() works from
// the session's own recorded league_id/season_id/config.demoUserIds, the
// same shape a partial-failure cleanup during generation uses.

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
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
  // Phase 8D, Part 11 — tightened from app_admin to super_admin only, see
  // demo-generate-data/index.ts's own comment for the reasoning.
  if (userData.user.app_metadata?.role !== 'super_admin') {
    return jsonResponse({ error: 'Forbidden — super_admin only' }, 403)
  }

  const body = await req.json().catch(() => ({}))
  const demoSessionId = body.demoSessionId
  if (typeof demoSessionId !== 'string') {
    return jsonResponse({ error: 'demoSessionId is required' }, 400)
  }

  const { data: session, error: sessionError } = await adminClient
    .from('demo_sessions')
    .select('id, league_id, season_id, config')
    .eq('id', demoSessionId)
    .maybeSingle()
  if (sessionError) return jsonResponse({ error: sessionError.message }, 500)
  if (!session) return jsonResponse({ error: 'Demo session not found' }, 404)

  try {
    const config = (session.config ?? {}) as { demoUserIds?: string[] }
    await teardownDemoData(adminClient, {
      demoSessionId: session.id,
      leagueId: session.league_id ?? undefined,
      seasonId: session.season_id ?? undefined,
      userIds: config.demoUserIds ?? [],
    })
    return jsonResponse({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return jsonResponse({ error: message }, 500)
  }
})
