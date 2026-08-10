// supabase/functions/sync-fixtures/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { isAuthorizedAdminOrCron } from '../_shared/adminOrCronAuth.ts'

const API_BASE = 'https://v3.football.api-sports.io'
const DEFAULT_COMPETITION_ID = 'WC'

type Json = Record<string, unknown>

function jsonResponse(body: Json, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function parseBody(req: Request) {
  if (req.method !== 'POST') return {}
  try {
    return await req.json()
  } catch {
    return {}
  }
}

async function apiFetch(path: string, params: Record<string, string | number> = {}) {
  const apiKey = Deno.env.get('VITE_FOOTBALL_DATA_KEY') ?? ''

  if (!apiKey) {
    throw new Error('Missing API_FOOTBALL_KEY')
  }

  const url = new URL(API_BASE + path)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)))

  const res = await fetch(url.toString(), {
    headers: {
      'x-rapidapi-key': apiKey,
      'x-rapidapi-host': 'v3.football.api-sports.io',
    },
  })

  const text = await res.text()
  let json: any = null

  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }

  if (!res.ok) {
    const detail =
      json?.message ||
      json?.errors?.token ||
      json?.errors?.requests ||
      text ||
      `status ${res.status}`

    throw new Error(`API error ${path}: ${res.status} - ${detail}`)
  }

  if (json?.errors && Object.keys(json.errors).length) {
    throw new Error(`API error ${path}: ${JSON.stringify(json.errors)}`)
  }

  return json?.response ?? []
}

async function requireSingle<T>(
  promise: Promise<{ data: T | null; error: any }>,
  message: string
) {
  const { data, error } = await promise
  if (error) throw new Error(`${message}: ${error.message}`)
  if (!data) throw new Error(message)
  return data
}

function mapFixtureStatus(short: string | null | undefined) {
  if (!short) return 'scheduled'
  if (['1H', 'HT', '2H', 'ET', 'P', 'LIVE', 'INT'].includes(short)) return 'live'
  if (['FT', 'AET', 'PEN'].includes(short)) return 'finished'
  if (['PST', 'SUSP', 'TBD', 'NS'].includes(short)) return 'scheduled'
  if (short === 'CANC') return 'cancelled'
  return 'scheduled'
}

function parseRoundNumber(roundName: string) {
  const n = parseInt(roundName.replace(/\D+/g, ''), 10)
  return Number.isNaN(n) ? null : n
}

function deriveGameweekName(roundName: string, fallbackNum: number) {
  if (/group/i.test(roundName)) return roundName
  if (/round of|quarter|semi|final/i.test(roundName)) return roundName
  return `Gameweek ${fallbackNum}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // ISSUE-26 fix — see _shared/adminOrCronAuth.ts for the full reasoning.
  // Doubly important here: this function also calls the external
  // api-football service, so an unauthenticated caller could previously
  // run up the external API bill in addition to mutating fixture data.
  if (!(await isAuthorizedAdminOrCron(req))) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  const body = await parseBody(req)

  const competitionId = Number(
    body?.competitionId ??
    Deno.env.get('COMPETITION_ID') ??
    DEFAULT_COMPETITION_ID
  )

  const triggeredBy = String(body?.triggeredBy ?? 'manual')

  const run = await requireSingle(
    sb.from('sync_runs')
      .insert({
        job_name: 'sync-fixtures',
        triggered_by: triggeredBy,
        status: 'running',
      })
      .select()
      .single(),
    'Failed to create sync run'
  )

  let processed = 0

  try {
    if (!competitionId || Number.isNaN(competitionId)) {
      throw new Error('Invalid competitionId. Pass it in request body or COMPETITION_ID env var.')
    }

    const season = await requireSingle(
      sb.from('seasons').select('*').eq('is_current', true).single(),
      'No current season found'
    )

    const leagueApi = await apiFetch('/leagues', {
      id: competitionId,
      season: season.year_start,
    })

    const leagueInfo = leagueApi?.[0]
    if (!leagueInfo) {
      throw new Error(`No league found in API-Football for competitionId=${competitionId}, season=${season.year_start}`)
    }

    const league = await requireSingle(
      sb.from('leagues')
        .upsert({
          name: leagueInfo.league.name,
          country: leagueInfo.country?.name ?? null,
          provider_id: String(competitionId),
          provider_name: 'api-football',
          season_id: season.id,
          is_active: true,
        }, {
          onConflict: 'provider_id,provider_name,season_id',
        })
        .select()
        .single(),
      'Failed to upsert league'
    )

    const teams = await apiFetch('/teams', {
      league: competitionId,
      season: season.year_start,
    })

    for (const t of teams) {
      const { error } = await sb.from('teams').upsert({
        name: t.team.name,
        short_name: t.team.code || t.team.name.slice(0, 3).toUpperCase(),
        crest_url: t.team.logo,
        provider_id: String(t.team.id),
        provider_name: 'api-football',
        season_id: season.id,
        league_id: league.id,
      }, {
        onConflict: 'provider_id,provider_name,season_id',
      })

      if (error) {
        throw new Error(`Upsert team failed: ${t.team.name}: ${error.message}`)
      }

      processed++
    }

    for (const t of teams) {
      const squad = await apiFetch('/players/squads', { team: t.team.id })

      const teamRow = await requireSingle(
        sb.from('teams')
          .select('id')
          .eq('provider_id', String(t.team.id))
          .eq('provider_name', 'api-football')
          .eq('season_id', season.id)
          .single(),
        `Team row not found for ${t.team.name}`
      )

      for (const player of squad?.[0]?.players ?? []) {
        const p = await requireSingle(
          sb.from('players')
            .upsert({
              name: player.name,
              display_name: player.name,
              position: player.position,
              photo_url: player.photo,
              provider_id: String(player.id),
              provider_name: 'api-football',
            }, {
              onConflict: 'provider_id,provider_name',
            })
            .select('id')
            .single(),
          `Failed to upsert player ${player.name}`
        )

        const { error } = await sb.from('player_team_history').upsert({
          player_id: p.id,
          team_id: teamRow.id,
          season_id: season.id,
          shirt_number: player.number,
          is_active: true,
        }, {
          onConflict: 'player_id,team_id,season_id',
        })

        if (error) {
          throw new Error(`Upsert player_team_history failed: ${player.name}: ${error.message}`)
        }

        processed++
      }
    }

    const fixtures = await apiFetch('/fixtures', {
      league: competitionId,
      season: season.year_start,
    })

    const grouped: Record<string, any[]> = {}

    for (const fixture of fixtures) {
      const round = String(fixture.league.round ?? 'Unknown Round')
      grouped[round] ||= []
      grouped[round].push(fixture)
    }

    let fallbackCounter = 1

    for (const [roundName, roundFixtures] of Object.entries(grouped)) {
      const parsedRound = parseRoundNumber(roundName)
      const roundNumber = parsedRound ?? fallbackCounter++
      const earliest = new Date(
        Math.min(...roundFixtures.map((f) => new Date(f.fixture.date).getTime()))
      )
      const deadline = new Date(earliest.getTime() - 30 * 60 * 1000)

      const gw = await requireSingle(
        sb.from('gameweeks')
          .upsert({
            season_id: season.id,
            league_id: league.id,
            number: roundNumber,
            name: deriveGameweekName(roundName, roundNumber),
            status: 'upcoming',
            deadline_utc: deadline.toISOString(),
            earliest_kickoff_utc: earliest.toISOString(),
            provider_id: roundName,
          }, {
            onConflict: 'season_id,league_id,number',
          })
          .select('id')
          .single(),
        `Failed to upsert gameweek/round ${roundName}`
      )

      for (const fixture of roundFixtures) {
        const home = await requireSingle(
          sb.from('teams')
            .select('id')
            .eq('provider_id', String(fixture.teams.home.id))
            .eq('provider_name', 'api-football')
            .eq('season_id', season.id)
            .single(),
          `Home team not found for fixture ${fixture.fixture.id}`
        )

        const away = await requireSingle(
          sb.from('teams')
            .select('id')
            .eq('provider_id', String(fixture.teams.away.id))
            .eq('provider_name', 'api-football')
            .eq('season_id', season.id)
            .single(),
          `Away team not found for fixture ${fixture.fixture.id}`
        )

        const { error } = await sb.from('fixtures').upsert({
          gameweek_id: gw.id,
          home_team_id: home.id,
          away_team_id: away.id,
          kickoff_utc: fixture.fixture.date,
          status: mapFixtureStatus(fixture.fixture.status?.short),
          minute: fixture.fixture.status?.elapsed,
          home_goals: fixture.goals.home ?? 0,
          away_goals: fixture.goals.away ?? 0,
          provider_id: String(fixture.fixture.id),
          provider_name: 'api-football',
          provider_raw: fixture,
          last_synced_at: new Date().toISOString(),
        }, {
          onConflict: 'provider_id,provider_name',
        })

        if (error) {
          throw new Error(`Upsert fixture failed: ${fixture.fixture.id}: ${error.message}`)
        }

        processed++
      }
    }

    await sb.from('sync_runs').update({
      status: 'success',
      finished_at: new Date().toISOString(),
      records_processed: processed,
      errors: null,
    }).eq('id', run.id)

    return jsonResponse({
      success: true,
      processed,
      competitionId,
      competitionName: leagueInfo.league.name,
      season: season.year_start,
    })
  } catch (error) {
    await sb.from('sync_runs').update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      errors: { message: error.message },
    }).eq('id', run.id)

    return jsonResponse({
      error: error.message,
      competitionId,
    }, 500)
  }
})