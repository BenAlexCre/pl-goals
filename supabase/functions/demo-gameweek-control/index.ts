import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import {
  triggerNextEvent,
  advanceTimeline,
  fireAllKickoffs,
  resetGameweekPlayback,
} from '../_shared/demo/gameweekControl.ts'

// Phase 8C, Slice 1 — Demo Gameweek controls (Start/Pause/Resume/Stop/
// Reset/Advance timeline/Trigger next event). Same app_admin-only auth
// pattern as demo-generate-data/demo-teardown. Body: { action,
// demoSessionId, batchSize? }.

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const VALID_ACTIONS = ['start', 'pause', 'resume', 'stop', 'trigger_next_event', 'advance_timeline', 'reset_gameweek']

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
  if (userData.user.app_metadata?.role !== 'app_admin') {
    return jsonResponse({ error: 'Forbidden — app_admin only' }, 403)
  }

  const body = await req.json().catch(() => ({}))
  const { action, demoSessionId, batchSize } = body

  if (!VALID_ACTIONS.includes(action)) {
    return jsonResponse({ error: `Unknown action. Must be one of: ${VALID_ACTIONS.join(', ')}` }, 400)
  }
  if (typeof demoSessionId !== 'string') {
    return jsonResponse({ error: 'demoSessionId is required' }, 400)
  }

  const { data: session, error: sessionError } = await adminClient
    .from('demo_sessions')
    .select('id, gameweek_id, gameweek_status')
    .eq('id', demoSessionId)
    .maybeSingle()
  if (sessionError) return jsonResponse({ error: sessionError.message }, 500)
  if (!session) return jsonResponse({ error: 'Demo session not found' }, 404)
  if (!session.gameweek_id) return jsonResponse({ error: 'Demo session has no live gameweek' }, 400)

  try {
    switch (action) {
      case 'start': {
        const applied = await fireAllKickoffs(adminClient, session.id, session.gameweek_id)
        await adminClient
          .from('gameweeks')
          .update({ status: 'live' })
          .eq('id', session.gameweek_id)
        await adminClient.from('demo_sessions').update({ gameweek_status: 'running' }).eq('id', session.id)
        return jsonResponse({ success: true, applied })
      }

      case 'pause': {
        await adminClient.from('demo_sessions').update({ gameweek_status: 'paused' }).eq('id', session.id)
        return jsonResponse({ success: true })
      }

      case 'resume': {
        await adminClient.from('demo_sessions').update({ gameweek_status: 'running' }).eq('id', session.id)
        return jsonResponse({ success: true })
      }

      case 'stop': {
        await adminClient.from('demo_sessions').update({ gameweek_status: 'stopped' }).eq('id', session.id)
        return jsonResponse({ success: true })
      }

      case 'trigger_next_event': {
        const result = await triggerNextEvent(adminClient, session.id, session.gameweek_id)
        if (result?.gameweekBecameFinished) {
          await adminClient.from('demo_sessions').update({ gameweek_status: 'completed' }).eq('id', session.id)
        }
        return jsonResponse({ success: true, result })
      }

      case 'advance_timeline': {
        const size = Number.isInteger(batchSize) && batchSize > 0 ? Math.min(batchSize, 20) : 5
        const applied = await advanceTimeline(adminClient, session.id, session.gameweek_id, size)
        if (applied.some((a) => a.gameweekBecameFinished)) {
          await adminClient.from('demo_sessions').update({ gameweek_status: 'completed' }).eq('id', session.id)
        }
        return jsonResponse({ success: true, applied })
      }

      case 'reset_gameweek': {
        await resetGameweekPlayback(adminClient, session.id, session.gameweek_id)
        return jsonResponse({ success: true })
      }

      default:
        return jsonResponse({ error: 'Unknown action' }, 400)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return jsonResponse({ error: message }, 500)
  }
})
