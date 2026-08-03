// Provider abstraction layer — swap the implementation here without touching any other file
// Current implementation: API-Football (v3.football.api-sports.io)

// Provider abstraction layer — swap the implementation here without touching any other file
// Current implementation: football-data.org v4

const BASE_URL = 'https://api.football-data.org/v4'
const API_KEY = import.meta.env.VITE_FOOTBALL_DATA_KEY ?? ''

async function apiFetch(path, params = {}, extraHeaders = {}) {
  const url = new URL(BASE_URL + path)

  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, v)
    }
  })

  const res = await fetch(url.toString(), {
    headers: {
      'X-Auth-Token': API_KEY,
      ...extraHeaders,
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`football-data ${path} -> ${res.status} ${text}`)
  }

  return res.json()
}

export const footballProvider = {
  name: 'football-data',

  // competitionCode examples: WC, BL1, PD, SA, CL
  getFixtures: async (competitionCode, season) => {
    const data = await apiFetch(`/competitions/${competitionCode}/matches`, { season })
    return data.matches ?? []
  },

  getTeams: async (competitionCode, season) => {
    const data = await apiFetch(`/competitions/${competitionCode}/teams`, { season })
    return data.teams ?? []
  },

  // football-data uses /teams/{id} for squad/base team info
  getSquad: async (teamId) => {
    const data = await apiFetch(`/teams/${teamId}`)
    return data.squad ?? []
  },

  // football-data does not mirror API-Football's events endpoint exactly;
  // the match endpoint is the closest general replacement
  getEvents: async (matchId) => {
    return apiFetch(`/matches/${matchId}`)
  },

  // live fixtures across subscribed competitions
  getLiveFixtures: async () => {
    const data = await apiFetch('/matches', { status: 'LIVE' })
    return data.matches ?? []
  },

  // optional helper for current competition standings if you need it later
  getStandings: async (competitionCode, season) => {
    const data = await apiFetch(`/competitions/${competitionCode}/standings`, { season })
    return data.standings ?? []
  },

  // optional helper if you want scorers later
  getScorers: async (competitionCode, season, limit = 20) => {
    const data = await apiFetch(`/competitions/${competitionCode}/scorers`, { season, limit })
    return data.scorers ?? []
  },
}