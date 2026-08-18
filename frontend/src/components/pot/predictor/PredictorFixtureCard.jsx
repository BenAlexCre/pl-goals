import { useEffect, useMemo, useState } from 'react'
import { Shield, BarChart3, ChevronDown, Check } from 'lucide-react'
import { useLeagueStandings, useTeamForm, fixtureDifficultyFromStanding } from '../../../hooks/useMatchCentre'
import { usePlayersForFixture } from '../../../hooks/usePredictorEntry'
import TeamForm from '../../matchcentre/TeamForm'
import MatchCentreDrawer from '../../matchcentre/MatchCentreDrawer'
import PlayerCard from '../../matchcentre/PlayerCard'
import Button from '../../ui/Button'
import { toLocalTimeShort } from '../../../utils/time'

const DIFFICULTY_STYLES = {
  easy: 'border-accent/30 bg-accent/10 text-accent',
  balanced: 'border-amber/30 bg-amber/10 text-amber',
  difficult: 'border-red-goal/30 bg-red-goal/10 text-red-goal',
}
const DIFFICULTY_LABEL = { easy: 'Easier fixture', balanced: 'Balanced fixture', difficult: 'Tough fixture' }
const DIFFICULTY_TITLE = 'Fixture difficulty — based on the opponent’s league position, not an official rating'

// Required goalscorer-grouping order (Forwards -> Midfielders -> Defenders
// -> Goalkeepers), mapped onto the real `players.position` vocabulary.
const POSITION_ORDER = ['Offence', 'Midfield', 'Defence', 'Goalkeeper']
const POSITION_LABELS = { Offence: 'Forwards', Midfield: 'Midfielders', Defence: 'Defenders', Goalkeeper: 'Goalkeepers' }

function groupPlayersByTeamAndPosition(players, homeTeam, awayTeam) {
  return [homeTeam, awayTeam]
    .filter(Boolean)
    .map((team) => {
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
      return { team, groups: orderedPositions.map((position) => ({ position, players: byPosition.get(position) })) }
    })
    .filter(({ groups }) => groups.length > 0)
}

function Crest({ url, alt, size = 'md' }) {
  const box = size === 'sm' ? 'h-8 w-8' : 'h-10 w-10'
  const icon = size === 'sm' ? 18 : 22
  return (
    <div className={`flex ${box} shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-3`}>
      {url ? (
        <img src={url} alt="" className="h-3/5 w-3/5 object-contain" loading="lazy" />
      ) : (
        <Shield size={icon} className="text-white/25" aria-label={alt} />
      )}
    </div>
  )
}

// Vertical stack (crest above name), not crest-beside-name — a horizontal
// arrangement permanently spends ~40px of a narrow mobile column on the
// crest alone, which left real team names ("Nottingham", "Brighton")
// truncated to two characters at 375px (confirmed live). Stacking lets the
// name use the column's full width instead of half of it — the same
// pattern already proven for exactly this reason in LmsFixtureSelector.jsx.
function TeamMeta({ team, standing, form }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center">
      <Crest url={team?.crest_url} alt={team?.name} />
      <p className="w-full truncate text-sm font-semibold text-white">{team?.short_name || team?.name || 'TBD'}</p>
      <div className="flex min-w-0 items-center justify-center gap-1.5 overflow-hidden">
        {standing ? (
          <span className="shrink-0 text-[11px] text-white/35">{standing.position}{ordinalSuffix(standing.position)}</span>
        ) : null}
        <TeamForm results={form?.results} size="sm" />
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

// Phase 9 — Score Predictor prediction screen rework (state-leak fix +
// UX pass). One instance per fixture, mounted for the lifetime of the
// fixture list (never conditionally created/destroyed on expand/collapse)
// — homeScore/awayScore/goalscorerId live in THIS component's own local
// state, not a page-level variable shared across every fixture. That's
// the actual fix for the cross-fixture leak: the old implementation held
// a single {homeScore, awayScore, goalscorerId} triple at the page level,
// reused for whichever fixture happened to be expanded, so switching
// fixtures without an intervening reset carried the previous fixture's
// typed values into the new one. Per-instance state makes that
// structurally impossible — Fixture B's inputs simply cannot read
// Fixture A's React state, regardless of expand/collapse order. It also
// gives collapse-then-reopen "for free": since the instance never
// unmounts, an unsaved draft the user was typing is still there when they
// come back to it, exactly like a normal form.
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

  const isLive = fixture.status === 'live'
  const hasScore = fixture.status === 'live' || fixture.status === 'finished'

  function handleSave() {
    if (homeScore === '' || awayScore === '' || Number(homeScore) < 0 || Number(awayScore) < 0) {
      setLocalError('Enter a valid predicted score')
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
      className={`rounded-2xl border p-4 transition-colors ${
        expanded ? 'border-accent/30 bg-accent/5' : isYourPick ? 'border-accent/15 bg-surface-1' : 'border-white/8 bg-surface-1'
      }`}
    >
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

      <button
        type="button"
        onClick={onToggleExpand}
        aria-expanded={expanded}
        aria-label={`${fixture.home_team?.name} vs ${fixture.away_team?.name}, ${isYourPick && savedPick ? `your prediction ${savedPick.predicted_home_score} to ${savedPick.predicted_away_score}` : 'no prediction yet'}`}
        className="mt-3 flex w-full items-center gap-2 text-left"
      >
        <TeamMeta team={fixture.home_team} standing={homeStanding} form={homeForm} />

        <div className="flex shrink-0 flex-col items-center gap-1">
          {isYourPick && savedPick ? (
            <>
              <span className="rounded-lg bg-accent/15 px-2.5 py-1 text-base font-bold tabular text-accent">
                {savedPick.predicted_home_score}&ndash;{savedPick.predicted_away_score}
              </span>
              <span className="flex items-center gap-1 text-[10px] font-semibold text-accent">
                <Check size={10} />
                <span className="hidden sm:inline">Your prediction</span>
              </span>
            </>
          ) : (
            <>
              <span className="text-sm font-medium text-white/25">vs</span>
              <span className="text-[10px] font-medium text-white/30">Predict</span>
            </>
          )}
        </div>

        <TeamMeta team={fixture.away_team} standing={awayStanding} form={awayForm} />

        <ChevronDown size={16} className={`shrink-0 text-white/30 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        className="mt-2 flex items-center gap-1 text-[11px] text-white/35 transition-colors hover:text-accent"
      >
        <BarChart3 size={11} />
        Match Centre
      </button>

      {expanded && (
        <div className="mt-4 space-y-4 border-t border-white/8 pt-4">
          <div className="flex items-center justify-center gap-3">
            <div className="flex flex-1 flex-col items-center gap-1.5">
              <Crest url={fixture.home_team?.crest_url} alt={fixture.home_team?.name} />
              <p className="truncate text-xs font-medium text-white/70">{fixture.home_team?.short_name || fixture.home_team?.name}</p>
            </div>

            <input
              type="number"
              inputMode="numeric"
              min="0"
              max="20"
              step="1"
              value={homeScore}
              onChange={(e) => setHomeScore(e.target.value)}
              disabled={!canPick}
              aria-label={`Predicted score for ${fixture.home_team?.name}`}
              className="w-16 rounded-xl border border-white/10 bg-surface-2 px-2 py-2.5 text-center text-xl font-bold text-white outline-none focus:border-accent/50 disabled:opacity-50"
            />
            <span className="text-white/25">&ndash;</span>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              max="20"
              step="1"
              value={awayScore}
              onChange={(e) => setAwayScore(e.target.value)}
              disabled={!canPick}
              aria-label={`Predicted score for ${fixture.away_team?.name}`}
              className="w-16 rounded-xl border border-white/10 bg-surface-2 px-2 py-2.5 text-center text-xl font-bold text-white outline-none focus:border-accent/50 disabled:opacity-50"
            />

            <div className="flex flex-1 flex-col items-center gap-1.5">
              <Crest url={fixture.away_team?.crest_url} alt={fixture.away_team?.name} />
              <p className="truncate text-xs font-medium text-white/70">{fixture.away_team?.short_name || fixture.away_team?.name}</p>
            </div>
          </div>

          {localError && <p className="text-center text-xs text-red-goal">{localError}</p>}

          <div>
            {/* Backend genuinely treats a goalscorer guess as optional
                (submitting none is fully valid) — deliberately not
                labeled "optional" anywhere here, per the brief. */}
            <p className="mb-2 text-sm text-white/70">Goalscorer</p>
            <div className="space-y-4">
              {goalscorerGroups.map(({ team, groups }) => (
                <div key={team.id}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/35">{team.short_name || team.name}</p>
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

          <Button onClick={handleSave} loading={saving} disabled={saving || !canPick} className="w-full sm:w-auto">
            {isYourPick ? 'Update prediction' : 'Save prediction'}
          </Button>
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
