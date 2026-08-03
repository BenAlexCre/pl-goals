// scripts/fullSyncPlayers.js
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const API_BASE = 'https://api.football-data.org/v4'
const PROVIDER = 'football-data'
const LEAGUE_PROVIDER_ID = process.env.FOOTBALL_COMPETITION_CODE ?? 'PL'
const SEASON_ID = 26
const TEAM_FILTER = [] // leave empty [] to sync all teams
const REQUEST_DELAY_MS = 6500
const MAX_429_RETRIES = 6
const MAX_JSON_RETRIES = 3

const SUPABASE_URL =
  process.env.SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  ''

const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  ''

const FOOTBALL_DATA_KEY =
  process.env.FOOTBALL_DATA_KEY ??
  process.env.VITE_FOOTBALL_DATA_KEY ??
  ''

if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL or VITE_SUPABASE_URL')
if (!SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')
if (!FOOTBALL_DATA_KEY) throw new Error('Missing FOOTBALL_DATA_KEY or VITE_FOOTBALL_DATA_KEY')

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function sbHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    ...extra,
  }
}

async function sb(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: sbHeaders(options.headers || {}),
  })

  const raw = await res.text()

  if (!res.ok) {
    throw new Error(`supabase ${options.method || 'GET'} ${path} → ${res.status} ${raw}`)
  }

  if (res.status === 204 || !raw || !raw.trim()) return null

  try {
    return JSON.parse(raw)
  } catch {
    throw new Error(`supabase ${options.method || 'GET'} ${path} → invalid JSON response`)
  }
}

async function fd(path, attempt = 1) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'X-Auth-Token': FOOTBALL_DATA_KEY,
    },
  })

  const raw = await res.text()

  if (res.status === 429) {
    let waitSeconds = 60

    const retryAfter = res.headers.get('retry-after')
    if (retryAfter && !Number.isNaN(Number(retryAfter))) {
      waitSeconds = Number(retryAfter)
    } else {
      const match = raw.match(/Wait\s+(\d+)\s+seconds/i)
      if (match) waitSeconds = Number(match[1])
    }

    if (attempt > MAX_429_RETRIES) {
      throw new Error(`football-data GET ${path} → 429 ${raw}`)
    }

    await sleep((waitSeconds + 1) * 1000)
    return fd(path, attempt + 1)
  }

  if (!res.ok) {
    throw new Error(`football-data GET ${path} → ${res.status} ${raw}`)
  }

  if (!raw || !raw.trim()) {
    if (attempt >= MAX_JSON_RETRIES) {
      throw new Error(`football-data GET ${path} → empty response body`)
    }

    await sleep(2000)
    return fd(path, attempt + 1)
  }

  try {
    return JSON.parse(raw)
  } catch {
    if (attempt >= MAX_JSON_RETRIES) {
      throw new Error(`football-data GET ${path} → invalid JSON body`)
    }

    await sleep(2000)
    return fd(path, attempt + 1)
  }
}

async function insertSyncRun(jobName) {
  const rows = await sb('/sync_runs', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify([
      {
        job_name: jobName,
        status: 'running',
        started_at: new Date().toISOString(),
        records_processed: 0,
        triggered_by: 'manual',
      },
    ]),
  })

  return rows[0]
}

async function finishSyncRun(id, patch) {
  await sb(`/sync_runs?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      ...patch,
      finished_at: new Date().toISOString(),
    }),
  })
}

async function getSeason() {
  const rows = await sb(
    `/seasons?select=id,name,year_start,year_end,is_current&id=eq.${SEASON_ID}&limit=1`
  )

  if (!rows || !rows.length) {
    throw new Error(`No season found for id=${SEASON_ID}`)
  }

  return rows[0]
}

async function getLeagueForSeason(seasonId) {
  const rows = await sb(
    `/leagues?select=id,name,provider_id,provider_name,season_id` +
    `&season_id=eq.${seasonId}` +
    `&provider_name=eq.${PROVIDER}` +
    `&provider_id=eq.${LEAGUE_PROVIDER_ID}` +
    `&limit=1`
  )

  if (!rows || !rows.length) {
    throw new Error(
      `No league found for provider_id='${LEAGUE_PROVIDER_ID}', provider_name='${PROVIDER}', season_id=${seasonId}`
    )
  }

  return rows[0]
}

async function getTeamsForSeasonLeague(seasonId, leagueId) {
  return sb(
    `/teams?select=id,name,provider_id,provider_name,season_id,league_id` +
    `&season_id=eq.${seasonId}` +
    `&league_id=eq.${leagueId}` +
    `&provider_name=eq.${PROVIDER}` +
    `&order=id.asc`
  )
}

function mapPlayerToRow(player) {
  return {
    name: player.name || 'Unknown',
    display_name: player.name || 'Unknown',
    position: player.position || null,
    nationality: player.nationality || null,
    date_of_birth: player.dateOfBirth || null,
    photo_url: null,
    provider_id: String(player.id),
    provider_name: PROVIDER,
  }
}

async function upsertPlayers(rows) {
  if (!rows.length) return []

  return sb('/players?on_conflict=provider_id,provider_name', {
    method: 'POST',
    headers: {
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(rows),
  })
}

async function getPlayersByProviderIds(providerIds) {
  if (!providerIds.length) return []

  const inList = providerIds.map(id => `"${String(id)}"`).join(',')

  return sb(
    `/players?select=id,provider_id` +
    `&provider_name=eq.${PROVIDER}` +
    `&provider_id=in.(${inList})`
  )
}

async function markExistingTeamHistoryInactive(teamId, seasonId) {
  await sb(
    `/player_team_history?team_id=eq.${teamId}&season_id=eq.${seasonId}&is_active=eq.true`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        is_active: false,
        left_at: new Date().toISOString().slice(0, 10),
      }),
    }
  )
}

async function upsertPlayerTeamHistory(rows) {
  if (!rows.length) return

  await sb('/player_team_history?on_conflict=player_id,team_id,season_id', {
    method: 'POST',
    headers: {
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  })
}

async function syncTeamSquad(team, season) {
  const payload = await fd(`/teams/${team.provider_id}`)
  const squad = Array.isArray(payload?.squad) ? payload.squad : []

  if (!squad.length) {
    return {
      teamId: team.id,
      teamName: team.name,
      playersProcessed: 0,
      squadEmpty: true,
    }
  }

  const playerRows = squad.map(mapPlayerToRow)
  await upsertPlayers(playerRows)

  const fetchedPlayers = await getPlayersByProviderIds(squad.map(p => p.id))
  const playerIdMap = new Map(
    fetchedPlayers.map(p => [String(p.provider_id), p.id])
  )

  await markExistingTeamHistoryInactive(team.id, season.id)

  const historyRows = squad
    .map(player => {
      const playerId = playerIdMap.get(String(player.id))
      if (!playerId) return null

      return {
        player_id: playerId,
        team_id: team.id,
        season_id: season.id,
        shirt_number: player.shirtNumber ?? null,
        is_active: true,
        joined_at: null,
        left_at: null,
      }
    })
    .filter(Boolean)

  await upsertPlayerTeamHistory(historyRows)

  return {
    teamId: team.id,
    teamName: team.name,
    playersProcessed: historyRows.length,
    squadEmpty: false,
  }

  console.log(`Synced ${players.length} players for team ${team.name} (${team.id})`);
}

async function main() {
  const run = await insertSyncRun('fullSyncPlayers')
  let recordsProcessed = 0
  const errors = []

  try {
    const season = await getSeason()
    const league = await getLeagueForSeason(season.id)
    const teams = await getTeamsForSeasonLeague(season.id, league.id)

    if (!teams || !teams.length) {
      throw new Error(
        `No teams found for season_id=${season.id}, league_id=${league.id}, provider_name='${PROVIDER}'`
      )
    }

    const teamsToSync = TEAM_FILTER.length
      ? teams.filter(team => TEAM_FILTER.includes(team.id))
      : teams

    for (const team of teamsToSync) {
      try {
        const result = await syncTeamSquad(team, season)
        recordsProcessed += result.playersProcessed
      } catch (err) {
        errors.push({
          team_id: team.id,
          team_name: team.name,
          provider_id: team.provider_id,
          message: err.message,
        })
      }

      await sleep(REQUEST_DELAY_MS)
    }

    await finishSyncRun(run.id, {
      status: errors.length ? 'partial' : 'success',
      records_processed: recordsProcessed,
      errors: errors.length ? errors : null,
    })
  } catch (err) {
    await finishSyncRun(run.id, {
      status: 'failed',
      records_processed: recordsProcessed,
      errors: [
        {
          message: err.message,
          stack: err.stack || null,
        },
      ],
    })
    throw err
  }
}


console.log(`fullSyncPlayers.js complete: ${totalPlayers} players synced across ${totalTeams} teams`);

main().catch(err => {
  console.error(err)
  process.exit(1)
})