import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useGameweek } from '../hooks/useGameweek'
import { usePotEntries, useFixturePlayerStatuses } from '../hooks/useEntry'
import { useLeaderboard } from '../hooks/useLeaderboard'
import { useLiveScores } from '../hooks/useLiveScores'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import LivePickCard from '../components/picks/LivePickCard'
import LeaderboardTable from '../components/leaderboard/LeaderboardTable'
import FixtureCard from '../components/matchcentre/FixtureCard'
import PlayerDrawer from '../components/matchcentre/PlayerDrawer'

function AppearanceBadge({ statusRow }) {
  if (!statusRow) return null

  const map = {
    starting: { label: 'Starting', className: 'text-green-400 bg-green-400/10' },
    bench: { label: 'Bench', className: 'text-white/40 bg-white/5' },
    sub_on: {
      label: statusRow.came_on_minute ? `Sub on ${statusRow.came_on_minute}'` : 'Sub on',
      className: 'text-blue-400 bg-blue-400/10',
    },
    sub_off: {
      label: statusRow.went_off_minute ? `Off ${statusRow.went_off_minute}'` : 'Sub off',
      className: 'text-white/30 bg-white/5',
    },
    not_in_squad: { label: 'Not in squad', className: 'text-white/20 bg-white/5' },
  }

  const config = map[statusRow.status]
  if (!config) return null

  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${config.className}`}>
      {config.label}
    </span>
  )
}

// Phase 8a — Match Centre Core. Fixture rows now render as FixtureCard
// (crest, kickoff, live score, league position, form, difficulty) instead
// of the old plain Card + inline FixtureEvents — clicking one opens
// MatchCentreDrawer (FixtureCard owns that itself). Player names in both
// the events timeline (inside the drawer) and the Entries section below
// now open the same shared PlayerDrawer — one instance at this page
// level, driven by `activePlayerId`, rather than one per card.
export default function GameweekPage() {
  const { potId, gameweekId } = useParams()
  const { data: gameweek } = useGameweek(gameweekId)
  const { data: entries = [] } = usePotEntries(potId, gameweekId)
  const { data: playerStatusMap = new Map() } = useFixturePlayerStatuses(gameweekId)
  const { data: standings = [] } = useLeaderboard(potId, gameweekId ? Number(gameweekId) : null)
  const [activePlayerId, setActivePlayerId] = useState(null)

  useLiveScores(gameweekId, potId)

  const competitionName = gameweek?.leagues?.name || 'Competition'

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">{gameweek?.name}</h1>
            <p className="text-sm text-white/40 mt-1">Fixtures and live pick outcomes</p>
          </div>
          <Badge status={gameweek?.status}>{gameweek?.status}</Badge>
        </div>
      </Card>

      {/* Fixtures */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-3">Fixtures</h2>
        <div className="grid gap-3">
          {(gameweek?.fixtures ?? []).map((fixture) => (
            <FixtureCard
              key={fixture.id}
              fixture={fixture}
              leagueId={gameweek?.league_id}
              seasonId={gameweek?.season_id}
              competitionName={competitionName}
            />
          ))}
        </div>
      </section>

      {/* Entries */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-3">Entries</h2>
        <div className="grid gap-4">
          {entries.map(entry => (
            <Card key={entry.id} className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-white font-medium">{entry.profiles?.display_name}</p>
                  <p className="text-xs text-white/35">@{entry.profiles?.username}</p>
                </div>
                <Badge status={entry.status}>
                  {entry.status === 'void' ? 'Void' : entry.status}
                </Badge>
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                {(entry.pick5_picks ?? []).map(pick => (
                  <div key={pick.id} className="space-y-1">
                    <button
                      type="button"
                      onClick={() => pick.player_id && setActivePlayerId(pick.player_id)}
                      className="block w-full text-left"
                    >
                      <LivePickCard
                        pick={{
                          player_name: pick.players?.display_name ?? `Player #${pick.player_id}`,
                          player_photo: pick.players?.photo_url,
                          goals_scored: pick.goals_scored,
                          goal_threshold: pick.goal_threshold,
                          result: pick.result,
                          appearance: playerStatusMap.get(pick.player_id) ?? null,
                        }}
                      />
                    </button>
                    <AppearanceBadge statusRow={playerStatusMap.get(pick.player_id)} />
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* Standings — pot_standings_snapshots, written by Pick5Engine.generateStandings()
          once this gameweek settles. No prior page rendered this table at all
          (Milestone 4 frontend cutover) — added here since GameweekPage already
          owns "everything about this pot's gameweek." */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-3">Standings</h2>
        <LeaderboardTable rows={standings} />
      </section>

      <PlayerDrawer
        open={!!activePlayerId}
        onClose={() => setActivePlayerId(null)}
        playerId={activePlayerId}
      />
    </div>
  )
}
