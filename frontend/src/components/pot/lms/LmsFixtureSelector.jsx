import { useState } from 'react'
import { BarChart3 } from 'lucide-react'
import { useLeagueStandings, useTeamForm, fixtureDifficultyFromStanding } from '../../../hooks/useMatchCentre'
import TeamForm from '../../matchcentre/TeamForm'
import MatchCentreDrawer from '../../matchcentre/MatchCentreDrawer'
import TeamCrest from '../../ui/TeamCrest'
import { toLocalTimeShort } from '../../../utils/time'
import { formatTeamName } from '../../../utils/format'

const DIFFICULTY_STYLES = {
  easy: 'border-accent/30 bg-accent/10 text-accent',
  balanced: 'border-amber/30 bg-amber/10 text-amber',
  difficult: 'border-red-goal/30 bg-red-goal/10 text-red-goal',
}
const DIFFICULTY_LABEL = { easy: 'Easy', balanced: 'Balanced', difficult: 'Difficult' }

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

function TeamOption({ team, standing, form, selected, isSaved, disabled, disabledReason, align, onSelect }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      aria-pressed={selected}
      aria-label={`${team?.name}${selected ? ', selected' : ''}${disabled ? `, unavailable${disabledReason ? `: ${disabledReason}` : ''}` : ''}`}
      className={`
        flex min-w-0 flex-1 flex-col items-center gap-2 rounded-2xl border p-3 text-center transition-all
        ${selected ? 'border-accent bg-accent/10 shadow-[0_0_0_1px_rgba(0,230,118,0.4)]' : 'border-white/8 bg-surface-1 hover:border-white/20 hover:bg-surface-2'}
        disabled:cursor-not-allowed disabled:opacity-35
      `}
    >
      <TeamCrest team={team} size="lg" />
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-tight text-white">{formatTeamName(team)}</p>
        <div className={`mt-1 flex items-center justify-center gap-1.5 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
          {standing ? (
            <span className="text-[11px] text-white/35">{standing.position}{ordinalSuffix(standing.position)}</span>
          ) : null}
          <TeamForm results={form} size="sm" />
        </div>
      </div>
      {disabled && disabledReason ? (
        <p className="text-[10px] leading-tight text-red-goal/70">{disabledReason}</p>
      ) : selected && isSaved ? (
        <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-pitch-950">SAVED</span>
      ) : selected ? (
        <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-bold text-accent">SELECTED</span>
      ) : null}
    </button>
  )
}

// Phase 9B — the LMS picker's own fixture surface (Part 12/13/14/15). The
// fixture IS the selection: home team, a stats icon opening the existing
// MatchCentreDrawer unmodified, and away team, side by side — replacing
// the old FixtureCard-plus-two-TeamCard-buttons redundancy (a full
// clickable fixture card whose own click target competed with two
// separate team-selection buttons underneath it for the same decision).
// Deliberately a new sibling component, not a mode grafted onto
// FixtureCard itself — FixtureCard's "whole card opens the drawer" model
// and this "pick one of two teams" model are different enough that
// merging them would complicate FixtureCard for its other three unrelated
// consumers (Dashboard, GameweekPage, Pick5FixturePicker, Predictor).
// Reuses the exact same data hooks FixtureCard/TeamCard already call
// (React Query dedupes identical keys — no extra network cost for
// rendering several of these in one gameweek).
export default function LmsFixtureSelector({
  fixture,
  leagueId,
  seasonId,
  competitionName,
  homeSelected,
  awaySelected,
  homeIsSaved,
  awayIsSaved,
  homeDisabled,
  awayDisabled,
  disabledReason,
  onSelectHome,
  onSelectAway,
}) {
  const [drawerOpen, setDrawerOpen] = useState(false)

  const { data: standings = [] } = useLeagueStandings(leagueId, seasonId)
  const homeStanding = standings.find((s) => s.team_id === fixture.home_team?.id)
  const awayStanding = standings.find((s) => s.team_id === fixture.away_team?.id)

  const { data: homeForm } = useTeamForm(fixture.home_team?.id, leagueId, seasonId)
  const { data: awayForm } = useTeamForm(fixture.away_team?.id, leagueId, seasonId)

  const difficulty = fixtureDifficultyFromStanding(homeStanding) === 'difficult' || fixtureDifficultyFromStanding(awayStanding) === 'difficult'
    ? 'difficult'
    : (fixtureDifficultyFromStanding(homeStanding) === 'easy' && fixtureDifficultyFromStanding(awayStanding) === 'easy')
      ? 'easy'
      : (fixtureDifficultyFromStanding(homeStanding) || fixtureDifficultyFromStanding(awayStanding))

  const isLive = fixture.status === 'live'
  const hasScore = fixture.status === 'live' || fixture.status === 'finished'

  return (
    <>
      <div className="rounded-2xl border border-white/8 bg-surface-1 p-4">
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

        <div className="mt-3 flex items-center gap-2">
          <TeamOption
            team={fixture.home_team}
            standing={homeStanding}
            form={homeForm?.results}
            selected={homeSelected}
            isSaved={homeIsSaved}
            disabled={homeDisabled}
            disabledReason={disabledReason}
            align="left"
            onSelect={onSelectHome}
          />

          <div className="flex shrink-0 flex-col items-center gap-1.5">
            {hasScore ? (
              <span className="rounded-lg bg-black/20 px-2.5 py-1 text-base font-bold tabular text-white">
                {fixture.home_goals}&ndash;{fixture.away_goals}
              </span>
            ) : (
              <span className="text-xs font-medium text-white/25">vs</span>
            )}
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open Match Centre for this fixture"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-surface-2 text-white/50 transition-colors hover:border-accent/30 hover:text-accent"
            >
              <BarChart3 size={14} />
            </button>
          </div>

          <TeamOption
            team={fixture.away_team}
            standing={awayStanding}
            form={awayForm?.results}
            selected={awaySelected}
            isSaved={awayIsSaved}
            disabled={awayDisabled}
            disabledReason={disabledReason}
            align="right"
            onSelect={onSelectAway}
          />
        </div>
      </div>

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
