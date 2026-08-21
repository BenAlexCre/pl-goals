import { useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Trophy, BarChart3, Info } from 'lucide-react'
import { usePots } from '../hooks/usePots'
import { useLeagueStandings, useLeagueTeams, useLeaguePlayerStats } from '../hooks/useMatchCentre'
import Card from '../components/ui/Card'
import Spinner from '../components/ui/Spinner'
import EmptyState from '../components/ui/EmptyState'
import { formatTeamName, formatSeasonName } from '../utils/format'

function TabButton({ active, onClick, icon: Icon, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-2xl border px-4 py-2 text-sm font-medium transition ${
        active
          ? 'border-accent/30 bg-accent/10 text-accent'
          : 'border-white/10 bg-surface-1 text-white/65 hover:text-white'
      }`}
    >
      <Icon size={15} />
      {children}
    </button>
  )
}

// Item 19 — every column this app's data sources can actually support.
// `player_season_stats`/`fixture_player_status` cover goals/assists/
// cards/appearances; `player_season_match_stats` (migration 036) covers
// the rest — a real Opta-style per-player aggregate built from
// WhoScored's own already-scraped match stats (`ws-live-events.js`, Phase
// 25 review pass), not a new provider. `requiresAppearances`/
// `requiresMatchStats` columns hide themselves (never show a fabricated
// 0) whenever their underlying source has no rows yet for this league/
// season — true for every league before any fixture in it has actually
// been scraped, e.g. a season with no matches played.
const COLUMN_DEFS = {
  appearances: { label: 'Apps', get: (p) => p.appearances, requiresAppearances: true },
  starts: { label: 'Starts', get: (p) => p.starts, requiresAppearances: true },
  minutesPlayed: { label: 'Mins', get: (p) => p.minutesPlayed, requiresAppearances: true },
  goals: { label: 'Goals', get: (p) => p.goals },
  assists: { label: 'Assists', get: (p) => p.assists },
  yellowCards: { label: 'Yellow', get: (p) => p.yellowCards },
  redCards: { label: 'Red', get: (p) => p.redCards },
  rating: { label: 'Rating', get: (p) => p.rating, requiresMatchStats: true },
  shotsTotal: { label: 'Shots', get: (p) => p.shotsTotal, requiresMatchStats: true },
  shotsOnTarget: { label: 'On target', get: (p) => p.shotsOnTarget, requiresMatchStats: true },
  keyPasses: { label: 'Key passes', get: (p) => p.keyPasses, requiresMatchStats: true },
  passesTotal: { label: 'Passes', get: (p) => p.passesTotal, requiresMatchStats: true },
  passesAccurate: { label: 'Accurate', get: (p) => p.passesAccurate, requiresMatchStats: true },
  passSuccess: { label: 'Pass %', get: (p) => p.passSuccess, requiresMatchStats: true },
  foulsCommitted: { label: 'Fouls', get: (p) => p.foulsCommitted, requiresMatchStats: true },
  offsides: { label: 'Offsides', get: (p) => p.offsides, requiresMatchStats: true },
  tacklesTotal: { label: 'Tackles', get: (p) => p.tacklesTotal, requiresMatchStats: true },
  tacklesWon: { label: 'Tackles won', get: (p) => p.tacklesWon, requiresMatchStats: true },
  interceptions: { label: 'Interceptions', get: (p) => p.interceptions, requiresMatchStats: true },
  clearances: { label: 'Clearances', get: (p) => p.clearances, requiresMatchStats: true },
  aerialsTotal: { label: 'Aerials', get: (p) => p.aerialsTotal, requiresMatchStats: true },
  aerialsWon: { label: 'Aerials won', get: (p) => p.aerialsWon, requiresMatchStats: true },
  totalSaves: { label: 'Saves', get: (p) => p.totalSaves, requiresMatchStats: true },
}

// Categories mirror an Opta-style stats page's own section list (General/
// Attacking/Passing/Discipline/Defending/Goalkeeping/Ratings).
// `unavailable` is a fallback message only — shown when this category's
// columns genuinely have no data yet (`requiresMatchStats` columns are
// empty everywhere until ws-live-events.js has scraped at least one
// fixture), never a permanent "this can't exist" claim. Goalkeeping is
// additionally filtered to goalkeepers only (`filterGoalkeepers`) — a
// non-keeper genuinely has 0 saves, which is correct but not useful to
// list.
const STAT_CATEGORIES = [
  { key: 'overview', label: 'Overview', icon: BarChart3, columns: ['appearances', 'starts', 'minutesPlayed', 'goals', 'assists', 'yellowCards', 'redCards', 'rating'], defaultSort: 'goals' },
  { key: 'attacking', label: 'Attacking', icon: BarChart3, columns: ['goals', 'assists', 'shotsTotal', 'shotsOnTarget', 'keyPasses'], defaultSort: 'goals', unavailable: 'Shots and key passes aren’t available yet for this season — they’re sourced from match stats that only exist once a fixture has actually been played and scraped.' },
  { key: 'passing', label: 'Passing', icon: BarChart3, columns: ['passesTotal', 'passesAccurate', 'passSuccess'], defaultSort: 'passesTotal', unavailable: 'Passing data isn’t available yet for this season — it’s sourced from match stats that only exist once a fixture has actually been played and scraped.' },
  { key: 'discipline', label: 'Discipline', icon: BarChart3, columns: ['yellowCards', 'redCards', 'foulsCommitted', 'offsides'], defaultSort: 'yellowCards' },
  { key: 'defending', label: 'Defending', icon: BarChart3, columns: ['tacklesTotal', 'tacklesWon', 'interceptions', 'clearances', 'aerialsTotal', 'aerialsWon'], defaultSort: 'tacklesTotal', unavailable: 'Defensive data isn’t available yet for this season — it’s sourced from match stats that only exist once a fixture has actually been played and scraped.' },
  { key: 'goalkeeping', label: 'Goalkeeping', icon: BarChart3, columns: ['totalSaves'], defaultSort: 'totalSaves', filterGoalkeepers: true, unavailable: 'Goalkeeping data isn’t available yet for this season — it’s sourced from match stats that only exist once a fixture has actually been played and scraped.' },
  { key: 'ratings', label: 'Ratings', icon: BarChart3, columns: ['rating'], defaultSort: 'rating', unavailable: 'Player ratings aren’t available yet for this season — they’re sourced from match stats that only exist once a fixture has actually been played and scraped.' },
]

function TeamCell({ team }) {
  return (
    <div className="flex items-center gap-2">
      {team?.crest_url ? <img src={team.crest_url} alt="" className="h-5 w-5 shrink-0 object-contain" /> : null}
      <span className="truncate">{team ? formatTeamName(team) : '—'}</span>
    </div>
  )
}

// Phase 25, item 14/18/19 — real Premier League table + player statistics,
// both derived entirely from data already synced into this app (fixtures,
// fixture_events, teams) via the same league_team_standings/
// player_season_stats views/hooks Match Centre already uses elsewhere —
// no new data provider, nothing hard-coded.
export default function Standings() {
  const location = useLocation()
  const { data: pots = [] } = usePots()

  // Which league/season to show: whatever the caller passed via route
  // state (Dashboard passes the gameweek currently on screen there),
  // falling back to the viewer's own first pot when this page is opened
  // directly (a bookmark, a manual URL) — never a hard-coded league.
  const fallbackPot = pots[0]
  const leagueId = location.state?.leagueId ?? fallbackPot?.league_id ?? null
  const seasonId = location.state?.seasonId ?? fallbackPot?.season_id ?? null
  const leagueName = location.state?.leagueName ?? fallbackPot?.leagues?.name ?? 'Premier League'
  const season = location.state?.season ?? fallbackPot?.seasons ?? null

  const [tab, setTab] = useState('table')
  const [statCategory, setStatCategory] = useState('overview')
  const [playerSort, setPlayerSort] = useState('goals')

  const { data: standings = [], isLoading: standingsLoading } = useLeagueStandings(leagueId, seasonId)
  const { data: teams = [], isLoading: teamsLoading } = useLeagueTeams(leagueId, seasonId)
  const { data: playerStats = [], isLoading: playersLoading } = useLeaguePlayerStats(leagueId, seasonId)

  // Item 18 — the league table must show every team from matchday one,
  // not just the ones with a finished fixture. `league_team_standings`
  // deliberately only produces a row once a team has played at least one
  // finished fixture (see its own migration comment) — correct for a
  // running-totals view, but wrong as the sole source for "the table."
  // Every real team (`useLeagueTeams`, unchanged) is the source of truth
  // for "who's in this table"; any team missing a standings row gets
  // explicit, real zeros (not a guess) rather than being left out.
  // Position is computed here rather than trusted from the view's own
  // `row_number()` (which orders ties by `team_id` and would silently
  // omit a zero-stat team anyway) so that "everyone tied at 0" — the
  // exact pre-season state — resolves to alphabetical order as required,
  // and any other genuine tie does too, rather than an arbitrary id.
  const mergedStandings = useMemo(() => {
    const statsByTeam = new Map(standings.map((s) => [s.team_id, s]))
    const rows = teams.map((team) => {
      const s = statsByTeam.get(team.id)
      return {
        team,
        played: s?.played ?? 0,
        won: s?.won ?? 0,
        drawn: s?.drawn ?? 0,
        lost: s?.lost ?? 0,
        goals_for: s?.goals_for ?? 0,
        goals_against: s?.goals_against ?? 0,
        goal_difference: s?.goal_difference ?? 0,
        points: s?.points ?? 0,
      }
    })
    rows.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points
      if (b.goal_difference !== a.goal_difference) return b.goal_difference - a.goal_difference
      if (b.goals_for !== a.goals_for) return b.goals_for - a.goals_for
      return formatTeamName(a.team).localeCompare(formatTeamName(b.team))
    })
    return rows.map((row, i) => ({ ...row, position: i + 1 }))
  }, [teams, standings])

  const activeCategory = STAT_CATEGORIES.find((c) => c.key === statCategory) ?? STAT_CATEGORIES[0]
  const appearancesAvailable = playerStats.some((p) => p.appearances !== null)
  const matchStatsAvailable = playerStats.some((p) => p.rating !== null)
  const visibleColumns = (activeCategory.columns ?? []).filter((key) => {
    const def = COLUMN_DEFS[key]
    if (def.requiresAppearances && !appearancesAvailable) return false
    if (def.requiresMatchStats && !matchStatsAvailable) return false
    return true
  })
  // A category's own "not available" message only applies while its data
  // genuinely doesn't exist yet — once ws-live-events.js has scraped a
  // fixture, the exact same category switches over to real numbers
  // without any code change here.
  const categoryUnavailable = !!activeCategory.unavailable && visibleColumns.length === 0
  const categoryPlayers = activeCategory.filterGoalkeepers
    ? playerStats.filter((p) => p.position === 'Goalkeeper')
    : playerStats
  const sortKey = visibleColumns.includes(playerSort) ? playerSort : (activeCategory.defaultSort ?? visibleColumns[0])
  const sortedPlayers = useMemo(() => {
    const getter = COLUMN_DEFS[sortKey]?.get ?? (() => 0)
    return categoryPlayers.slice().sort((a, b) => (getter(b) ?? -1) - (getter(a) ?? -1))
  }, [categoryPlayers, sortKey])

  if (!leagueId || !seasonId) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Standings</h1>
        <EmptyState
          icon={Trophy}
          title="No competition to show yet"
          description="Join or create a pot to see the league table and player statistics."
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Standings</h1>
        <p className="mt-1 text-sm text-white/45">{leagueName} · {formatSeasonName(season)}</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <TabButton active={tab === 'table'} onClick={() => setTab('table')} icon={Trophy}>
          League table
        </TabButton>
        <TabButton active={tab === 'players'} onClick={() => setTab('players')} icon={BarChart3}>
          Player statistics
        </TabButton>
      </div>

      {tab === 'table' ? (
        standingsLoading || teamsLoading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : mergedStandings.length === 0 ? (
          <EmptyState icon={Trophy} title="No teams found" description="This league/season doesn't have any teams synced yet." />
        ) : (
          <>
            {mergedStandings.every((row) => row.played === 0) && (
              <p className="flex items-center gap-1.5 text-xs text-white/40">
                <Info size={13} /> No matches played yet this season — every team starts level, in alphabetical order.
              </p>
            )}
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-sm">
                <thead>
                  <tr className="border-b border-white/8 text-left text-[11px] font-semibold uppercase tracking-wide text-white/35">
                    <th className="px-3 py-3">#</th>
                    <th className="px-3 py-3">Team</th>
                    <th className="px-3 py-3 text-center">P</th>
                    <th className="px-3 py-3 text-center">W</th>
                    <th className="px-3 py-3 text-center">D</th>
                    <th className="px-3 py-3 text-center">L</th>
                    <th className="px-3 py-3 text-center">GF</th>
                    <th className="px-3 py-3 text-center">GA</th>
                    <th className="px-3 py-3 text-center">GD</th>
                    <th className="px-3 py-3 text-center">Pts</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/6">
                  {mergedStandings.map((row) => (
                    <tr key={row.team.id}>
                      <td className="px-3 py-2.5 tabular text-white/40">{row.position}</td>
                      <td className="px-3 py-2.5 font-medium text-white"><TeamCell team={row.team} /></td>
                      <td className="px-3 py-2.5 text-center tabular text-white/70">{row.played}</td>
                      <td className="px-3 py-2.5 text-center tabular text-white/70">{row.won}</td>
                      <td className="px-3 py-2.5 text-center tabular text-white/70">{row.drawn}</td>
                      <td className="px-3 py-2.5 text-center tabular text-white/70">{row.lost}</td>
                      <td className="px-3 py-2.5 text-center tabular text-white/70">{row.goals_for}</td>
                      <td className="px-3 py-2.5 text-center tabular text-white/70">{row.goals_against}</td>
                      <td className="px-3 py-2.5 text-center tabular text-white/70">
                        {row.goal_difference > 0 ? `+${row.goal_difference}` : row.goal_difference}
                      </td>
                      <td className="px-3 py-2.5 text-center font-semibold tabular text-white">{row.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        )
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 overflow-x-auto pb-1">
            {STAT_CATEGORIES.map((cat) => (
              <TabButton
                key={cat.key}
                active={statCategory === cat.key}
                onClick={() => setStatCategory(cat.key)}
                icon={cat.icon ?? BarChart3}
              >
                {cat.label}
              </TabButton>
            ))}
          </div>

          {categoryUnavailable ? (
            <EmptyState icon={Info} title={`${activeCategory.label} not available yet`} description={activeCategory.unavailable} />
          ) : playersLoading ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : sortedPlayers.length === 0 ? (
            <EmptyState icon={BarChart3} title="No player data yet" description="Player statistics will appear once fixtures have been played this season." />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-white/35">Sort by</span>
                {visibleColumns.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPlayerSort(key)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                      sortKey === key
                        ? 'border-accent/30 bg-accent/10 text-accent'
                        : 'border-white/10 bg-surface-1 text-white/60 hover:text-white'
                    }`}
                  >
                    {COLUMN_DEFS[key].label}
                  </button>
                ))}
              </div>

              {!appearancesAvailable && activeCategory.key === 'overview' && (
                <p className="text-xs text-white/35">
                  Appearances/starts/minutes aren&apos;t available yet for this season.
                </p>
              )}

              <Card className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-white/8 text-left text-[11px] font-semibold uppercase tracking-wide text-white/35">
                      <th className="px-3 py-3">Player</th>
                      <th className="px-3 py-3">Team</th>
                      {visibleColumns.map((key) => (
                        <th key={key} className="px-3 py-3 text-center">{COLUMN_DEFS[key].label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/6">
                    {sortedPlayers.map((player) => (
                      <tr key={player.playerId}>
                        <td className="px-3 py-2.5 font-medium text-white">
                          <span className="truncate">{player.displayName}</span>
                        </td>
                        <td className="px-3 py-2.5 text-white/60"><TeamCell team={player.team} /></td>
                        {visibleColumns.map((key) => (
                          <td key={key} className="px-3 py-2.5 text-center tabular text-white/70">
                            {COLUMN_DEFS[key].get(player) ?? '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  )
}
