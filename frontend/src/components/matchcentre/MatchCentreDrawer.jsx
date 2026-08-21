import { useEffect, useState } from 'react'
import SlideDrawer from '../ui/SlideDrawer'
import TeamForm from './TeamForm'
import FixtureEventsTimeline from './FixtureEventsTimeline'
import PlayerDrawer from './PlayerDrawer'
import PlayerCard from './PlayerCard'
import TeamCrest from '../ui/TeamCrest'
import { useTeamHomeAwayRecord, useHeadToHead, fixtureDifficultyFromStanding } from '../../hooks/useMatchCentre'
import { usePlayersForFixture, useFixturePlayerStatus } from '../../hooks/usePredictorEntry'
import { toLocalTimeShort, formatFixtureKickoff } from '../../utils/time'
import { formatTeamName } from '../../utils/format'

const DIFFICULTY_STYLES = {
  easy: 'border-accent/30 bg-accent/10 text-accent',
  balanced: 'border-amber/30 bg-amber/10 text-amber',
  difficult: 'border-red-goal/30 bg-red-goal/10 text-red-goal',
}
// Kept in sync with FixtureCard.jsx's own copy of the same labels/tooltip —
// see that file's comment for why these read "...fixture" rather than a
// bare "Easy"/"Difficult".
const DIFFICULTY_LABEL = { easy: 'Easier fixture', balanced: 'Balanced fixture', difficult: 'Tough fixture' }
const DIFFICULTY_TITLE = 'Fixture difficulty — based on the opponent’s league position, not an official rating'

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

// Phase 9 — Demo Gameweek/Match Centre enhancement (Part 12/14). Was one
// long scrolling column; now a fixed score/metadata header (always
// visible — "goals and current match state should be visually prominent",
// Part 14) with the deeper detail organised into tabs, matching the
// brief's own OVERVIEW/STATS/LINEUPS/EVENTS split. Every section below is
// the exact same data/hooks the single-column version already used —
// reorganised, nothing fabricated, nothing removed.
const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'stats', label: 'Stats' },
  { id: 'lineups', label: 'Lineups' },
  { id: 'events', label: 'Events' },
]

export default function MatchCentreDrawer({ open, onClose, fixture, leagueId, seasonId, homeStanding, awayStanding, homeForm, awayForm, competitionName }) {
  const [activePlayerId, setActivePlayerId] = useState(null)
  const [activeTab, setActiveTab] = useState('overview')

  const { data: homeRecord } = useTeamHomeAwayRecord(fixture?.home_team?.id, leagueId, seasonId)
  const { data: awayRecord } = useTeamHomeAwayRecord(fixture?.away_team?.id, leagueId, seasonId)
  const { data: meetings = [] } = useHeadToHead(fixture?.home_team?.id, fixture?.away_team?.id)
  const { data: squad = [] } = usePlayersForFixture(fixture?.home_team?.id, fixture?.away_team?.id)
  // Phase 25 (lineup status) — the Lineups tab previously showed the full
  // club roster with no distinction of who's actually in today's matchday
  // squad. Same canonical source (fixture_player_status) the Score
  // Predictor goalscorer picker already reads via PredictorFixtureCard.jsx
  // — undefined/empty map (not an error) whenever official lineups
  // haven't been received yet for this fixture, which PlayerCard already
  // renders as "no badge" rather than a false status.
  const { data: lineupStatusByPlayer } = useFixturePlayerStatus(fixture?.id)

  // Re-open should always land back on Overview, not wherever a previous
  // fixture's drawer was left — each open is a fresh fixture, not a
  // continuation of browsing the last one.
  useEffect(() => {
    if (open) setActiveTab('overview')
  }, [open, fixture?.id])

  if (!fixture) return null

  const isLive = fixture.status === 'live'
  const isFinished = fixture.status === 'finished'
  const hasEvents = isLive || isFinished

  const difficulty = fixtureDifficultyFromStanding(homeStanding) === 'difficult' || fixtureDifficultyFromStanding(awayStanding) === 'difficult'
    ? 'difficult'
    : (fixtureDifficultyFromStanding(homeStanding) === 'easy' && fixtureDifficultyFromStanding(awayStanding) === 'easy')
      ? 'easy'
      : (fixtureDifficultyFromStanding(homeStanding) || fixtureDifficultyFromStanding(awayStanding))

  // usePlayersForFixture() returns bare {id, display_name, photo_url,
  // position, team_id} — no club name/crest, since Score Predictor's
  // goalscorer <select> (its original consumer) never needed one.
  // PlayerCard wants team_name/team_short_name/crest_url, so they're
  // filled in here from the fixture's own home_team/away_team objects,
  // already available — not a second query.
  function withTeam(p, team) {
    return { ...p, team_name: team?.name, team_short_name: team?.short_name, crest_url: team?.crest_url }
  }
  const homeSquad = squad.filter((p) => p.team_id === fixture.home_team?.id).map((p) => withTeam(p, fixture.home_team))
  const awaySquad = squad.filter((p) => p.team_id === fixture.away_team?.id).map((p) => withTeam(p, fixture.away_team))

  const visibleTabs = hasEvents ? TABS : TABS.filter((t) => t.id !== 'events')

  return (
    <>
      <SlideDrawer open={open} onClose={onClose} title="Match Centre" widthClass="max-w-lg">
        <div className="space-y-5">
          {/* Score header — always visible above the tabs (Part 14: "Top:
              Teams + score. Goals and current match state should be
              visually prominent"). */}
          <section>
            <div className="flex items-center justify-between">
              <TeamCrest team={fixture.home_team} size="xl" />
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
                {isFinished && <p className="mt-1 text-xs font-medium text-white/40">Full time</p>}
              </div>
              <TeamCrest team={fixture.away_team} size="xl" />
            </div>
            <div className="mt-3 flex items-center justify-between text-sm font-semibold text-white">
              <span>{formatTeamName(fixture.home_team)}</span>
              <span>{formatTeamName(fixture.away_team)}</span>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-black/10 p-3 text-xs text-white/45">
              <div className="space-y-1">
                <p>Kickoff: {formatFixtureKickoff(fixture.kickoff_utc, fixture.status)}</p>
                <p>Competition: {competitionName}</p>
                {/* Venue intentionally omitted — fixtures has no venue
                    column; nothing invented in its place. */}
              </div>
              {difficulty && (
                <span
                  title={DIFFICULTY_TITLE}
                  className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium ${DIFFICULTY_STYLES[difficulty]}`}
                >
                  {DIFFICULTY_LABEL[difficulty]}
                </span>
              )}
            </div>
          </section>

          {/* Tab bar */}
          <div role="tablist" aria-label="Match Centre sections" className="flex gap-1 rounded-xl border border-white/8 bg-black/10 p-1">
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors ${
                  activeTab === tab.id ? 'bg-accent/15 text-accent' : 'text-white/45 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Overview — league position/form/record are shown briefly here
              too (compact), plus last meetings; the numeric comparison
              lives under Stats to avoid showing every number twice. */}
          {activeTab === 'overview' && (
            <div role="tabpanel" className="space-y-5">
              <section className="grid grid-cols-2 gap-4">
                {[
                  { team: fixture.home_team, standing: homeStanding, form: homeForm },
                  { team: fixture.away_team, standing: awayStanding, form: awayForm },
                ].map(({ team, standing, form }) => (
                  <div key={team?.id ?? 'team'} className="rounded-xl border border-white/8 bg-surface-2/40 p-3">
                    <p className="truncate text-sm font-semibold text-white">{formatTeamName(team)}</p>
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
                  </div>
                ))}
              </section>

              {meetings.length > 0 && (
                <section>
                  <h3 className="mb-2 text-sm font-semibold text-white">Last meetings</h3>
                  <div className="space-y-1.5">
                    {meetings.map((m) => (
                      <div key={m.id} className="flex items-center justify-between rounded-lg border border-white/8 bg-black/10 px-3 py-2 text-sm text-white/70">
                        <span>{m.home_team?.short_name} {m.home_goals}&ndash;{m.away_goals} {m.away_team?.short_name}</span>
                        <span className="text-xs text-white/35">{toLocalTimeShort(m.kickoff_utc)}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}

          {/* Stats — every numeric readout already computed elsewhere in
              Match Centre (goals for/against, clean sheets, home/away
              record, league table comparison), just gathered under its
              own tab rather than mixed into Overview. No fabricated
              match statistics (shots/possession/etc. don't exist in this
              schema — nothing invented in their place). */}
          {activeTab === 'stats' && (
            <div role="tabpanel" className="space-y-5">
              <section className="grid grid-cols-2 gap-4">
                {[
                  { team: fixture.home_team, form: homeForm, record: homeRecord?.home, recordLabel: 'Home record' },
                  { team: fixture.away_team, form: awayForm, record: awayRecord?.away, recordLabel: 'Away record' },
                ].map(({ team, form, record, recordLabel }) => (
                  <div key={team?.id ?? recordLabel} className="rounded-xl border border-white/8 bg-surface-2/40 p-3">
                    <p className="truncate text-sm font-semibold text-white">{formatTeamName(team)}</p>
                    {form && form.played > 0 ? (
                      <p className="mt-2 text-xs text-white/45">
                        {form.goalsFor} scored &middot; {form.goalsAgainst} conceded &middot; {form.cleanSheets} clean sheets
                      </p>
                    ) : (
                      <p className="mt-2 text-xs text-white/30">No completed fixtures yet</p>
                    )}
                    <div className="mt-1.5">
                      <RecordLine label={recordLabel} record={record} />
                    </div>
                  </div>
                ))}
              </section>

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
            </div>
          )}

          {/* Lineups/Squads */}
          {activeTab === 'lineups' && (
            <div role="tabpanel">
              {squad.length > 0 ? (
                <section className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-white/40">{fixture.home_team?.short_name}</p>
                    {homeSquad.map((p) => (
                      <PlayerCard
                        key={p.id}
                        player={{ ...p, player_id: p.id }}
                        seasonId={seasonId}
                        size="sm"
                        lineupStatus={lineupStatusByPlayer?.get(String(p.id)) ?? null}
                      />
                    ))}
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-white/40">{fixture.away_team?.short_name}</p>
                    {awaySquad.map((p) => (
                      <PlayerCard
                        key={p.id}
                        player={{ ...p, player_id: p.id }}
                        seasonId={seasonId}
                        size="sm"
                        lineupStatus={lineupStatusByPlayer?.get(String(p.id)) ?? null}
                      />
                    ))}
                  </div>
                </section>
              ) : (
                <p className="text-sm text-white/35">No squad data available.</p>
              )}
            </div>
          )}

          {/* Events */}
          {activeTab === 'events' && hasEvents && (
            <div role="tabpanel">
              <FixtureEventsTimeline
                events={fixture.fixture_events ?? []}
                onPlayerClick={setActivePlayerId}
              />
            </div>
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
