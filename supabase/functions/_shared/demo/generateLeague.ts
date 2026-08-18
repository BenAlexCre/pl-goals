// Phase 8C — creates the isolated "Demo Premier League" football data: one
// season, one league, 8 teams, ~14 players each, 4 gameweeks (2 already
// completed for instant history, 1 live/interactive, 1 upcoming), and the
// fixtures for each gameweek. Every row here carries provider_name='demo'
// (teams/players) or is scoped under the demo league/season (gameweeks/
// fixtures) — nothing here can ever collide with or be mistaken for real
// sync-fixtures data.
//
// Respects Pick5's own PICK5_INELIGIBLE_POSITIONS (Goalkeeper/Coach
// excluded from picking) by using the same position vocabulary
// ('Goalkeeper' | 'Defence' | 'Midfield' | 'Offence') real squads use, so
// demo Pick5 picking behaves identically to a real pot.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { makeRng, randomClubName, randomPersonName } from './names.ts'

const TEAM_COUNT = 8
const SQUAD_SHAPE: { position: string; count: number }[] = [
  { position: 'Goalkeeper', count: 2 },
  { position: 'Defence', count: 5 },
  { position: 'Midfield', count: 4 },
  { position: 'Offence', count: 3 },
]

export interface DemoTeam {
  id: number
  name: string
  shortName: string
}

export interface DemoPlayer {
  id: number
  teamId: number
  position: string
  displayName: string
}

export interface DemoGameweek {
  id: number
  number: number
  role: 'history' | 'live' | 'upcoming'
}

export interface DemoFixture {
  id: number
  gameweekId: number
  homeTeamId: number
  awayTeamId: number
  homeGoals: number
  awayGoals: number
}

export interface DemoLeagueData {
  seasonId: number
  leagueId: number
  teams: DemoTeam[]
  players: DemoPlayer[]
  gameweeks: DemoGameweek[]
  fixturesByGameweek: Map<number, DemoFixture[]>
}

function roundRobinPairs(teamIds: number[]): [number, number][] {
  const pairs: [number, number][] = []
  for (let i = 0; i < teamIds.length; i += 2) {
    pairs.push([teamIds[i], teamIds[i + 1]])
  }
  return pairs
}

export async function generateDemoLeague(
  sb: SupabaseClient,
  seed: number
): Promise<DemoLeagueData> {
  const rng = makeRng(seed)
  const runTag = `demo-${Date.now()}-${Math.floor(rng() * 1e6)}`

  const { data: season, error: seasonError } = await sb
    .from('seasons')
    .insert({
      // seasons has a unique constraint on (year_start, year_end) — a fixed
      // pair collided live in testing with a leftover demo season from an
      // earlier run (see teardown.ts's own note on why a demo season can
      // occasionally survive teardown). Varying by seed keeps every run
      // unique without needing real years, which real seasons already own.
      name: 'Demo Season',
      year_start: 2100 + (seed % 500),
      year_end: 2101 + (seed % 500),
      is_current: false,
    })
    .select('id')
    .single()
  if (seasonError) throw new Error(`Failed to create demo season: ${seasonError.message}`)

  const { data: league, error: leagueError } = await sb
    .from('leagues')
    .insert({
      name: 'Demo Premier League',
      country: 'Demoland',
      provider_id: runTag,
      provider_name: 'demo',
      season_id: season.id,
      is_active: true,
    })
    .select('id')
    .single()
  if (leagueError) throw new Error(`Failed to create demo league: ${leagueError.message}`)

  const usedClubNames = new Set<string>()
  const teamRows = Array.from({ length: TEAM_COUNT }, (_, i) => {
    const { name, shortName } = randomClubName(rng, usedClubNames)
    return {
      name,
      short_name: shortName,
      crest_url: null,
      provider_id: `${runTag}-team-${i}`,
      provider_name: 'demo',
      season_id: season.id,
      league_id: league.id,
    }
  })

  const { data: teamsData, error: teamsError } = await sb
    .from('teams')
    .insert(teamRows)
    .select('id, name, short_name')
  if (teamsError) throw new Error(`Failed to create demo teams: ${teamsError.message}`)
  const teams: DemoTeam[] = teamsData.map((t: { id: number; name: string; short_name: string }) => ({
    id: t.id,
    name: t.name,
    shortName: t.short_name,
  }))

  const playerRows: {
    name: string
    display_name: string
    position: string
    provider_id: string
    provider_name: string
  }[] = []
  const playerMeta: { teamId: number; position: string; shirt: number }[] = []
  let playerCounter = 0

  for (const team of teams) {
    let shirt = 1
    for (const slot of SQUAD_SHAPE) {
      for (let i = 0; i < slot.count; i++) {
        const { first, last } = randomPersonName(rng)
        const displayName = `${first} ${last}`
        playerRows.push({
          name: displayName,
          display_name: displayName,
          position: slot.position,
          provider_id: `${runTag}-player-${playerCounter}`,
          provider_name: 'demo',
        })
        playerMeta.push({ teamId: team.id, position: slot.position, shirt })
        playerCounter++
        shirt++
      }
    }
  }

  const { data: playersData, error: playersError } = await sb
    .from('players')
    .insert(playerRows)
    .select('id, display_name, position')
  if (playersError) throw new Error(`Failed to create demo players: ${playersError.message}`)

  const players: DemoPlayer[] = playersData.map(
    (p: { id: number; display_name: string; position: string }, i: number) => ({
      id: p.id,
      teamId: playerMeta[i].teamId,
      position: p.position,
      displayName: p.display_name,
    })
  )

  const historyRows = playersData.map((p: { id: number }, i: number) => ({
    player_id: p.id,
    team_id: playerMeta[i].teamId,
    season_id: season.id,
    shirt_number: playerMeta[i].shirt,
    is_active: true,
  }))
  const { error: pthError } = await sb.from('player_team_history').insert(historyRows)
  if (pthError) throw new Error(`Failed to create demo squad history: ${pthError.message}`)

  const now = Date.now()
  // kickoffOffsetMs is the TRUE, historically-accurate timing used for
  // fixtures.kickoff_utc and (eventually) gameweeks.deadline_utc — a
  // "history" gameweek's fixtures are already finished, so it should look
  // like it happened in the past once generation is done. But
  // validateEntry() (the exact same check a real submission goes through,
  // deliberately reused here) rejects any pick against a gameweek whose
  // deadline has already passed — so history picks are written in
  // generateHistory.ts while deadline_utc is still temporarily set to the
  // near future (see gwSpecs' own deadlineOffsetMs), then
  // finalizeHistoryGameweekTiming() below patches it back to the true past
  // value once picks exist, before settlement.
  const gwSpecs: { number: number; role: DemoGameweek['role']; status: string; kickoffOffsetMs: number; deadlineOffsetMs: number }[] = [
    { number: 1, role: 'history', status: 'completed', kickoffOffsetMs: -14 * 24 * 60 * 60 * 1000, deadlineOffsetMs: 24 * 60 * 60 * 1000 },
    { number: 2, role: 'history', status: 'completed', kickoffOffsetMs: -7 * 24 * 60 * 60 * 1000, deadlineOffsetMs: 24 * 60 * 60 * 1000 },
    // deadlineOffsetMs here only needs to outlast the rest of generation
    // (writing picks for up to 50 synthetic users) — the live gameweek's
    // own "kickoff has happened" experience is driven entirely by
    // demo-gameweek-control's 'start' action (fixtures.status/minute),
    // independent of this deadline. 24h, not a tighter buffer: observed
    // live in testing that real wall-clock time between capturing `now`
    // and this row actually being written can be much larger than
    // expected under the Edge Runtime's CPU-time throttling (an isolate
    // can be suspended and resumed mid-invocation) — a short buffer is not
    // reliably safe.
    { number: 3, role: 'live', status: 'upcoming', kickoffOffsetMs: 0, deadlineOffsetMs: 24 * 60 * 60 * 1000 },
    { number: 4, role: 'upcoming', status: 'upcoming', kickoffOffsetMs: 7 * 24 * 60 * 60 * 1000, deadlineOffsetMs: 7 * 24 * 60 * 60 * 1000 },
  ]

  const gameweekRows = gwSpecs.map((spec) => ({
    season_id: season.id,
    league_id: league.id,
    number: spec.number,
    name: `Demo Gameweek ${spec.number}`,
    status: spec.status,
    deadline_utc: new Date(now + spec.deadlineOffsetMs).toISOString(),
    earliest_kickoff_utc: new Date(now + spec.kickoffOffsetMs).toISOString(),
    is_current: false,
  }))

  const { data: gwData, error: gwError } = await sb
    .from('gameweeks')
    .insert(gameweekRows)
    .select('id, number')
  if (gwError) throw new Error(`Failed to create demo gameweeks: ${gwError.message}`)

  const gameweeks: DemoGameweek[] = gwData.map((g: { id: number; number: number }) => ({
    id: g.id,
    number: g.number,
    role: gwSpecs.find((s) => s.number === g.number)!.role,
  }))

  const teamIds = teams.map((t) => t.id)
  const fixturesByGameweek = new Map<number, DemoFixture[]>()
  let fixtureCounter = 0

  for (const gw of gameweeks) {
    const spec = gwSpecs.find((s) => s.number === gw.number)!
    // Simple rotating round-robin pairing so the same two teams don't
    // always meet — rotate the array by gw.number before pairing.
    const rotated = [...teamIds.slice(gw.number % teamIds.length), ...teamIds.slice(0, gw.number % teamIds.length)]
    const pairs = roundRobinPairs(rotated)

    const fixtureRows = pairs.map(([homeId, awayId]) => {
      const isHistory = spec.status === 'completed'
      // Realistic-ish final scorelines for already-settled history
      // gameweeks (weighted toward low scores, like real football) — the
      // live gameweek starts 0-0 and is driven entirely by
      // demo-gameweek-control's own timeline events instead.
      const homeGoals = isHistory ? Math.floor(rng() * rng() * 5) : 0
      const awayGoals = isHistory ? Math.floor(rng() * rng() * 5) : 0
      return {
        gameweek_id: gw.id,
        home_team_id: homeId,
        away_team_id: awayId,
        kickoff_utc: new Date(now + spec.kickoffOffsetMs).toISOString(),
        status: isHistory ? 'finished' : 'scheduled',
        home_goals: homeGoals,
        away_goals: awayGoals,
        provider_id: `${runTag}-fixture-${fixtureCounter++}`,
        provider_name: 'demo',
      }
    })

    const { data: fxData, error: fxError } = await sb
      .from('fixtures')
      .insert(fixtureRows)
      .select('id, gameweek_id, home_team_id, away_team_id, home_goals, away_goals')
    if (fxError) throw new Error(`Failed to create demo fixtures for GW${gw.number}: ${fxError.message}`)

    fixturesByGameweek.set(
      gw.id,
      fxData.map(
        (f: {
          id: number
          gameweek_id: number
          home_team_id: number
          away_team_id: number
          home_goals: number
          away_goals: number
        }) => ({
          id: f.id,
          gameweekId: f.gameweek_id,
          homeTeamId: f.home_team_id,
          awayTeamId: f.away_team_id,
          homeGoals: f.home_goals,
          awayGoals: f.away_goals,
        })
      )
    )
  }

  // Real, live-caught bug (Phase 8C verification sprint): the pre-existing
  // refresh_gameweek_deadlines trigger (ISSUE-24, fires on every fixtures
  // insert/update/delete) recomputes deadline_utc = earliest_kickoff_utc -
  // 15min for every gameweek as a side effect of the fixture inserts above —
  // silently overwriting the deliberate near-future deadline history/live
  // gameweeks need so validateEntry() still accepts the picks writeUserBatch
  // is about to write. earliest_kickoff_utc comes out correct already (every
  // fixture in a demo gameweek shares one kickoff_utc, matching what this
  // function intended), so only deadline_utc needs re-patching, once, after
  // every gameweek's fixtures are in. Not a fix to the trigger itself — that
  // is ISSUE-24's own separate, blocked, real-fixture-sync concern.
  for (const gw of gameweeks) {
    const spec = gwSpecs.find((s) => s.number === gw.number)!
    if (spec.role === 'upcoming') continue
    const { error: deadlineError } = await sb
      .from('gameweeks')
      .update({ deadline_utc: new Date(now + spec.deadlineOffsetMs).toISOString() })
      .eq('id', gw.id)
    if (deadlineError) throw new Error(`Failed to re-patch demo gameweek ${gw.number} deadline: ${deadlineError.message}`)
  }

  return {
    seasonId: season.id,
    leagueId: league.id,
    teams,
    players,
    gameweeks,
    fixturesByGameweek,
  }
}

// See generateDemoLeague's own comment on gwSpecs.deadlineOffsetMs: history
// gameweeks are created with a near-future deadline so validateEntry()
// accepts the picks generateHistory.ts writes against them, then this patches
// deadline_utc back to the true historical instant (each gameweek's own
// earliest fixture kickoff) once those picks exist — otherwise a "completed"
// history gameweek would still show an open, pickable deadline in the real
// pot UI, which would look broken for a demo meant to look genuinely played
// out. Called after picks are written, before settlement.
export async function finalizeHistoryGameweekTiming(sb: SupabaseClient, league: DemoLeagueData): Promise<void> {
  for (const gw of league.gameweeks) {
    if (gw.role !== 'history') continue
    const fixtures = league.fixturesByGameweek.get(gw.id) ?? []
    if (fixtures.length === 0) continue

    const { data: firstFixture, error } = await sb
      .from('fixtures')
      .select('kickoff_utc')
      .eq('id', fixtures[0].id)
      .single()
    if (error) throw new Error(`Failed to read demo fixture kickoff for GW${gw.number}: ${error.message}`)

    const { error: updateError } = await sb
      .from('gameweeks')
      .update({ deadline_utc: firstFixture.kickoff_utc, earliest_kickoff_utc: firstFixture.kickoff_utc })
      .eq('id', gw.id)
    if (updateError) throw new Error(`Failed to finalize demo gameweek timing for GW${gw.number}: ${updateError.message}`)
  }
}
