const BASE_URL = 'https://api.football-data.org/v4'
const API_KEY = process.env.FOOTBALL_DATA_KEY || process.env.VITE_FOOTBALL_DATA_KEY || ''
const COMPETITION_CODE = process.env.FOOTBALL_COMPETITION_CODE || 'WC'
const SEASON = Number(process.env.FOOTBALL_SEASON || '2026')

if (!API_KEY) {
  console.error('Missing FOOTBALL_DATA_KEY or VITE_FOOTBALL_DATA_KEY')
  process.exit(1)
}

async function apiFetch(path, params = {}) {
  const url = new URL(BASE_URL + path)

  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  })

  const res = await fetch(url, {
    headers: {
      'X-Auth-Token': API_KEY,
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`football-data ${path} -> ${res.status} ${text}`)
  }

  return res.json()
}

async function getFixtures(competitionCode, season) {
  const data = await apiFetch(`/competitions/${competitionCode}/matches`, { season })
  return data.matches ?? []
}

async function getTeams(competitionCode, season) {
  const data = await apiFetch(`/competitions/${competitionCode}/teams`, { season })
  return data.teams ?? []
}

function normalizeTeam(team, competitionCode, season) {
  return {
    provider: 'football-data',
    provider_team_id: team.id,
    competition_code: competitionCode,
    season,
    name: team.name,
    short_name: team.shortName ?? null,
    tla: team.tla ?? null,
    crest_url: team.crest ?? null,
    venue: team.venue ?? null,
    area_name: team.area?.name ?? null,
    website: team.website ?? null,
    founded: team.founded ?? null,
    club_colors: team.clubColors ?? null,
    last_updated: team.lastUpdated ?? null,
  }
}

function normalizeFixture(match, competitionCode, season) {
  return {
    provider: 'football-data',
    provider_fixture_id: match.id,
    competition_code: competitionCode,
    season,
    utc_date: match.utcDate,
    status: match.status,
    stage: match.stage ?? null,
    matchday: match.matchday ?? null,
    home_team_id: match.homeTeam?.id ?? null,
    home_team_name: match.homeTeam?.name ?? null,
    away_team_id: match.awayTeam?.id ?? null,
    away_team_name: match.awayTeam?.name ?? null,
    home_score: match.score?.fullTime?.home ?? null,
    away_score: match.score?.fullTime?.away ?? null,
    winner: match.score?.winner ?? null,
    venue: match.venue ?? null,
    group_name: match.group ?? null,
    last_updated: match.lastUpdated ?? null,
  }
}

async function syncFootballData() {
  const [teams, fixtures] = await Promise.all([
    getTeams(COMPETITION_CODE, SEASON),
    getFixtures(COMPETITION_CODE, SEASON),
  ])

  const normalizedTeams = teams.map((t) => normalizeTeam(t, COMPETITION_CODE, SEASON))
  const normalizedFixtures = fixtures.map((m) => normalizeFixture(m, COMPETITION_CODE, SEASON))

  const payload = {
    competition_code: COMPETITION_CODE,
    season: SEASON,
    fetched_at: new Date().toISOString(),
    teams_count: normalizedTeams.length,
    fixtures_count: normalizedFixtures.length,
    teams: normalizedTeams,
    fixtures: normalizedFixtures,
  }

  console.log(JSON.stringify(payload, null, 2))
}

syncFootballData().catch((err) => {
  console.error(err)
  process.exit(1)
})