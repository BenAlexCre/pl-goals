import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Phase 8a — Match Centre Core. Three data hooks feeding the new
// FixtureCard/MatchCentreDrawer/PlayerDrawer components — see
// docs/decisions.md § Match Centre data layer for why each is shaped the
// way it is (league_team_standings/player_season_stats are new SQL views,
// migration 025; team form is a plain client-side query, no view needed).

// League table — one row per team, already ranked (view computes
// `position` via a window function). Cheap: ~20 rows for a normal league.
export function useLeagueStandings(leagueId, seasonId) {
  return useQuery({
    queryKey: ['league-standings', leagueId, seasonId],
    enabled: !!leagueId && !!seasonId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('league_team_standings')
        .select('*')
        .eq('league_id', leagueId)
        .eq('season_id', seasonId)
      if (error) throw error
      return data ?? []
    },
  })
}

// Phase 25 — Standings page. `league_team_standings` only carries
// `team_id` (a deliberate, minimal view — see its own migration comment);
// this resolves those ids to real team names/crests for display, exactly
// the same plain-query-not-a-view reasoning already used for
// useTeamForm/useTeamHomeAwayRecord above (one league's ~20 teams is
// cheap, no aggregation needed).
export function useLeagueTeams(leagueId, seasonId) {
  return useQuery({
    queryKey: ['league-teams', leagueId, seasonId],
    enabled: !!leagueId && !!seasonId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teams')
        .select('id, name, short_name, crest_url')
        .eq('league_id', leagueId)
        .eq('season_id', seasonId)
      if (error) throw error
      return data ?? []
    },
  })
}

// Fixture difficulty — a plain, defensible heuristic over real league
// position (top 6 / bottom 6), never an invented external rating. Pass
// the OPPONENT's standings row (or null if the league has no completed
// fixtures yet, e.g. before a season starts) — returns null rather than a
// guess when there's nothing to derive it from.
export function fixtureDifficultyFromStanding(standing) {
  if (!standing || !standing.teams_in_table) return null
  if (standing.position <= 6) return 'difficult'
  if (standing.position > standing.teams_in_table - 6) return 'easy'
  return 'balanced'
}

// Team form — last 5 finished fixtures for one team, newest first. Not a
// view: a single team's last-5 lookup is cheap and simple enough that a
// SQL object would be overkill (see plan). W/D/L is derived here, not
// stored — the same 'finished' status/home_goals/away_goals fields
// FixtureCard/MatchCentreDrawer already read elsewhere.
export function useTeamForm(teamId, leagueId, seasonId, limit = 5) {
  return useQuery({
    queryKey: ['team-form', teamId, leagueId, seasonId, limit],
    enabled: !!teamId && !!leagueId && !!seasonId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fixtures')
        .select('id, home_team_id, away_team_id, home_goals, away_goals, kickoff_utc, gameweeks!inner(league_id, season_id)')
        .eq('gameweeks.league_id', leagueId)
        .eq('gameweeks.season_id', seasonId)
        .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
        .eq('status', 'finished')
        .order('kickoff_utc', { ascending: false })
        .limit(limit)
      if (error) throw error

      const rows = data ?? []
      let goalsFor = 0
      let goalsAgainst = 0
      let cleanSheets = 0

      const results = rows.map((f) => {
        const isHome = f.home_team_id === Number(teamId)
        const gf = isHome ? f.home_goals : f.away_goals
        const ga = isHome ? f.away_goals : f.home_goals
        goalsFor += gf
        goalsAgainst += ga
        if (ga === 0) cleanSheets += 1
        if (gf > ga) return 'W'
        if (gf < ga) return 'L'
        return 'D'
      })

      // Oldest-first for display (matches "WWDWL" reading left-to-right
      // as chronological, the convention used by FPL/Sofascore-style form
      // strings) — the query itself is newest-first so `.limit()` grabs
      // the most RECENT 5, then this reverses just the display order.
      return {
        results: results.slice().reverse(),
        goalsFor,
        goalsAgainst,
        cleanSheets,
        played: rows.length,
      }
    },
  })
}

// Home/away record split — MatchCentreDrawer's "Home record"/"Away
// record" fields. All finished fixtures this season on one side only
// (typically ~19 rows for a full-season team), reduced client-side —
// cheap, and a genuinely different aggregate to "recent form" (which
// mixes home+away, most-recent-5 only), so not derived from useTeamForm.
export function useTeamHomeAwayRecord(teamId, leagueId, seasonId) {
  return useQuery({
    queryKey: ['team-home-away-record', teamId, leagueId, seasonId],
    enabled: !!teamId && !!leagueId && !!seasonId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fixtures')
        .select('home_team_id, away_team_id, home_goals, away_goals, gameweeks!inner(league_id, season_id)')
        .eq('gameweeks.league_id', leagueId)
        .eq('gameweeks.season_id', seasonId)
        .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
        .eq('status', 'finished')
      if (error) throw error

      const record = (rows) => {
        let won = 0, drawn = 0, lost = 0
        for (const { gf, ga } of rows) {
          if (gf > ga) won += 1
          else if (gf < ga) lost += 1
          else drawn += 1
        }
        return { played: rows.length, won, drawn, lost }
      }

      const home = []
      const away = []
      for (const f of data ?? []) {
        if (f.home_team_id === Number(teamId)) home.push({ gf: f.home_goals, ga: f.away_goals })
        else away.push({ gf: f.away_goals, ga: f.home_goals })
      }

      return { home: record(home), away: record(away) }
    },
  })
}

// Player identity + current club — resolves independently of whatever
// screen opened the drawer (PlayerDrawer can be triggered from a live
// event, a fixture card, a picker — anywhere), via the same
// player_team_history.is_active pattern already used by
// available_players_by_gameweek. Also the source of the player's current
// season_id (needed by usePlayerSeasonStats) and shirt_number.
export function usePlayerProfile(playerId) {
  return useQuery({
    queryKey: ['player-profile', playerId],
    enabled: !!playerId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: player, error: playerError } = await supabase
        .from('players')
        .select('id, display_name, position, photo_url')
        .eq('id', playerId)
        .single()
      if (playerError) throw playerError

      const { data: teamHistory, error: teamError } = await supabase
        .from('player_team_history')
        .select(`
          shirt_number, season_id,
          team:teams(id, name, short_name, crest_url, league_id, season_id)
        `)
        .eq('player_id', playerId)
        .eq('is_active', true)
        .maybeSingle()
      if (teamError) throw teamError

      return {
        ...player,
        shirtNumber: teamHistory?.shirt_number ?? null,
        team: teamHistory?.team ?? null,
        seasonId: teamHistory?.season_id ?? null,
      }
    },
  })
}

// Next fixtures for a player's club — reuses the same fixtures shape the
// rest of Match Centre already reads, just filtered to upcoming/scheduled
// and this one team.
export function useTeamNextFixtures(teamId, limit = 3) {
  return useQuery({
    queryKey: ['team-next-fixtures', teamId, limit],
    enabled: !!teamId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fixtures')
        .select(`
          id, kickoff_utc, status,
          home_team:teams!home_team_id(id, name, short_name, crest_url),
          away_team:teams!away_team_id(id, name, short_name, crest_url)
        `)
        .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
        .in('status', ['scheduled', 'tbd'])
        .order('kickoff_utc', { ascending: true })
        .limit(limit)
      if (error) throw error
      return data ?? []
    },
  })
}

// Player season stats — goals/assists/cards from the reliable
// player_season_stats view, plus a best-effort minutes/starts/appearances
// aggregate from fixture_player_status (a table with a known,
// pre-existing data gap — docs/current-state.md ISSUE-2 — not present in
// the migration history and empty in this environment today). Each of
// minutes/starts/appearances is independently null when unavailable
// rather than 0, so the UI can distinguish "genuinely zero" from
// "we don't have this data" and hide the field gracefully.
export function usePlayerSeasonStats(playerId, seasonId) {
  return useQuery({
    queryKey: ['player-season-stats', playerId, seasonId],
    enabled: !!playerId && !!seasonId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: statsRow, error: statsError } = await supabase
        .from('player_season_stats')
        .select('goals, assists, yellow_cards, red_cards')
        .eq('player_id', playerId)
        .eq('season_id', seasonId)
        .maybeSingle()
      if (statsError) throw statsError

      // Best-effort — fixture_player_status may have zero rows for this
      // player (or the whole environment). A failed/empty read here must
      // never block the reliable goals/assists/cards data above.
      let appearances = null
      let starts = null
      let minutesPlayed = null

      const { data: statusRows, error: statusError } = await supabase
        .from('fixture_player_status')
        .select('status, started, came_on_minute, went_off_minute, fixtures(minute, status)')
        .eq('player_id', playerId)

      if (!statusError && statusRows && statusRows.length > 0) {
        const appeared = statusRows.filter((r) => r.status !== 'bench' && r.status !== 'not_in_squad')
        appearances = appeared.length
        starts = statusRows.filter((r) => r.started).length
        minutesPlayed = appeared.reduce((total, r) => {
          const fixtureFinalMinute = r.fixtures?.status === 'finished' ? 90 : (r.fixtures?.minute ?? 90)
          if (r.status === 'sub_on') {
            const off = r.went_off_minute ?? fixtureFinalMinute
            return total + Math.max(0, off - (r.came_on_minute ?? 0))
          }
          if (r.status === 'sub_off') {
            return total + (r.went_off_minute ?? 0)
          }
          // 'starting', played the whole match unless later subbed off
          // (which would show up as its own 'sub_off' row per the
          // priority logic useFixturePlayerStatuses already uses).
          return total + fixtureFinalMinute
        }, 0)
      }

      return {
        goals: statsRow?.goals ?? 0,
        assists: statsRow?.assists ?? 0,
        yellowCards: statsRow?.yellow_cards ?? 0,
        redCards: statsRow?.red_cards ?? 0,
        appearances,
        starts,
        minutesPlayed,
      }
    },
  })
}

// Last 5 individual appearances (fixture-level, not season totals) — used
// by PlayerDrawer's "Last five appearances" list. Best-effort, same
// fixture_player_status caveat as usePlayerSeasonStats above.
export function usePlayerRecentAppearances(playerId, limit = 5) {
  return useQuery({
    queryKey: ['player-recent-appearances', playerId, limit],
    enabled: !!playerId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fixture_player_status')
        .select(`
          status, started, came_on_minute, went_off_minute,
          fixtures(
            id, kickoff_utc, home_goals, away_goals, status,
            home_team:teams!home_team_id(id, name, short_name, crest_url),
            away_team:teams!away_team_id(id, name, short_name, crest_url)
          )
        `)
        .eq('player_id', playerId)
        .neq('status', 'bench')
        .neq('status', 'not_in_squad')
        .order('fixtures(kickoff_utc)', { ascending: false })
        .limit(limit)

      // Best-effort — no fixture_player_status data is a normal, expected
      // state today (empty table, see hook comment above), not an error
      // condition worth surfacing to the user.
      if (error) return []
      return data ?? []
    },
  })
}

// Phase 25 — Standings page's "Player Statistics" table. Bulk equivalent
// of usePlayerSeasonStats: one query per league/season (not one per
// player) returning every player currently rostered to a team in this
// league, with real goals/assists/cards from player_season_stats (0
// where a player has recorded none — a real, legitimate zero, not a data
// gap) joined in. Starts/minutesPlayed use the exact same derivation as
// usePlayerSeasonStats (best-effort off fixture_player_status), just
// computed once per league instead of once per player.
//
// Phase 25 (review pass) — shots/passes/tackles/aerials/rating now come
// from `player_season_match_stats` (migration 036), aggregated from
// WhoScored's own already-scraped per-player match stats
// (`ws-live-events.js` now parses `matchData.home/away.players[].stats`,
// not just `incidentEvents`). Same best-effort pattern as appearances:
// every one of these fields is null (never a fabricated 0) whenever this
// player has no rows there yet — true for every player before
// `ws-live-events.js` has run against a fixture they played in (e.g. an
// entire season with no matches played yet).
export function useLeaguePlayerStats(leagueId, seasonId) {
  return useQuery({
    queryKey: ['league-player-stats', leagueId, seasonId],
    enabled: !!leagueId && !!seasonId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: rosterRows, error: rosterError } = await supabase
        .from('player_team_history')
        .select(`
          player_id, created_at,
          players (id, display_name, position, photo_url),
          team:teams!inner (id, name, short_name, crest_url, league_id, season_id)
        `)
        .eq('is_active', true)
        .eq('team.league_id', leagueId)
        .eq('team.season_id', seasonId)
      if (rosterError) throw rosterError

      // Found live: a handful of players have more than one
      // `is_active = true` player_team_history row within the SAME
      // league/season (e.g. a mid-season transfer whose old row was never
      // retired) — a real data-hygiene gap, not something this hook can
      // fix. Left undeduped, this produced two rows for the same player
      // in the table (and a React duplicate-key warning). One row per
      // player is kept — whichever is most recently created, on the
      // assumption a later `player_team_history` row is more likely to
      // reflect the player's current club after a transfer than an
      // earlier, stale one.
      const rosterByPlayer = new Map()
      for (const row of rosterRows ?? []) {
        const existing = rosterByPlayer.get(row.player_id)
        if (!existing || new Date(row.created_at) > new Date(existing.created_at)) {
          rosterByPlayer.set(row.player_id, row)
        }
      }
      const roster = [...rosterByPlayer.values()]

      const { data: statsRows, error: statsError } = await supabase
        .from('player_season_stats')
        .select('player_id, goals, assists, yellow_cards, red_cards')
        .eq('season_id', seasonId)
      if (statsError) throw statsError
      const statsByPlayer = new Map((statsRows ?? []).map((r) => [r.player_id, r]))

      // Best-effort — player_season_match_stats is empty until
      // ws-live-events.js has scraped at least one fixture this player
      // appeared in (e.g. the whole current season before matchday one).
      // A failed/empty read must never block the reliable goals/assists
      // rows above.
      const { data: matchStatsRows, error: matchStatsError } = await supabase
        .from('player_season_match_stats')
        .select('*')
        .eq('season_id', seasonId)
      const matchStatsByPlayer = new Map(
        (!matchStatsError && matchStatsRows ? matchStatsRows : []).map((r) => [r.player_id, r])
      )
      const matchStatsAvailable = matchStatsByPlayer.size > 0

      // Best-effort appearances/starts/minutes — same fixture_player_status
      // caveat as usePlayerSeasonStats (empty table today, ISSUE-2). A
      // failed/empty read must never block the reliable goals/assists
      // rows above; an empty result leaves every player's fields at null
      // so the UI can hide those columns entirely rather than show a
      // false 0.
      const { data: statusRows, error: statusError } = await supabase
        .from('fixture_player_status')
        .select(`
          player_id, status, started, came_on_minute, went_off_minute,
          fixtures!inner(minute, status, gameweeks!inner(league_id, season_id))
        `)
        .eq('fixtures.gameweeks.league_id', leagueId)
        .eq('fixtures.gameweeks.season_id', seasonId)
      const appearancesByPlayer = new Map()
      const startsByPlayer = new Map()
      const minutesByPlayer = new Map()
      if (!statusError && statusRows && statusRows.length > 0) {
        for (const row of statusRows) {
          if (row.status === 'bench' || row.status === 'not_in_squad') continue
          appearancesByPlayer.set(row.player_id, (appearancesByPlayer.get(row.player_id) ?? 0) + 1)
          if (row.started) startsByPlayer.set(row.player_id, (startsByPlayer.get(row.player_id) ?? 0) + 1)

          const fixtureFinalMinute = row.fixtures?.status === 'finished' ? 90 : (row.fixtures?.minute ?? 90)
          let minutes = fixtureFinalMinute
          if (row.status === 'sub_on') {
            const off = row.went_off_minute ?? fixtureFinalMinute
            minutes = Math.max(0, off - (row.came_on_minute ?? 0))
          } else if (row.status === 'sub_off') {
            minutes = row.went_off_minute ?? 0
          }
          minutesByPlayer.set(row.player_id, (minutesByPlayer.get(row.player_id) ?? 0) + minutes)
        }
      }
      const appearancesAvailable = appearancesByPlayer.size > 0

      return (roster ?? []).map((row) => {
        const stats = statsByPlayer.get(row.player_id)
        const ms = matchStatsByPlayer.get(row.player_id)
        return {
          playerId: row.player_id,
          displayName: row.players?.display_name ?? 'Unknown',
          position: row.players?.position ?? null,
          photoUrl: row.players?.photo_url ?? null,
          team: row.team,
          goals: stats?.goals ?? 0,
          assists: stats?.assists ?? 0,
          yellowCards: stats?.yellow_cards ?? 0,
          redCards: stats?.red_cards ?? 0,
          appearances: appearancesAvailable ? (appearancesByPlayer.get(row.player_id) ?? 0) : null,
          starts: appearancesAvailable ? (startsByPlayer.get(row.player_id) ?? 0) : null,
          minutesPlayed: appearancesAvailable ? (minutesByPlayer.get(row.player_id) ?? 0) : null,
          rating: matchStatsAvailable ? (ms?.avg_rating ?? null) : null,
          shotsTotal: matchStatsAvailable ? (ms?.shots_total ?? 0) : null,
          shotsOnTarget: matchStatsAvailable ? (ms?.shots_on_target ?? 0) : null,
          keyPasses: matchStatsAvailable ? (ms?.key_passes ?? 0) : null,
          passesTotal: matchStatsAvailable ? (ms?.passes_total ?? 0) : null,
          passesAccurate: matchStatsAvailable ? (ms?.passes_accurate ?? 0) : null,
          passSuccess: matchStatsAvailable ? (ms?.pass_success ?? null) : null,
          foulsCommitted: matchStatsAvailable ? (ms?.fouls_committed ?? 0) : null,
          offsides: matchStatsAvailable ? (ms?.offsides_caught ?? 0) : null,
          tacklesTotal: matchStatsAvailable ? (ms?.tackles_total ?? 0) : null,
          tacklesWon: matchStatsAvailable ? (ms?.tackles_won ?? 0) : null,
          interceptions: matchStatsAvailable ? (ms?.interceptions ?? 0) : null,
          clearances: matchStatsAvailable ? (ms?.clearances ?? 0) : null,
          aerialsTotal: matchStatsAvailable ? (ms?.aerials_total ?? 0) : null,
          aerialsWon: matchStatsAvailable ? (ms?.aerials_won ?? 0) : null,
          totalSaves: matchStatsAvailable ? (ms?.total_saves ?? 0) : null,
        }
      })
    },
  })
}

// Phase 8B — "Last meetings" (head-to-head). Deliberately NOT scoped to
// the current season alone — two teams' history is more useful across
// seasons, and `fixtures` already carries every synced match regardless
// of season, so this is a real, non-invented lookup, not a guess. Matches
// either way round (home_a vs away_b, or home_b vs away_a).
export function useHeadToHead(teamAId, teamBId, limit = 5) {
  return useQuery({
    queryKey: ['head-to-head', teamAId, teamBId, limit],
    enabled: !!teamAId && !!teamBId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fixtures')
        .select('id, kickoff_utc, home_goals, away_goals, home_team:teams!home_team_id(id,name,short_name,crest_url), away_team:teams!away_team_id(id,name,short_name,crest_url)')
        .or(
          `and(home_team_id.eq.${teamAId},away_team_id.eq.${teamBId}),and(home_team_id.eq.${teamBId},away_team_id.eq.${teamAId})`
        )
        .eq('status', 'finished')
        .order('kickoff_utc', { ascending: false })
        .limit(limit)
      if (error) throw error
      return data ?? []
    },
  })
}
