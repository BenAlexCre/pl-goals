import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { generateDemoLeague, type DemoLeagueData, type DemoFixture } from '../_shared/demo/generateLeague.ts'
import { generateDemoUsers, deleteDemoUsers } from '../_shared/demo/generateUsers.ts'
import {
  generateDemoPots, writeHistoryFixtureEvents, writeUserBatch, settleHistoryGameweeks, type DemoPots,
} from '../_shared/demo/generateHistory.ts'
import { generateDemoTimeline } from '../_shared/demo/generateTimeline.ts'
import { teardownDemoData } from '../_shared/demo/teardown.ts'

// Phase 8C, Slice 1 — Demo Centre. Same auth pattern as admin-actions/
// index.ts: a user-scoped client resolves the caller's identity, a
// service-role client does the actual writes, with app_admin checked
// explicitly in code.
//
// Split into steps, driven by the frontend's useGenerateDemoData hook
// (see that file's own comment): the local Edge Runtime enforces a hard
// ~2s CPU-time budget per invocation, confirmed live — a single call
// covering league+users+picks+settlement for even 10 users reliably
// tripped "early termination has been triggered" in the container logs.
// Very likely a real platform constraint (Supabase Edge Functions have a
// documented CPU-time limit), not a local-only quirk, so generation is
// chunked into multiple separate invocations rather than shrunk to fit
// one — each step is a full request/response round trip, with progress
// tracked via a 'draft' demo_sessions row between steps.
//
//   'league' — season/league/teams/players/gameweeks/fixtures/3 pots/
//              history fixture_events/live-gameweek timeline. Fixed cost,
//              independent of user count. Creates the demo_sessions row.
//   'users'  — one batch of synthetic users (body.offset/body.batchSize):
//              creates them, adds pot membership, records payments, writes
//              picks. Call repeatedly (increasing offset) until the
//              response's `done` is true.
//   'settle' — settles both history gameweeks once every batch is done.
//              Marks the session 'active'.

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Small — auth.admin.createUser()'s bcrypt hashing is genuinely CPU-heavy,
// and each batch also writes membership+payments+picks for every user in
// it. 8 reliably tripped the Edge Runtime's hard per-invocation CPU-time
// budget in testing; 4 is a safety margin, not a tuned-to-the-edge value.
const DEFAULT_BATCH_SIZE = 4

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
  // Phase 8D, Part 11 — tightened from app_admin to super_admin only, a
  // deliberate decision confirmed with the user this session (Demo Centre
  // generates/destroys real-shaped data at will; that belongs with platform
  // ownership, not general operational admin duties).
  if (userData.user.app_metadata?.role !== 'super_admin') {
    return jsonResponse({ error: 'Forbidden — super_admin only' }, 403)
  }

  const body = await req.json().catch(() => ({}))
  const step = body.step ?? 'league'

  try {
    if (step === 'league') {
      const userCount = Number(body.userCount)
      if (![10, 25, 50].includes(userCount)) {
        return jsonResponse({ error: 'userCount must be 10, 25, or 50' }, 400)
      }

      const { data: existing, error: existingError } = await adminClient
        .from('demo_sessions')
        .select('id')
        .in('status', ['draft', 'active'])
        .maybeSingle()
      if (existingError) return jsonResponse({ error: existingError.message }, 500)
      if (existing) {
        return jsonResponse(
          { error: 'A demo session already exists. Delete or reset it before generating a new one.' },
          409
        )
      }

      const seed = Math.floor(Date.now() % 1_000_000)
      let league: DemoLeagueData | undefined
      try {
        league = await generateDemoLeague(adminClient, seed)
        await writeHistoryFixtureEvents(adminClient, league, seed)
        const pots = await generateDemoPots(adminClient, league, userData.user.id)

        const liveGw = league.gameweeks.find((g) => g.role === 'live')
        if (!liveGw) throw new Error('No live gameweek was generated')

        const { data: session, error: sessionError } = await adminClient
          .from('demo_sessions')
          .insert({
            status: 'draft',
            gameweek_status: 'not_started',
            league_id: league.leagueId,
            season_id: league.seasonId,
            gameweek_id: liveGw.id,
            created_by: userData.user.id,
            config: {
              userCount,
              seed,
              batchSize: DEFAULT_BATCH_SIZE,
              pick5PotId: pots.pick5PotId,
              lmsPotId: pots.lmsPotId,
              predictorPotId: pots.predictorPotId,
              demoUserIds: [],
            },
          })
          .select()
          .single()
        if (sessionError) throw new Error(`Failed to create demo session: ${sessionError.message}`)

        await generateDemoTimeline(adminClient, session.id, league, liveGw.id, seed)

        return jsonResponse({ success: true, demoSession: session, done: false })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await teardownDemoData(adminClient, { leagueId: league?.leagueId, seasonId: league?.seasonId })
        return jsonResponse({ error: `League generation failed and was rolled back: ${message}` }, 500)
      }
    }

    if (step === 'users') {
      const demoSessionId = body.demoSessionId
      if (typeof demoSessionId !== 'string') return jsonResponse({ error: 'demoSessionId is required' }, 400)

      const { data: session, error: sessionError } = await adminClient
        .from('demo_sessions')
        .select('*')
        .eq('id', demoSessionId)
        .maybeSingle()
      if (sessionError) return jsonResponse({ error: sessionError.message }, 500)
      if (!session) return jsonResponse({ error: 'Demo session not found' }, 404)

      const config = session.config as {
        userCount: number
        seed: number
        batchSize: number
        pick5PotId: string
        lmsPotId: string
        predictorPotId: string
        demoUserIds: string[]
      }
      const offset = config.demoUserIds.length
      if (offset >= config.userCount) {
        return jsonResponse({ success: true, done: true, createdCount: offset })
      }
      const batchSize = Math.min(config.batchSize, config.userCount - offset)

      const league = await reloadLeague(adminClient, session.league_id, session.season_id, session.gameweek_id)
      const pots: DemoPots = { pick5PotId: config.pick5PotId, lmsPotId: config.lmsPotId, predictorPotId: config.predictorPotId }

      const batchUsers = await generateDemoUsers(adminClient, batchSize, config.seed + offset)
      const batchUserIds = batchUsers.map((u) => u.id)
      try {
        await writeUserBatch(adminClient, pots, league, batchUsers, userData.user.id, config.seed + offset)
      } catch (batchError) {
        // This batch's own users were never recorded into
        // config.demoUserIds (that happens below, only on success) — a
        // full "Delete demo data" teardown wouldn't know they exist.
        // Roll them back here, immediately, same "never leave residue"
        // discipline as the 'league' step's own catch. game_entries.user_id
        // is RESTRICT, not CASCADE (verified live) — a partial failure
        // partway through writeUserBatch (e.g. Pick5 picks written, LMS
        // picks not yet) can leave this batch's users owning real
        // game_entries rows; deleting the users first would itself fail
        // with an FK violation, so those must go first.
        const potIds = [pots.pick5PotId, pots.lmsPotId, pots.predictorPotId]
        const { error: cleanupEntriesError } = await adminClient
          .from('game_entries')
          .delete()
          .in('pot_id', potIds)
          .in('user_id', batchUserIds)
        if (cleanupEntriesError) {
          throw new Error(
            `Batch failed (${batchError instanceof Error ? batchError.message : String(batchError)}); ` +
            `cleanup also failed (${cleanupEntriesError.message}) — manual cleanup required for users: ${batchUserIds.join(', ')}`
          )
        }
        await deleteDemoUsers(adminClient, batchUserIds)
        throw batchError
      }

      const newDemoUserIds = [...config.demoUserIds, ...batchUsers.map((u) => u.id)]
      const { error: updateError } = await adminClient
        .from('demo_sessions')
        .update({ config: { ...config, demoUserIds: newDemoUserIds } })
        .eq('id', session.id)
      if (updateError) throw new Error(`Failed to record demo user batch: ${updateError.message}`)

      const done = newDemoUserIds.length >= config.userCount
      return jsonResponse({ success: true, done, createdCount: newDemoUserIds.length, total: config.userCount })
    }

    if (step === 'settle') {
      const demoSessionId = body.demoSessionId
      if (typeof demoSessionId !== 'string') return jsonResponse({ error: 'demoSessionId is required' }, 400)

      const { data: session, error: sessionError } = await adminClient
        .from('demo_sessions')
        .select('id, league_id, season_id, gameweek_id')
        .eq('id', demoSessionId)
        .maybeSingle()
      if (sessionError) return jsonResponse({ error: sessionError.message }, 500)
      if (!session) return jsonResponse({ error: 'Demo session not found' }, 404)

      const league = await reloadLeague(adminClient, session.league_id, session.season_id, session.gameweek_id)
      await settleHistoryGameweeks(adminClient, league)

      const { data: updated, error: updateError } = await adminClient
        .from('demo_sessions')
        .update({ status: 'active' })
        .eq('id', session.id)
        .select()
        .single()
      if (updateError) throw new Error(`Failed to activate demo session: ${updateError.message}`)

      return jsonResponse({ success: true, done: true, demoSession: updated })
    }

    return jsonResponse({ error: `Unknown step: ${step}` }, 400)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return jsonResponse({ error: message }, 500)
  }
})

// Re-derives the DemoLeagueData shape a fresh Edge Function invocation
// needs (teams/players/gameweeks/fixtures) from the DB, given only the
// league_id/season_id captured on the demo_sessions row — each step is its
// own isolated invocation with no shared in-memory state from the
// 'league' step.
async function reloadLeague(
  sb: SupabaseClient,
  leagueId: number,
  seasonId: number,
  liveGameweekId: number
): Promise<DemoLeagueData> {
  const { data: teamsData, error: teamsError } = await sb
    .from('teams')
    .select('id, name, short_name')
    .eq('league_id', leagueId)
  if (teamsError) throw new Error(`Failed to reload demo teams: ${teamsError.message}`)

  const { data: playersData, error: playersError } = await sb
    .from('player_team_history')
    .select('player_id, team_id, players(id, position, display_name)')
    .eq('season_id', seasonId)
  if (playersError) throw new Error(`Failed to reload demo players: ${playersError.message}`)

  const { data: gwData, error: gwError } = await sb
    .from('gameweeks')
    .select('id, number, status')
    .eq('league_id', leagueId)
    .order('number')
  if (gwError) throw new Error(`Failed to reload demo gameweeks: ${gwError.message}`)

  // role is re-derived, not stored — 'history' means already settled at
  // generation time (status='completed'); the live gameweek is whichever
  // one demo_sessions.gameweek_id actually points at (the one live/
  // interactive gameweek for this whole session); anything else is the
  // upcoming/unused fourth gameweek.
  const gameweeks = (gwData ?? []).map((g: { id: number; number: number; status: string }) => ({
    id: g.id,
    number: g.number,
    role: (g.status === 'completed' ? 'history' : g.id === liveGameweekId ? 'live' : 'upcoming') as 'history' | 'live' | 'upcoming',
  }))

  const { data: fxData, error: fxError } = await sb
    .from('fixtures')
    .select('id, gameweek_id, home_team_id, away_team_id, home_goals, away_goals')
    .in('gameweek_id', gameweeks.map((g) => g.id))
  if (fxError) throw new Error(`Failed to reload demo fixtures: ${fxError.message}`)

  const fixturesByGameweek = new Map<number, DemoFixture[]>()
  for (const f of fxData ?? []) {
    const list = fixturesByGameweek.get(f.gameweek_id) ?? []
    list.push({
      id: f.id,
      gameweekId: f.gameweek_id,
      homeTeamId: f.home_team_id,
      awayTeamId: f.away_team_id,
      homeGoals: f.home_goals,
      awayGoals: f.away_goals,
    })
    fixturesByGameweek.set(f.gameweek_id, list)
  }

  return {
    seasonId,
    leagueId,
    teams: (teamsData ?? []).map((t: { id: number; name: string; short_name: string }) => ({ id: t.id, name: t.name, shortName: t.short_name })),
    players: (playersData ?? []).map((p: { player_id: number; team_id: number; players: { position: string; display_name: string } | { position: string; display_name: string }[] }) => {
      const player = Array.isArray(p.players) ? p.players[0] : p.players
      return { id: p.player_id, teamId: p.team_id, position: player.position, displayName: player.display_name }
    }),
    gameweeks,
    fixturesByGameweek,
  }
}
