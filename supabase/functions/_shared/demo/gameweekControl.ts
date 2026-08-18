// Phase 8C — applies one demo_timeline_events row as a real write, exactly
// matching the shape real fixture_events/fixtures data has. No parallel
// scoring system: goal-type events call the same
// resolveEngine(gameType).calculateScore()/settle() every real fixture
// scoring/settlement path uses (see compute-scores/settle-gameweek's own
// index.ts — their orchestration is inline in the Edge Function handler,
// not exported, so this calls the same underlying dispatcher methods
// directly rather than duplicating their surrounding loop/sync_runs logic,
// which isn't meaningfully reusable across an HTTP boundary anyway).

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolveEngine } from '../game-engine/dispatcher.ts'
import '../game-engine/pick5/index.ts'
import '../game-engine/lms/index.ts'
import '../game-engine/predictor/index.ts'

const ALL_GAME_TYPES = ['pick5', 'last_man_standing', 'score_predictor'] as const

const GOAL_EVENT_TYPES = new Set(['goal', 'own_goal', 'penalty_goal'])

export interface DemoTimelineEventRow {
  id: string
  demo_session_id: string
  fixture_id: number
  sequence_order: number
  minute: number
  event_type: string
  team_id: number | null
  player_id: number | null
  assist_player_id: number | null
}

export interface AppliedEvent {
  event: DemoTimelineEventRow
  gameweekBecameFinished: boolean
}

async function applyOneEvent(sb: SupabaseClient, event: DemoTimelineEventRow): Promise<void> {
  if (event.event_type === 'kickoff') {
    const { error } = await sb.from('fixtures').update({ status: 'live', minute: 0 }).eq('id', event.fixture_id)
    if (error) throw new Error(`Failed to apply kickoff: ${error.message}`)
    return
  }

  if (event.event_type === 'full_time') {
    const { error } = await sb.from('fixtures').update({ status: 'finished', minute: event.minute }).eq('id', event.fixture_id)
    if (error) throw new Error(`Failed to apply full time: ${error.message}`)
    return
  }

  // Every remaining planned type maps onto a real fixture_events row.
  // 'own_goal'/'penalty_goal' both persist as event_type='goal' (the real
  // schema's own vocabulary, confirmed via fixture_events' definition) plus
  // the is_own_goal/is_penalty flags — matching exactly what a real synced
  // goal event looks like.
  const isGoal = GOAL_EVENT_TYPES.has(event.event_type)
  const persistedType = isGoal ? 'goal' : event.event_type

  const { error: insertError } = await sb.from('fixture_events').insert({
    fixture_id: event.fixture_id,
    player_id: event.player_id,
    team_id: event.team_id,
    event_type: persistedType,
    minute: event.minute,
    is_own_goal: event.event_type === 'own_goal',
    is_penalty: event.event_type === 'penalty_goal',
    assist_player_id: event.assist_player_id,
  })
  if (insertError) throw new Error(`Failed to write fixture_events for ${event.event_type}: ${insertError.message}`)

  if (isGoal && event.team_id !== null) {
    const { data: fixture, error: fxError } = await sb
      .from('fixtures')
      .select('home_team_id, away_team_id, home_goals, away_goals')
      .eq('id', event.fixture_id)
      .single()
    if (fxError) throw new Error(`Failed to read fixture for goal increment: ${fxError.message}`)

    const isHome = fixture.home_team_id === event.team_id
    const patch = isHome ? { home_goals: fixture.home_goals + 1 } : { away_goals: fixture.away_goals + 1 }
    const { error: goalError } = await sb.from('fixtures').update(patch).eq('id', event.fixture_id)
    if (goalError) throw new Error(`Failed to increment fixture score: ${goalError.message}`)
  }
}

async function refreshLiveScores(sb: SupabaseClient, gameweekId: number): Promise<void> {
  const { error: refreshError } = await sb.rpc('refresh_player_fixture_goals')
  if (refreshError) throw new Error(`Failed to refresh player_fixture_goals: ${refreshError.message}`)
  const ctx = { supabase: sb, now: () => new Date() }
  for (const gameType of ALL_GAME_TYPES) {
    await resolveEngine(gameType).calculateScore(ctx, gameweekId)
  }
}

async function isGameweekFullyFinished(sb: SupabaseClient, gameweekId: number): Promise<boolean> {
  const { data: fixtures, error } = await sb.from('fixtures').select('status').eq('gameweek_id', gameweekId)
  if (error) throw new Error(`Failed to check gameweek completion: ${error.message}`)
  return (fixtures ?? []).length > 0 && fixtures.every((f: { status: string }) => f.status === 'finished')
}

async function settleGameweek(sb: SupabaseClient, gameweekId: number): Promise<void> {
  const ctx = { supabase: sb, now: () => new Date() }
  for (const gameType of ALL_GAME_TYPES) {
    await resolveEngine(gameType).settle(ctx, gameweekId)
  }
  const { error } = await sb.from('gameweeks').update({ status: 'completed' }).eq('id', gameweekId)
  if (error) throw new Error(`Failed to mark demo gameweek completed: ${error.message}`)
}

// Applies exactly one un-fired event, refreshes live scores if it was
// goal-affecting, and settles the gameweek if that was the event that
// brought every fixture to 'finished'. Returns null if there was nothing
// left to fire.
export async function triggerNextEvent(sb: SupabaseClient, demoSessionId: string, gameweekId: number): Promise<AppliedEvent | null> {
  const { data: next, error: nextError } = await sb
    .from('demo_timeline_events')
    .select('*')
    .eq('demo_session_id', demoSessionId)
    .is('fired_at', null)
    .order('sequence_order', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (nextError) throw new Error(`Failed to look up next demo event: ${nextError.message}`)
  if (!next) return null

  const event = next as DemoTimelineEventRow
  await applyOneEvent(sb, event)

  const { error: markError } = await sb
    .from('demo_timeline_events')
    .update({ fired_at: new Date().toISOString() })
    .eq('id', event.id)
  if (markError) throw new Error(`Failed to mark demo event fired: ${markError.message}`)

  if (GOAL_EVENT_TYPES.has(event.event_type)) {
    await refreshLiveScores(sb, gameweekId)
  }

  let gameweekBecameFinished = false
  if (event.event_type === 'full_time') {
    gameweekBecameFinished = await isGameweekFullyFinished(sb, gameweekId)
    if (gameweekBecameFinished) {
      await settleGameweek(sb, gameweekId)
    }
  }

  return { event, gameweekBecameFinished }
}

export async function advanceTimeline(
  sb: SupabaseClient,
  demoSessionId: string,
  gameweekId: number,
  batchSize: number
): Promise<AppliedEvent[]> {
  const applied: AppliedEvent[] = []
  for (let i = 0; i < batchSize; i++) {
    const result = await triggerNextEvent(sb, demoSessionId, gameweekId)
    if (!result) break
    applied.push(result)
  }
  return applied
}

// 'start' fires every un-fired kickoff event in one go (there is one per
// fixture, all planned at minute 0 — see generateTimeline.ts) rather than
// requiring the operator to click through them individually.
//
// Real bug caught live (Phase 8C verification sprint): same root cause as
// generateHistory.ts's settleHistoryGameweeks() fix — Pick5Engine's
// calculateScore()/settle() both only touch game_entries with status =
// 'locked'. The live demo gameweek's deadline is deliberately kept in the
// future for the whole playback (so late picks stay editable, same as a
// real gameweek before kickoff), so no real mechanism ever locks its
// entries — refreshLiveScores()'s per-goal calculateScore() and
// settleGameweek()'s final settle() were both silently no-op'ing for
// Pick 5 every time. 'start' (kickoff) is the correct real-world
// equivalent of "the deadline has now passed" — lock entries here, once,
// same as compute-deadlines would for a real gameweek.
export async function fireAllKickoffs(sb: SupabaseClient, demoSessionId: string, gameweekId: number): Promise<AppliedEvent[]> {
  const lockCtx = { supabase: sb, now: () => new Date() }
  for (const gameType of ALL_GAME_TYPES) {
    await resolveEngine(gameType).lockEntries(lockCtx, gameweekId)
  }

  const { data: kickoffs, error } = await sb
    .from('demo_timeline_events')
    .select('*')
    .eq('demo_session_id', demoSessionId)
    .eq('event_type', 'kickoff')
    .is('fired_at', null)
    .order('sequence_order', { ascending: true })
  if (error) throw new Error(`Failed to look up kickoff events: ${error.message}`)

  const applied: AppliedEvent[] = []
  for (const row of (kickoffs ?? []) as DemoTimelineEventRow[]) {
    await applyOneEvent(sb, row)
    const { error: markError } = await sb
      .from('demo_timeline_events')
      .update({ fired_at: new Date().toISOString() })
      .eq('id', row.id)
    if (markError) throw new Error(`Failed to mark kickoff fired: ${markError.message}`)
    applied.push({ event: row, gameweekBecameFinished: false })
  }
  return applied
}

export async function resetGameweekPlayback(sb: SupabaseClient, demoSessionId: string, gameweekId: number): Promise<void> {
  const { data: fixtures, error: fxError } = await sb.from('fixtures').select('id').eq('gameweek_id', gameweekId)
  if (fxError) throw new Error(`Failed to look up demo fixtures for reset: ${fxError.message}`)
  const fixtureIds = (fixtures ?? []).map((f: { id: number }) => f.id)

  if (fixtureIds.length > 0) {
    const { error: eventsError } = await sb.from('fixture_events').delete().in('fixture_id', fixtureIds)
    if (eventsError) throw new Error(`Failed to clear demo fixture_events for reset: ${eventsError.message}`)

    const { error: fxResetError } = await sb
      .from('fixtures')
      .update({ status: 'scheduled', minute: null, home_goals: 0, away_goals: 0 })
      .in('id', fixtureIds)
    if (fxResetError) throw new Error(`Failed to reset demo fixtures: ${fxResetError.message}`)
  }

  const { error: timelineError } = await sb
    .from('demo_timeline_events')
    .update({ fired_at: null })
    .eq('demo_session_id', demoSessionId)
  if (timelineError) throw new Error(`Failed to reset demo timeline: ${timelineError.message}`)

  const { error: gwError } = await sb.from('gameweeks').update({ status: 'upcoming' }).eq('id', gameweekId)
  if (gwError) throw new Error(`Failed to reset demo gameweek status: ${gwError.message}`)

  const { error: sessionError } = await sb
    .from('demo_sessions')
    .update({ gameweek_status: 'not_started' })
    .eq('id', demoSessionId)
  if (sessionError) throw new Error(`Failed to reset demo session status: ${sessionError.message}`)
}
