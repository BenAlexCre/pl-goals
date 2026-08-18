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
// Deliberately not a bare "Easy"/"Difficult" — reads as a statement about
// the fixture's own quality otherwise. "fixture" in every label plus a
// tooltip makes clear this is fixtureDifficultyFromStanding()'s own
// opponent-league-position heuristic, not an official PL rating.
const DIFFICULTY_LABEL = { easy: 'Easier fixture', balanced: 'Balanced fixture', difficult: 'Tough fixture' }
const DIFFICULTY_TITLE = 'Fixture difficulty — based on the opponent’s league position, not an official rating'

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

// Phase 9 — Demo Gameweek verification found a real, pre-existing overflow
// bug here: this flex item had no min-w-0/flex-1, so a flex child with no
// explicit width defaults to min-width:auto (its content's natural width)
// — harmless with short club names and 0-2 form results (what every prior
// manual check happened to use), but a genuine, confirmed overflow with
// the demo league's longer generated names and a full 3-5-result form row
// (both real once a demo gameweek's history has actually played out).
// min-w-0/flex-1 on the row plus min-w-0/overflow-hidden on the form row
// let the browser shrink/clip gracefully instead of forcing the whole
// card (and page) wider — same fix shape as AppShell.jsx/TopNav.jsx's own
// Phase 8D overflow fixes.
function TeamRow({ team, standing, form, align }) {
  return (
    <div className={`flex min-w-0 flex-1 items-center gap-2.5 ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}>
      <Crest url={team?.crest_url} alt={team?.name} />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-white">{team?.short_name || team?.name || 'TBD'}</p>
        <div className={`mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden ${align === 'right' ? 'flex-row-reverse' : ''}`}>
          {standing ? (
            <span className="shrink-0 text-[11px] text-white/35">{standing.position}{ordinalSuffix(standing.position)}</span>
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

// Phase 9 — Demo Gameweek enhancement (Part 8). Opt-in only: every
// existing consumer (Dashboard, GameweekPage, Pick5/Predictor pickers)
// keeps its current pixel-identical output unless it explicitly passes
// showGoalscorers, so this never turns every fixture card into a match
// report the way the brief itself warns against. Reads fixture.fixture_events
// already embedded by useGameweek()/useCurrentGameweek() — no new query.
function GoalscorerLine({ events = [] }) {
  const goals = events
    .filter((e) => e.event_type === 'goal')
    .sort((a, b) => a.minute - b.minute || (a.extra_minute ?? 0) - (b.extra_minute ?? 0))
  if (goals.length === 0) return null
  return (
    <div className="mt-2.5 space-y-1 border-t border-white/6 pt-2.5">
      {goals.map((g) => (
        <p key={g.id} className="truncate text-xs text-white/45">
          &#9917; {g.player?.display_name ?? 'Unknown'} {g.minute}{g.extra_minute ? `+${g.extra_minute}` : ''}&apos;
          {g.is_own_goal ? ' (OG)' : ''}
        </p>
      ))}
    </div>
  )
}

// The shared fixture card every game mode's picker will eventually
// consume (Phase 8a builds this + wires it into GameweekPage only; the
// three picker redesigns that reuse it are a later phase). Opens
// MatchCentreDrawer on click — one implementation, no per-mode
// duplication.
export default function FixtureCard({ fixture, leagueId, seasonId, competitionName, showGoalscorers = false }) {
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
              <span
                title={DIFFICULTY_TITLE}
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${DIFFICULTY_STYLES[difficulty]}`}
              >
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

        {showGoalscorers && <GoalscorerLine events={fixture.fixture_events} />}
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
