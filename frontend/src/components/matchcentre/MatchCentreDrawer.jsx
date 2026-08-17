import { useState } from 'react'
import { Shield } from 'lucide-react'
import SlideDrawer from '../ui/SlideDrawer'
import TeamForm from './TeamForm'
import FixtureEventsTimeline from './FixtureEventsTimeline'
import PlayerDrawer from './PlayerDrawer'
import { useTeamHomeAwayRecord } from '../../hooks/useMatchCentre'
import { toLocalTimeShort } from '../../utils/time'

function Crest({ url }) {
  return (
    <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-surface-3">
      {url ? <img src={url} alt="" className="h-8 w-8 object-contain" /> : <Shield size={22} className="text-white/25" />}
    </div>
  )
}

function StatRow({ label, home, away }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="w-12 text-left font-semibold text-white tabular">{home ?? '—'}</span>
      <span className="text-white/40">{label}</span>
      <span className="w-12 text-right font-semibold text-white tabular">{away ?? '—'}</span>
    </div>
  )
}

function RecordLine({ label, record }) {
  if (!record || record.played === 0) return null
  return (
    <p className="text-xs text-white/45">
      {label}: {record.won}W {record.drawn}D {record.lost}L
    </p>
  )
}

// Premium fixture detail drawer — Overview / Home team / Away team /
// table comparison, and (if live) the shared FixtureEventsTimeline. No
// second live-polling subscription is created here — it reads the same
// `fixture` object (with its nested fixture_events) the caller already
// has from useGameweek/useCurrentGameweek + useLiveScores, passed down as
// a prop, so realtime invalidation upstream is what keeps this fresh.
export default function MatchCentreDrawer({ open, onClose, fixture, leagueId, seasonId, homeStanding, awayStanding, homeForm, awayForm, competitionName }) {
  const [activePlayerId, setActivePlayerId] = useState(null)

  const { data: homeRecord } = useTeamHomeAwayRecord(fixture?.home_team?.id, leagueId, seasonId)
  const { data: awayRecord } = useTeamHomeAwayRecord(fixture?.away_team?.id, leagueId, seasonId)

  if (!fixture) return null

  const isLive = fixture.status === 'live'
  const isFinished = fixture.status === 'finished'

  return (
    <>
      <SlideDrawer open={open} onClose={onClose} title="Match Centre" widthClass="max-w-lg">
        <div className="space-y-6">
          {/* Overview */}
          <section>
            <div className="flex items-center justify-between">
              <Crest url={fixture.home_team?.crest_url} />
              <div className="text-center">
                {isLive || isFinished ? (
                  <p className="text-3xl font-bold tabular text-white">
                    {fixture.home_goals}&ndash;{fixture.away_goals}
                  </p>
                ) : (
                  <p className="text-lg font-semibold text-white/50">vs</p>
                )}
                {isLive && (
                  <p className="mt-1 text-xs font-medium text-red-goal">{fixture.minute ? `${fixture.minute}'` : 'Live'}</p>
                )}
              </div>
              <Crest url={fixture.away_team?.crest_url} />
            </div>
            <div className="mt-3 flex items-center justify-between text-sm font-semibold text-white">
              <span>{fixture.home_team?.name}</span>
              <span>{fixture.away_team?.name}</span>
            </div>
            <div className="mt-4 space-y-1 rounded-xl border border-white/8 bg-black/10 p-3 text-xs text-white/45">
              <p>Kickoff: {toLocalTimeShort(fixture.kickoff_utc)}</p>
              <p>Competition: {competitionName}</p>
              {/* Venue intentionally omitted — fixtures has no venue
                  column; nothing invented in its place. */}
            </div>
          </section>

          {/* Home / Away team sections */}
          <section className="grid grid-cols-2 gap-4">
            {[
              { team: fixture.home_team, standing: homeStanding, form: homeForm, record: homeRecord?.home, recordLabel: 'Home record' },
              { team: fixture.away_team, standing: awayStanding, form: awayForm, record: awayRecord?.away, recordLabel: 'Away record' },
            ].map(({ team, standing, form, record, recordLabel }) => (
              <div key={team?.id ?? recordLabel} className="rounded-xl border border-white/8 bg-surface-2/40 p-3">
                <p className="truncate text-sm font-semibold text-white">{team?.name}</p>
                {standing ? (
                  <p className="mt-1 text-xs text-white/45">
                    {standing.position}{standing.position === 1 ? 'st' : standing.position === 2 ? 'nd' : standing.position === 3 ? 'rd' : 'th'} in table
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-white/30">No completed fixtures yet</p>
                )}
                <div className="mt-2">
                  <TeamForm results={form?.results} size="sm" />
                </div>
                {form && form.played > 0 && (
                  <p className="mt-2 text-xs text-white/45">
                    {form.goalsFor} scored · {form.goalsAgainst} conceded · {form.cleanSheets} clean sheets
                  </p>
                )}
                <RecordLine label={recordLabel} record={record} />
              </div>
            ))}
          </section>

          {/* League table position comparison */}
          {(homeStanding || awayStanding) && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-white">League table</h3>
              <div className="rounded-xl border border-white/8 bg-black/10 p-3">
                <StatRow label="Position" home={homeStanding?.position} away={awayStanding?.position} />
                <StatRow label="Points" home={homeStanding?.points} away={awayStanding?.points} />
                <StatRow label="Played" home={homeStanding?.played} away={awayStanding?.played} />
                <StatRow label="Goal difference" home={homeStanding?.goal_difference} away={awayStanding?.goal_difference} />
              </div>
            </section>
          )}

          {/* Live/finished events */}
          {(isLive || isFinished) && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-white">{isLive ? 'Live' : 'Match'} events</h3>
              <FixtureEventsTimeline
                events={fixture.fixture_events ?? []}
                onPlayerClick={setActivePlayerId}
              />
            </section>
          )}
        </div>
      </SlideDrawer>

      <PlayerDrawer
        open={!!activePlayerId}
        onClose={() => setActivePlayerId(null)}
        playerId={activePlayerId}
      />
    </>
  )
}
