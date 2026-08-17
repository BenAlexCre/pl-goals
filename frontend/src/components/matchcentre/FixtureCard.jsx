import { useState } from 'react'
import { Shield } from 'lucide-react'
import { useLeagueStandings, useTeamForm, fixtureDifficultyFromStanding } from '../../hooks/useMatchCentre'
import TeamForm from './TeamForm'
import MatchCentreDrawer from './MatchCentreDrawer'
import { toLocalTimeShort } from '../../utils/time'

const DIFFICULTY_STYLES = {
  easy: 'border-accent/30 bg-accent/10 text-accent',
  balanced: 'border-amber/30 bg-amber/10 text-amber',
  difficult: 'border-red-goal/30 bg-red-goal/10 text-red-goal',
}
const DIFFICULTY_LABEL = { easy: 'Easy', balanced: 'Balanced', difficult: 'Difficult' }

function Crest({ url, alt }) {
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-3">
      {url ? (
        <img src={url} alt="" className="h-6 w-6 object-contain" loading="lazy" />
      ) : (
        <Shield size={16} className="text-white/25" aria-label={alt} />
      )}
    </div>
  )
}

function TeamRow({ team, standing, form, align }) {
  return (
    <div className={`flex items-center gap-2.5 ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}>
      <Crest url={team?.crest_url} alt={team?.name} />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-white">{team?.short_name || team?.name || 'TBD'}</p>
        <div className={`mt-1 flex items-center gap-1.5 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
          {standing ? (
            <span className="text-[11px] text-white/35">{standing.position}{ordinalSuffix(standing.position)}</span>
          ) : null}
          <TeamForm results={form} />
        </div>
      </div>
    </div>
  )
}

function ordinalSuffix(n) {
  if (!n) return ''
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return 'th'
  switch (n % 10) {
    case 1: return 'st'
    case 2: return 'nd'
    case 3: return 'rd'
    default: return 'th'
  }
}

// The shared fixture card every game mode's picker will eventually
// consume (Phase 8a builds this + wires it into GameweekPage only; the
// three picker redesigns that reuse it are a later phase). Opens
// MatchCentreDrawer on click — one implementation, no per-mode
// duplication.
export default function FixtureCard({ fixture, leagueId, seasonId, competitionName }) {
  const [drawerOpen, setDrawerOpen] = useState(false)

  const { data: standings = [] } = useLeagueStandings(leagueId, seasonId)
  const homeStanding = standings.find((s) => s.team_id === fixture.home_team?.id)
  const awayStanding = standings.find((s) => s.team_id === fixture.away_team?.id)

  const { data: homeForm } = useTeamForm(fixture.home_team?.id, leagueId, seasonId)
  const { data: awayForm } = useTeamForm(fixture.away_team?.id, leagueId, seasonId)

  // Difficulty is shown from the AWAY team's perspective of facing the
  // HOME team's league position and vice versa isn't meaningful for a
  // single shared card — shown here as "how tough is this fixture,
  // overall" using the harder of the two opponents' standings, a simple,
  // defensible reading rather than picking a side arbitrarily.
  const difficulty = fixtureDifficultyFromStanding(homeStanding) === 'difficult' || fixtureDifficultyFromStanding(awayStanding) === 'difficult'
    ? 'difficult'
    : (fixtureDifficultyFromStanding(homeStanding) === 'easy' && fixtureDifficultyFromStanding(awayStanding) === 'easy')
      ? 'easy'
      : (fixtureDifficultyFromStanding(homeStanding) || fixtureDifficultyFromStanding(awayStanding))

  const isLive = fixture.status === 'live'
  const hasScore = fixture.status === 'live' || fixture.status === 'finished'

  return (
    <>
      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        className="group w-full rounded-2xl border border-white/8 bg-surface-1 p-4 text-left transition-all hover:border-accent/25 hover:bg-surface-2"
      >
        <div className="flex items-center justify-between gap-2 text-xs text-white/35">
          <span>{competitionName}</span>
          <span className="flex items-center gap-2">
            {difficulty && (
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${DIFFICULTY_STYLES[difficulty]}`}>
                {DIFFICULTY_LABEL[difficulty]}
              </span>
            )}
            {isLive ? (
              <span className="flex items-center gap-1 text-red-goal">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-goal" />
                {fixture.minute ? `${fixture.minute}'` : 'Live'}
              </span>
            ) : (
              <span>{fixture.status === 'finished' ? 'Full time' : toLocalTimeShort(fixture.kickoff_utc)}</span>
            )}
          </span>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <TeamRow team={fixture.home_team} standing={homeStanding} form={homeForm?.results} align="left" />
          {hasScore ? (
            <span className="shrink-0 rounded-lg bg-black/20 px-3 py-1 text-lg font-bold tabular text-white">
              {fixture.home_goals}&ndash;{fixture.away_goals}
            </span>
          ) : (
            <span className="shrink-0 text-sm font-medium text-white/25">vs</span>
          )}
          <TeamRow team={fixture.away_team} standing={awayStanding} form={awayForm?.results} align="right" />
        </div>
      </button>

      <MatchCentreDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        fixture={fixture}
        leagueId={leagueId}
        seasonId={seasonId}
        homeStanding={homeStanding}
        awayStanding={awayStanding}
        homeForm={homeForm}
        awayForm={awayForm}
        competitionName={competitionName}
      />
    </>
  )
}
