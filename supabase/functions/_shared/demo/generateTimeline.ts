// Phase 8C — generates the pre-scripted demo_timeline_events rows for one
// live demo gameweek: every fixture kicks off, gets a handful of plausible
// in-play events, then reaches full time. demo-gameweek-control pops these
// in sequence_order (interleaved across all of that gameweek's fixtures, as
// a real simultaneous kickoff round would look) and turns each into a real
// fixtures/fixture_events write.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { DemoFixture, DemoLeagueData, DemoPlayer } from './generateLeague.ts'
import { makeRng } from './names.ts'

type PlannedEvent = {
  fixtureId: number
  minute: number
  eventType: string
  teamId: number | null
  playerId: number | null
  assistPlayerId: number | null
}

const IN_PLAY_EVENT_WEIGHTS: { type: string; weight: number }[] = [
  { type: 'goal', weight: 5 },
  { type: 'own_goal', weight: 1 },
  { type: 'penalty_goal', weight: 1 },
  { type: 'missed_penalty', weight: 1 },
  { type: 'yellow_card', weight: 5 },
  { type: 'red_card', weight: 1 },
  { type: 'sub_on', weight: 4 },
  { type: 'var_review', weight: 2 },
  { type: 'injury', weight: 2 },
]

function weightedPick(rng: () => number): string {
  const total = IN_PLAY_EVENT_WEIGHTS.reduce((sum, w) => sum + w.weight, 0)
  let roll = rng() * total
  for (const entry of IN_PLAY_EVENT_WEIGHTS) {
    roll -= entry.weight
    if (roll <= 0) return entry.type
  }
  return 'yellow_card'
}

function planFixtureEvents(
  fixture: DemoFixture,
  players: DemoPlayer[],
  rng: () => number
): PlannedEvent[] {
  const homeSquad = players.filter((p) => p.teamId === fixture.homeTeamId && p.position !== 'Goalkeeper')
  const awaySquad = players.filter((p) => p.teamId === fixture.awayTeamId && p.position !== 'Goalkeeper')
  const events: PlannedEvent[] = []

  events.push({ fixtureId: fixture.id, minute: 0, eventType: 'kickoff', teamId: null, playerId: null, assistPlayerId: null })

  const eventCount = 3 + Math.floor(rng() * 4) // 3-6 in-play events
  for (let i = 0; i < eventCount; i++) {
    const minute = 3 + Math.floor(rng() * 86)
    const eventType = weightedPick(rng)
    const isHomeSide = rng() < 0.5
    const squad = isHomeSide ? homeSquad : awaySquad
    const otherSquad = isHomeSide ? awaySquad : homeSquad
    const teamId = isHomeSide ? fixture.homeTeamId : fixture.awayTeamId

    // An own goal is credited to the scoring side's fixture tally but
    // physically "scored" by a player on the conceding side — matches
    // fixture_events.is_own_goal's real meaning (player_id belongs to the
    // team that did NOT gain the goal).
    const scorerSquad = eventType === 'own_goal' ? otherSquad : squad
    const player = scorerSquad.length > 0 ? scorerSquad[Math.floor(rng() * scorerSquad.length)] : null
    const assistPlayer =
      eventType === 'goal' && squad.length > 1 && rng() < 0.6
        ? squad.filter((p) => p.id !== player?.id)[Math.floor(rng() * (squad.length - 1))]
        : null

    events.push({
      fixtureId: fixture.id,
      minute,
      eventType,
      teamId,
      playerId: player?.id ?? null,
      assistPlayerId: assistPlayer?.id ?? null,
    })
  }

  events.push({ fixtureId: fixture.id, minute: 90 + Math.floor(rng() * 5), eventType: 'full_time', teamId: null, playerId: null, assistPlayerId: null })

  return events.sort((a, b) => a.minute - b.minute)
}

export async function generateDemoTimeline(
  sb: SupabaseClient,
  demoSessionId: string,
  league: DemoLeagueData,
  liveGameweekId: number,
  seed: number
): Promise<void> {
  const rng = makeRng(seed + 6)
  const fixtures = league.fixturesByGameweek.get(liveGameweekId) ?? []

  const allEvents = fixtures
    .flatMap((f) => planFixtureEvents(f, league.players, rng))
    // Interleave across fixtures by minute so simultaneous matches feel
    // simultaneous, not one-fixture-at-a-time — ties broken by fixture id
    // for a stable, reproducible order.
    .sort((a, b) => (a.minute - b.minute) || (a.fixtureId - b.fixtureId))

  const rows = allEvents.map((e, index) => ({
    demo_session_id: demoSessionId,
    fixture_id: e.fixtureId,
    sequence_order: index,
    minute: e.minute,
    event_type: e.eventType,
    team_id: e.teamId,
    player_id: e.playerId,
    assist_player_id: e.assistPlayerId,
  }))

  const { error } = await sb.from('demo_timeline_events').insert(rows)
  if (error) throw new Error(`Failed to write demo timeline: ${error.message}`)
}
