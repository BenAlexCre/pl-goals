import { useParams } from 'react-router-dom'
import { useGameweek } from '../hooks/useGameweek'
import { usePotEntries, useFixturePlayerStatuses } from '../hooks/useEntry'
import { useLiveScores } from '../hooks/useLiveScores'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import LivePickCard from '../components/picks/LivePickCard'
import { toLocalTimeShort } from '../utils/time'

function eventLabel(event) {
  if (event.event_type === 'goal') {
    if (event.is_own_goal) return '⚽ OG'
    if (event.is_penalty) return '⚽ P'
    return '⚽'
  }
  if (event.event_type === 'yellow_card') return '🟨'
  if (event.event_type === 'red_card') return '🟥'
  if (event.event_type === 'sub_on') return '↑'
  if (event.event_type === 'sub_off') return '↓'
  return ''
}

function FixtureEvents({ events = [] }) {
  const goals = events
    .filter(e => e.event_type === 'goal')
    .sort((a, b) => a.minute - b.minute)

  const cards = events
    .filter(e => e.event_type === 'yellow_card' || e.event_type === 'red_card')
    .sort((a, b) => a.minute - b.minute)

  if (!goals.length && !cards.length) return null

  return (
    <div className="mt-3 space-y-1 border-t border-white/6 pt-3">
      {goals.map(e => (
        <div key={e.id} className="flex items-center gap-2 text-sm text-white/70">
          <span className="text-white/30 tabular w-8 text-right">{e.minute}'</span>
          <span>{eventLabel(e)}</span>
          {e.is_own_goal && (
            <span className="text-xs text-white/40 bg-white/5 px-1.5 py-0.5 rounded">OG</span>
          )}
          {e.is_penalty && (
            <span className="text-xs text-white/40 bg-white/5 px-1.5 py-0.5 rounded">P</span>
          )}
        </div>
      ))}
      {cards.map(e => (
        <div key={e.id} className="flex items-center gap-2 text-sm text-white/50">
          <span className="text-white/30 tabular w-8 text-right">{e.minute}'</span>
          <span>{eventLabel(e)}</span>
        </div>
      ))}
    </div>
  )
}

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

export default function GameweekPage() {
  const { potId, gameweekId } = useParams()
  const { data: gameweek } = useGameweek(gameweekId)
  const { data: entries = [] } = usePotEntries(potId, gameweekId)
  const { data: playerStatusMap = new Map() } = useFixturePlayerStatuses(gameweekId)

  useLiveScores(gameweekId, potId)

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
          {(gameweek?.fixtures ?? []).map(fixture => (
            <Card key={fixture.id} className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-white font-medium">
                    {fixture.home_team?.name} vs {fixture.away_team?.name}
                  </p>
                  <p className="text-xs text-white/35 mt-1">
                    {toLocalTimeShort(fixture.kickoff_utc)}
                  </p>
                </div>
                <div className="text-right">
                  <Badge status={fixture.status}>{fixture.status}</Badge>
                  <p className="mt-1 text-sm text-white/60 tabular-nums">
                    {fixture.home_goals} – {fixture.away_goals}
                    {fixture.status === 'live' && fixture.minute && (
                      <span className="ml-2 text-xs text-green-400">{fixture.minute}'</span>
                    )}
                  </p>
                </div>
              </div>
              <FixtureEvents events={fixture.fixture_events ?? []} />
            </Card>
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
                <Badge status={entry.is_void ? 'void' : entry.status}>
                  {entry.is_void ? 'Void' : entry.status}
                </Badge>
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                {(entry.user_entry_picks ?? []).map(pick => (
                  <div key={pick.id} className="space-y-1">
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
                    <AppearanceBadge statusRow={playerStatusMap.get(pick.player_id)} />
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </section>
    </div>
  )
}