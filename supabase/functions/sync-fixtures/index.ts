// supabase/functions/sync-fixtures/index.ts
import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { isAuthorizedAdminOrCron } from '../_shared/adminOrCronAuth.ts'

// Phase 21 — real, evidence-based architecture decision (full comparison
// in decisions.md § Phase 21), not a preference call. This function
// previously called api-football and had never successfully run in this
// environment (no working key) — worse, it depended on
// `seasons.is_current = true` to find "the" season, which on this
// project's own real data points at a season with ZERO real leagues/
// gameweeks (ISSUE-39's own finding), so even a working key would have
// synced real fixtures into the wrong, parallel season rather than
// updating the one every pot/gameweek/fixture actually lives under.
// football-data.org, via the standalone `frontend/scripts/fullSyncInsert.js`
// script, is what has actually populated every real fixture this project
// has ever had — proven against real data, not merely available. This
// function now ports that exact, already-corrected (Phase 19's `'tbd'`/
// 15-minute-offset fixes included) logic into the one Edge Function
// already wired to the existing `sync-fixtures-daily` cron job, rather
// than inventing a second, competing function — same route, same cron
// entry, same auth model, no new cron configuration required. The
// standalone script is unchanged and still works the same way for local/
// manual use; this is the production-scheduled path.
//
// Player/squad data is deliberately NOT handled here — football-data.org's
// free tier rate-limits the squad endpoint hard enough that
// `fullSyncPlayers.js` needs a ~6.5s delay between requests (~2+ minutes
// for 20 teams), a fundamentally different, slower cadence than this
// fast fixtures/teams/gameweeks sync. Combining them risks this
// function's own execution-time budget for no benefit — kept as two
// separate concerns, matching how they already exist as two separate
// scripts. See decisions.md § Phase 21 for the full reasoning and the
// known, separate, not-yet-fixed `fullSyncPlayers.js` issue this
// audit also found (a stale hardcoded `SEASON_ID`).

const API_BASE = 'https://api.football-data.org/v4'

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

async function apiFetch(apiKey: string, path: string, params: Record<string, string | number> = {}) {
  const url = new URL(API_BASE + path)
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  })

  const res = await fetch(url.toString(), {
    headers: { 'X-Auth-Token': apiKey },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`football-data ${path} -> ${res.status} ${text}`)
  }

  return res.json()
}

async function requireSingle<T>(
  promise: PromiseLike<{ data: T | null; error: { message: string } | null }>,
  message: string
) {
  const { data, error } = await promise
  if (error) throw new Error(`${message}: ${error.message}`)
  if (!data) throw new Error(message)
  return data
}

// Phase 19 (ported unchanged from fullSyncInsert.js's own fix) — `TIMED`
// (kickoff time confirmed) vs `SCHEDULED` (date known, exact time not
// yet set by broadcasters — sent with `utcDate` at a literal
// `00:00:00Z` placeholder) is a real distinction football-data.org's API
// makes; collapsing both into `'scheduled'` is what previously produced
// a fabricated `00:00` kickoff for unconfirmed fixtures (ISSUE-62).
function fixtureStatus(s: string | null | undefined) {
  if (s === 'TIMED') return 'scheduled'
  if (s === 'SCHEDULED') return 'tbd'
  if (s === 'IN_PLAY' || s === 'PAUSED') return 'live'
  if (s === 'FINISHED') return 'finished'
  if (s === 'POSTPONED') return 'postponed'
  if (s === 'CANCELLED' || s === 'AWARDED') return 'cancelled'
  return 'tbd'
}

function gameweekStatus(matchStatus: string | null | undefined, kickoff: string) {
  if (matchStatus === 'IN_PLAY' || matchStatus === 'PAUSED') return 'live'
  if (matchStatus === 'FINISHED') return 'completed'
  if (matchStatus === 'POSTPONED') return 'postponed'
  if (new Date(kickoff) > new Date()) return 'upcoming'
  return 'completed'
}

function gwNumber(match: any) {
  if (match.matchday) return match.matchday
  const stageMap: Record<string, number> = {
    GROUP_STAGE: 1, LAST_32: 33, LAST_16: 34, QUARTER_FINALS: 35,
    SEMI_FINALS: 36, THIRD_PLACE: 37, FINAL: 38,
  }
  return stageMap[match.stage] ?? 99
}

function gwName(match: any, number: number) {
  if (match.stage === 'REGULAR_SEASON') return `Gameweek ${number}`
  if (match.stage) return String(match.stage).replaceAll('_', ' ')
  return `Matchday ${number}`
}

// Phase 19 (ported unchanged) — 15 minutes before the earliest kickoff,
// the authoritative business rule (business-rules.md § When picks
// lock). This value is immediately superseded by
// refresh_gameweek_deadlines() (migration 029/030) the moment this
// function's own fixtures upsert commits — that DB trigger is the real,
// always-correct enforcement point — corrected here too so this
// function's own initial write is never even momentarily wrong.
function minusFifteenMinutes(isoString: string) {
  return new Date(new Date(isoString).getTime() - 15 * 60 * 1000).toISOString()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // ISSUE-26 fix — see _shared/adminOrCronAuth.ts. Doubly important here:
  // this function also calls the external football-data.org service, so
  // an unauthenticated caller could previously run up the external API's
  // rate limit in addition to mutating fixture data.
  if (!(await isAuthorizedAdminOrCron(req))) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  // Phase 21 — accepts the existing FOOTBALL_DATA_KEY name (already used
  // by fullSyncInsert.js/fullSyncPlayers.js) as primary, VITE_FOOTBALL_DATA_KEY
  // as a fallback for any already-configured secret under the old,
  // misleading name (a frontend-only prefix on a server-side-only
  // secret) — not a breaking rename, just no longer the name a fresh
  // deployment is told to use.
  const apiKey = Deno.env.get('FOOTBALL_DATA_KEY') ?? Deno.env.get('VITE_FOOTBALL_DATA_KEY') ?? ''
  if (!apiKey) {
    return jsonResponse({ error: 'Missing FOOTBALL_DATA_KEY' }, 500)
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  const body = await parseBody(req)
  const competitionCode = String(
    body?.competitionCode ?? Deno.env.get('FOOTBALL_COMPETITION_CODE') ?? 'PL'
  )
  const seasonYear = Number(
    body?.seasonYear ?? Deno.env.get('FOOTBALL_SEASON') ?? new Date().getFullYear()
  )
  const triggeredBy = String(body?.triggeredBy ?? 'manual')

  const run = await requireSingle<{ id: number }>(
    sb.from('sync_runs')
      .insert({ job_name: 'sync-fixtures', triggered_by: triggeredBy, status: 'running' })
      .select()
      .single(),
    'Failed to create sync run'
  )

  let processed = 0

  try {
    const [competition, teamsRes, matchesRes] = await Promise.all([
      apiFetch(apiKey, `/competitions/${competitionCode}`),
      apiFetch(apiKey, `/competitions/${competitionCode}/teams`, { season: seasonYear }),
      apiFetch(apiKey, `/competitions/${competitionCode}/matches`, { season: seasonYear }),
    ])

    const teams = (teamsRes as any).teams ?? []
    const matches = (matchesRes as any).matches ?? []

    if (!teams.length && !matches.length) {
      throw new Error(`No data returned for competition=${competitionCode}, season=${seasonYear}`)
    }

    // Phase 21 — explicit year lookup, never `is_current` (ISSUE-39: no
    // gameweek/season combination in this project's real data has ever
    // had that flag correctly reflect the season real data lives under).
    // Finds-or-creates, matching fullSyncInsert.js's own proven
    // upsertSeason() exactly, so a fresh hosted project's first sync run
    // can bootstrap its own season row rather than requiring one to
    // pre-exist.
    let season = await sb.from('seasons')
      .select('*')
      .eq('year_start', seasonYear)
      .eq('year_end', seasonYear)
      .maybeSingle()
      .then((r) => r.data)

    if (!season) {
      season = await requireSingle(
        sb.from('seasons')
          .insert({ name: String(seasonYear), year_start: seasonYear, year_end: seasonYear, is_current: false })
          .select()
          .single(),
        'Failed to create season'
      )
    }

    const league = await requireSingle<{ id: number }>(
      sb.from('leagues')
        .upsert({
          name: (competition as any).name,
          country: (competition as any).area?.name ?? null,
          provider_id: competitionCode,
          provider_name: 'football-data',
          season_id: season.id,
          is_active: true,
        }, { onConflict: 'provider_id,provider_name,season_id' })
        .select()
        .single(),
      'Failed to upsert league'
    )

    const teamRows: { id: number; provider_id: string }[] = []
    for (const t of teams) {
      const row = await requireSingle(
        sb.from('teams')
          .upsert({
            name: t.name,
            short_name: t.shortName || t.tla || t.name,
            crest_url: t.crest ?? null,
            provider_id: String(t.id),
            provider_name: 'football-data',
            season_id: season.id,
            league_id: league.id,
          }, { onConflict: 'provider_id,provider_name,season_id' })
          .select('id, provider_id')
          .single(),
        `Upsert team failed: ${t.name}`
      )
      teamRows.push(row)
      processed++
    }
    const teamMap = new Map(teamRows.map((t) => [t.provider_id, t.id]))

    const byNumber = new Map<number, any>()
    for (const m of matches) {
      const number = gwNumber(m)
      const kickoff = m.utcDate
      const status = gameweekStatus(m.status, kickoff)
      const record = byNumber.get(number)
      if (!record) {
        byNumber.set(number, {
          season_id: season.id,
          league_id: league.id,
          number,
          name: gwName(m, number),
          status,
          deadline_utc: minusFifteenMinutes(kickoff),
          earliest_kickoff_utc: kickoff,
          is_current: false,
          provider_id: `${competitionCode}-${number}`,
        })
      } else {
        if (new Date(kickoff) < new Date(record.earliest_kickoff_utc)) {
          record.earliest_kickoff_utc = kickoff
          record.deadline_utc = minusFifteenMinutes(kickoff)
        }
        if (status === 'live') record.status = 'live'
        else if (status === 'upcoming' && record.status !== 'live') record.status = 'upcoming'
      }
    }

    const gameweekRows: { id: number; number: number }[] = []
    for (const gw of byNumber.values()) {
      const row = await requireSingle(
        sb.from('gameweeks')
          .upsert(gw, { onConflict: 'season_id,league_id,number' })
          .select('id, number')
          .single(),
        `Upsert gameweek failed: ${gw.name}`
      )
      gameweekRows.push(row)
      processed++
    }
    const gwMap = new Map(gameweekRows.map((g) => [g.number, g.id]))

    for (const m of matches) {
      const { error } = await sb.from('fixtures').upsert({
        gameweek_id: gwMap.get(gwNumber(m)) ?? null,
        home_team_id: m.homeTeam?.id ? (teamMap.get(String(m.homeTeam.id)) ?? null) : null,
        away_team_id: m.awayTeam?.id ? (teamMap.get(String(m.awayTeam.id)) ?? null) : null,
        kickoff_utc: m.utcDate,
        status: fixtureStatus(m.status),
        minute: m.minute ?? null,
        home_goals: m.score?.fullTime?.home ?? 0,
        away_goals: m.score?.fullTime?.away ?? 0,
        provider_id: String(m.id),
        provider_name: 'football-data',
        provider_raw: m,
        last_synced_at: new Date().toISOString(),
      }, { onConflict: 'provider_id,provider_name' })

      if (error) throw new Error(`Upsert fixture failed: ${m.id}: ${error.message}`)
      processed++
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
      competitionCode,
      competitionName: (competition as any).name,
      season: seasonYear,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await sb.from('sync_runs').update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      records_processed: processed,
      errors: { message },
    }).eq('id', run.id)

    return jsonResponse({ error: message, competitionCode }, 500)
  }
})
