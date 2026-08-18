import { useEffect, useMemo, useState } from 'react'
import { BarChart3, ChevronDown, Check, Minus, Plus, Goal } from 'lucide-react'
import { useLeagueStandings, useTeamForm, fixtureDifficultyFromStanding } from '../../../hooks/useMatchCentre'
import { usePlayersForFixture } from '../../../hooks/usePredictorEntry'
import MatchCentreDrawer from '../../matchcentre/MatchCentreDrawer'
import PlayerCard from '../../matchcentre/PlayerCard'
import TeamForm from '../../matchcentre/TeamForm'
import TeamCrest from '../../ui/TeamCrest'
import Button from '../../ui/Button'
import { toLocalTimeShort } from '../../../utils/time'
import { formatTeamName } from '../../../utils/format'

const DIFFICULTY_STYLES = {
  easy: 'border-accent/30 bg-accent/10 text-accent',
  balanced: 'border-amber/30 bg-amber/10 text-amber',
  difficult: 'border-red-goal/30 bg-red-goal/10 text-red-goal',
}
const DIFFICULTY_LABEL = { easy: 'Easier fixture', balanced: 'Balanced fixture', difficult: 'Tough fixture' }
const DIFFICULTY_TITLE = 'Fixture difficulty — based on the opponent’s league position, not an official rating'
const MAX_SCORE = 20

// Required goalscorer-grouping order (Forwards -> Midfielders -> Defenders
// -> Goalkeepers), mapped onto the real `players.position` vocabulary.
const POSITION_ORDER = ['Offence', 'Midfield', 'Defence', 'Goalkeeper']
const POSITION_LABELS = { Offence: 'Forwards', Midfield: 'Midfielders', Defence: 'Defenders', Goalkeeper: 'Goalkeepers' }

function groupPlayersByTeamAndPosition(players, homeTeam, awayTeam) {
  return [
    { side: 'HOME TEAM', team: homeTeam },
    { side: 'AWAY TEAM', team: awayTeam },
  ]
    .filter(({ team }) => team)
    .map(({ side, team }) => {
      const teamPlayers = players.filter((p) => p.team_id === team.id)
      const byPosition = new Map()
      for (const p of teamPlayers) {
        const key = p.position || 'Other'
        if (!byPosition.has(key)) byPosition.set(key, [])
        byPosition.get(key).push(p)
      }
      const orderedPositions = [
        ...POSITION_ORDER.filter((pos) => byPosition.has(pos)),
        ...[...byPosition.keys()].filter((pos) => !POSITION_ORDER.includes(pos)),
      ]
      return { side, team, groups: orderedPositions.map((position) => ({ position, players: byPosition.get(position) })) }
    })
    .filter(({ groups }) => groups.length > 0)
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

// Phase 14, Part 3 — vertical stack (crest above name), reused from
// FixtureCard.jsx/LmsFixtureSelector.jsx's own established fix for the
// same problem (a horizontal crest+name arrangement permanently spends
// ~40px of a narrow column on the crest, truncating real names at mobile
// widths). Full name, not short_name (formatTeamName) — wraps rather
// than truncates.
function TeamMeta({ team, standing, form, align = 'center' }) {
  return (
    <div className={`flex min-w-0 flex-1 flex-col gap-1.5 ${align === 'center' ? 'items-center text-center' : align === 'left' ? 'items-start text-left' : 'items-end text-right'}`}>
      <TeamCrest team={team} size="lg" />
      <p className="text-sm font-semibold leading-tight text-white">{formatTeamName(team)}</p>
      <div className={`flex min-w-0 items-center gap-1.5 overflow-hidden ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        {standing ? (
          <span className="shrink-0 text-[11px] text-white/35">{standing.position}{ordinalSuffix(standing.position)}</span>
        ) : null}
        <TeamForm results={form?.results} size="sm" />
      </div>
    </div>
  )
}

// Phase 14, Part 4 — a real stepper (−/+ either side of the number)
// instead of a bare native number input floating in the card. Keyboard
// entry is preserved (the number itself is still a real, focusable,
// typeable input, just visually anchored between two buttons) — nothing
// about the underlying value or validation changes, only the control.
function ScoreStepper({ label, teamName, value, onChange, disabled }) {
  const num = value === '' ? null : Number(value)
  function step(delta) {
    const next = Math.min(MAX_SCORE, Math.max(0, (num ?? 0) + delta))
    onChange(String(next))
  }
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="text-center">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-white/40">{label}</p>
        <p className="max-w-[7rem] truncate text-xs text-white/50">{teamName}</p>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={disabled || num === 0 || num === null}
          aria-label={`Decrease ${label.toLowerCase()}`}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-surface-2 text-white/60 transition-colors hover:border-accent/30 hover:text-accent disabled:cursor-not-allowed disabled:opacity-30"
        >
          <Minus size={14} />
        </button>
        <input
          type="number"
          inputMode="numeric"
          min="0"
          max={MAX_SCORE}
          step="1"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-label={`Predicted score for ${teamName}`}
          className="w-14 rounded-xl border border-white/10 bg-surface-2 py-2 text-center text-2xl font-bold text-white outline-none focus:border-accent/50 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => step(1)}
          disabled={disabled || num === MAX_SCORE}
          aria-label={`Increase ${label.toLowerCase()}`}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-surface-2 text-white/60 transition-colors hover:border-accent/30 hover:text-accent disabled:cursor-not-allowed disabled:opacity-30"
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  )
}

// Phase 9 — Score Predictor prediction screen rework (state-leak fix +
// UX pass); Phase 14 — full visual redesign on top of the same
// architecture (kept deliberately unchanged, see below). One instance
// per fixture, mounted for the lifetime of the fixture list (never
// conditionally created/destroyed on expand/collapse) — homeScore/
// awayScore/goalscorerId live in THIS component's own local state, not a
// page-level variable shared across every fixture. That's the actual
// fix for the original cross-fixture leak, preserved as-is: Fixture B's
// inputs simply cannot read Fixture A's React state, regardless of
// expand/collapse order.
export default function PredictorFixtureCard({
  fixture,
  leagueId,
  seasonId,
  competitionName,
  isYourPick,
  savedPick,
  expanded,
  onToggleExpand,
  canPick,
  saving,
  onSave,
}) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [homeScore, setHomeScore] = useState(isYourPick && savedPick ? String(savedPick.predicted_home_score) : '')
  const [awayScore, setAwayScore] = useState(isYourPick && savedPick ? String(savedPick.predicted_away_score) : '')
  const [goalscorerId, setGoalscorerId] = useState(isYourPick && savedPick?.goalscorer_player_id ? String(savedPick.goalscorer_player_id) : '')
  const [localError, setLocalError] = useState('')

  // Re-syncs from the real saved data (never from another fixture's
  // state) whenever THIS fixture's own saved pick appears or changes —
  // initial load, or immediately after successfully saving a new score
  // for this exact fixture. Deliberately does nothing when savedPick is
  // absent: collapsing without saving must not wipe an in-progress draft.
  useEffect(() => {
    if (savedPick) {
      setHomeScore(String(savedPick.predicted_home_score))
      setAwayScore(String(savedPick.predicted_away_score))
      setGoalscorerId(savedPick.goalscorer_player_id ? String(savedPick.goalscorer_player_id) : '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedPick?.id, savedPick?.predicted_home_score, savedPick?.predicted_away_score, savedPick?.goalscorer_player_id])

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

  const { data: eligiblePlayers = [] } = usePlayersForFixture(fixture.home_team?.id, fixture.away_team?.id)
  const eligiblePlayersWithTeam = eligiblePlayers.map((p) => {
    const team = p.team_id === fixture.home_team?.id ? fixture.home_team : fixture.away_team
    return { ...p, player_id: p.id, team_name: team?.name, team_short_name: team?.short_name, crest_url: team?.crest_url }
  })
  const goalscorerGroups = useMemo(
    () => groupPlayersByTeamAndPosition(eligiblePlayersWithTeam, fixture.home_team, fixture.away_team),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eligiblePlayers, fixture.id]
  )
  const selectedGoalscorer = eligiblePlayersWithTeam.find((p) => String(p.id) === goalscorerId)

  const isLive = fixture.status === 'live'
  const hasScore = fixture.status === 'live' || fixture.status === 'finished'

  function handleSave() {
    if (homeScore === '' || awayScore === '' || Number(homeScore) < 0 || Number(awayScore) < 0) {
      setLocalError('Enter a predicted score for both teams')
      return
    }
    setLocalError('')
    onSave({
      fixtureId: fixture.id,
      homeScore: Number(homeScore),
      awayScore: Number(awayScore),
      goalscorerId: goalscorerId === '' ? null : Number(goalscorerId),
    })
  }

  return (
    <div
      className={`rounded-2xl border transition-colors ${
        expanded ? 'border-accent/30 bg-accent/5' : isYourPick ? 'border-accent/20 bg-surface-1' : 'border-white/8 bg-surface-1'
      }`}
    >
      <div className="p-4">
        {/* GAMEWEEK / KICKOFF meta row (Part 3) */}
        <div className="flex items-center justify-between gap-2 text-xs text-white/35">
          <span>{competitionName}</span>
          <span className="flex items-center gap-2">
            {difficulty && (
              <span title={DIFFICULTY_TITLE} className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${DIFFICULTY_STYLES[difficulty]}`}>
                {DIFFICULTY_LABEL[difficulty]}
              </span>
            )}
            {isLive ? (
              <span className="flex items-center gap-1 text-red-goal">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-goal" />
                {fixture.minute ? `${fixture.minute}'` : 'Live'}
              </span>
            ) : (
              <span>{hasScore ? 'Full time' : toLocalTimeShort(fixture.kickoff_utc)}</span>
            )}
          </span>
        </div>

        {/* HOME TEAM / SCORE-OR-VS / AWAY TEAM (Parts 3/6/7) — the single
            row that tells the whole collapsed story: teams, whether this
            is the viewer's saved prediction, and what it is. */}
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          aria-label={`${formatTeamName(fixture.home_team)} vs ${formatTeamName(fixture.away_team)}, ${isYourPick && savedPick ? `your prediction ${savedPick.predicted_home_score} to ${savedPick.predicted_away_score}` : 'no prediction yet'}`}
          className="mt-3 flex w-full items-start gap-2 text-left"
        >
          <TeamMeta team={fixture.home_team} standing={homeStanding} form={homeForm} align="center" />

          <div className="mt-6 flex shrink-0 flex-col items-center gap-1">
            {isYourPick && savedPick ? (
              <span className="rounded-lg bg-accent/15 px-3 py-1.5 text-lg font-bold tabular text-accent">
                {savedPick.predicted_home_score}&ndash;{savedPick.predicted_away_score}
              </span>
            ) : (
              <span className="rounded-lg bg-white/5 px-3 py-1.5 text-sm font-medium text-white/30">vs</span>
            )}
          </div>

          <TeamMeta team={fixture.away_team} standing={awayStanding} form={awayForm} align="center" />
        </button>

        {/* STATUS row (Parts 6/7) — the one line that answers "have I
            predicted this?" without expanding anything. */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/6 pt-3">
          <div className="min-w-0">
            {isYourPick && savedPick ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-accent">
                  <Check size={12} /> Your prediction · Saved
                </span>
                {selectedGoalscorer && (
                  <span className="flex items-center gap-1.5 text-xs text-white/45">
                    <Goal size={12} className="text-white/30" />
                    {selectedGoalscorer.display_name}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-xs text-white/40">Not predicted</span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="flex items-center gap-1 text-[11px] text-white/35 transition-colors hover:text-accent"
            >
              <BarChart3 size={11} />
              Match Centre
            </button>
            <button
              type="button"
              onClick={onToggleExpand}
              aria-expanded={expanded}
              className="flex items-center gap-1 text-xs font-semibold text-accent"
            >
              {isYourPick && savedPick ? 'Change' : 'Predict this fixture'}
              <ChevronDown size={13} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* EXPANDED — one coherent workspace: score, then goalscorer, then
          save. No repeated fixture summary, no competing CTAs (Part 8). */}
      {expanded && (
        <div className="space-y-5 border-t border-white/8 bg-black/10 p-4">
          {isYourPick && savedPick ? (
            <p className="text-xs font-medium text-white/40">Editing prediction</p>
          ) : (
            <p className="text-xs font-medium text-white/40">Choose a score to predict this fixture</p>
          )}

          <div className="flex items-center justify-center gap-3">
            <ScoreStepper
              label="Home"
              teamName={formatTeamName(fixture.home_team)}
              value={homeScore}
              onChange={setHomeScore}
              disabled={!canPick}
            />
            <span className="mt-6 text-lg text-white/20">&ndash;</span>
            <ScoreStepper
              label="Away"
              teamName={formatTeamName(fixture.away_team)}
              value={awayScore}
              onChange={setAwayScore}
              disabled={!canPick}
            />
          </div>

          {localError && <p className="text-center text-xs text-red-goal">{localError}</p>}

          <div>
            {/* Backend genuinely treats a goalscorer guess as optional
                (submitting none is fully valid) — deliberately not
                labeled "optional" anywhere here, per the brief. */}
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-white">Goalscorer</p>
              {selectedGoalscorer && (
                <button type="button" onClick={() => setGoalscorerId('')} className="text-xs text-white/40 hover:text-white">
                  Clear
                </button>
              )}
            </div>
            <div className="space-y-5">
              {goalscorerGroups.map(({ side, team, groups }) => (
                <div key={team.id}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-white/30">{side}</p>
                  <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-white">
                    <TeamCrest team={team} size="sm" />
                    {formatTeamName(team)}
                  </div>
                  <div className="space-y-3">
                    {groups.map(({ position, players }) => (
                      <div key={position}>
                        <p className="mb-1.5 text-[11px] text-white/30">{POSITION_LABELS[position] || position}</p>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {players.map((p) => (
                            <PlayerCard
                              key={p.id}
                              player={p}
                              seasonId={seasonId}
                              size="sm"
                              selectedCount={String(p.id) === goalscorerId ? 1 : 0}
                              onSelect={() => setGoalscorerId((current) => (current === String(p.id) ? '' : String(p.id)))}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={handleSave} loading={saving} disabled={saving || !canPick} className="flex-1 sm:flex-none">
              {isYourPick ? 'Save changes' : 'Save prediction'}
            </Button>
            <button type="button" onClick={onToggleExpand} className="text-sm text-white/40 hover:text-white">
              Cancel
            </button>
          </div>
        </div>
      )}

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
    </div>
  )
}
