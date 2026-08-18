import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Target, Lock, Trophy, Star, ChevronDown, Settings } from 'lucide-react'
import Card from '../ui/Card'
import Button from '../ui/Button'
import Badge from '../ui/Badge'
import Spinner from '../ui/Spinner'
import EmptyState from '../ui/EmptyState'
import CountdownTimer from '../ui/CountdownTimer'
import Toast from '../ui/Toast'
import LeaderboardTable from '../leaderboard/LeaderboardTable'
import InviteCard from './InviteCard'
import MemberList from './MemberList'
import FixtureCard from '../matchcentre/FixtureCard'
import PlayerCard from '../matchcentre/PlayerCard'
import { useGameweeksForPot } from '../../hooks/useAdmin'
import {
  usePredictorEntry,
  useFixturesForGameweek,
  usePlayersForFixture,
  useGetOrCreatePredictorEntry,
  useSubmitPredictorPicks,
} from '../../hooks/usePredictorEntry'
import { useLeaderboard } from '../../hooks/useLeaderboard'
import { usePot } from '../../hooks/usePots'
import { useAuthStore } from '../../store/authStore'
import { isPastDeadline } from '../../utils/time'

// Required goalscorer-grouping order (Forwards -> Midfielders -> Defenders
// -> Goalkeepers), mapped onto the real `players.position` vocabulary
// (confirmed live: Goalkeeper/Defence/Midfield/Offence, plus one stray
// Coach row that isn't a playing position — never filtered out here, just
// sorted after the four real positions so nothing eligible disappears).
const POSITION_ORDER = ['Offence', 'Midfield', 'Defence', 'Goalkeeper']
const POSITION_LABELS = { Offence: 'Forwards', Midfield: 'Midfielders', Defence: 'Defenders', Goalkeeper: 'Goalkeepers' }

// Phase 9C — Part 19: goalscorer candidates grouped by team, then by
// position within each team, instead of one flat alphabetical-ish grid.
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

// Score Predictor "pot home" — the Predictor sibling of LmsPotDetail.jsx,
// same reasoning for staying its own component rather than a branch inside
// PotDetail.jsx's already Pick5-specific body.
export default function PredictorPotDetail({ pot, potId }) {
  const { user } = useAuthStore()
  const { data: gameweeks = [], isLoading: gameweeksLoading } = useGameweeksForPot(pot.season_id, pot.league_id)
  const { data: entry, isLoading: entryLoading } = usePredictorEntry(potId)
  const { data: standings = [] } = useLeaderboard(potId, null)
  const { data: potWithMembers } = usePot(potId)
  const members = potWithMembers?.pot_members ?? []
  const isPotAdmin = members.some((m) => m.user_id === user?.id && m.role === 'admin')

  const getOrCreateEntry = useGetOrCreatePredictorEntry()
  const submitPicks = useSubmitPredictorPicks()

  const [selectedGameweekId, setSelectedGameweekId] = useState('')
  const [selectedFixtureId, setSelectedFixtureId] = useState('')
  const [homeScore, setHomeScore] = useState('')
  const [awayScore, setAwayScore] = useState('')
  const [goalscorerId, setGoalscorerId] = useState('')
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (!gameweeks.length || selectedGameweekId) return
    const upcoming = gameweeks.find((gw) => !isPastDeadline(gw.deadline_utc))
    setSelectedGameweekId(String((upcoming ?? gameweeks[gameweeks.length - 1]).id))
  }, [gameweeks, selectedGameweekId])

  const { data: fixtures = [], isLoading: fixturesLoading } = useFixturesForGameweek(
    selectedGameweekId ? Number(selectedGameweekId) : null
  )

  const picks = entry?.predictor_fixture_picks ?? []
  const currentPick = picks.find((p) => String(p.gameweek_id) === selectedGameweekId)

  // Pre-fill the picker from an existing pick for this gameweek so "edit
  // before deadline" starts from what's already saved, not blank inputs.
  useEffect(() => {
    if (currentPick) {
      setSelectedFixtureId(String(currentPick.fixture_id))
      setHomeScore(String(currentPick.predicted_home_score))
      setAwayScore(String(currentPick.predicted_away_score))
      setGoalscorerId(currentPick.goalscorer_player_id ? String(currentPick.goalscorer_player_id) : '')
    } else {
      setSelectedFixtureId('')
      setHomeScore('')
      setAwayScore('')
      setGoalscorerId('')
    }
  }, [currentPick?.id, selectedGameweekId])

  const selectedFixture = fixtures.find((f) => String(f.id) === selectedFixtureId)
  const { data: eligiblePlayers = [] } = usePlayersForFixture(
    selectedFixture?.home_team?.id,
    selectedFixture?.away_team?.id
  )
  // usePlayersForFixture() returns bare {id, display_name, photo_url,
  // position, team_id} — no club name/crest, since its original consumer
  // (the plain <select> this replaces) never needed one. PlayerCard wants
  // team_name/team_short_name/crest_url/player_id, filled in here from
  // the already-loaded selectedFixture, not a second query.
  const eligiblePlayersWithTeam = eligiblePlayers.map((p) => {
    const team = p.team_id === selectedFixture?.home_team?.id ? selectedFixture?.home_team : selectedFixture?.away_team
    return { ...p, player_id: p.id, team_name: team?.name, team_short_name: team?.short_name, crest_url: team?.crest_url }
  })
  const goalscorerGroups = useMemo(
    () => groupPlayersByTeamAndPosition(eligiblePlayersWithTeam, selectedFixture?.home_team, selectedFixture?.away_team),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eligiblePlayers, selectedFixture?.id]
  )

  if (gameweeksLoading || entryLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    )
  }

  const selectedGameweek = gameweeks.find((gw) => String(gw.id) === selectedGameweekId)
  const deadlinePassed = selectedGameweek ? isPastDeadline(selectedGameweek.deadline_utc) : false
  const canPick = entry && entry.status === 'pending' && !deadlinePassed
  const totalPoints = entry?.game_entry_predictor?.total_points ?? 0

  async function handleJoin() {
    try {
      setErrorMessage('')
      setMessage('')
      await getOrCreateEntry.mutateAsync(potId)
      setMessage('You’re in — predict a fixture before the next deadline.')
    } catch (err) {
      setErrorMessage(err.message || 'Failed to join')
    }
  }

  async function handleSubmit() {
    if (!selectedFixtureId) {
      setErrorMessage('Select a fixture')
      return
    }
    if (homeScore === '' || awayScore === '' || Number(homeScore) < 0 || Number(awayScore) < 0) {
      setErrorMessage('Enter a valid predicted score')
      return
    }
    try {
      setErrorMessage('')
      setMessage('')
      await submitPicks.mutateAsync({
        gameEntryId: entry.id,
        gameweekId: Number(selectedGameweekId),
        fixtureId: Number(selectedFixtureId),
        predictedHomeScore: Number(homeScore),
        predictedAwayScore: Number(awayScore),
        goalscorerPlayerId: goalscorerId === '' ? null : Number(goalscorerId),
        potId,
      })
      setMessage('Prediction saved')
    } catch (err) {
      setErrorMessage(err.message || 'Failed to save prediction')
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-white/6 bg-gradient-to-br from-surface-1 to-surface-3 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Badge status="member">Score Predictor</Badge>
              <Badge status={pot.status}>{pot.status}</Badge>
            </div>
            <h1 className="flex items-center gap-2 text-3xl font-bold text-white">
              <Target size={26} />
              {pot.name}
            </h1>
            <p className="mt-1 text-sm text-white/45">
              {pot.leagues?.name} · {pot.seasons?.name}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {entry ? (
              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-surface-2 px-4 py-2">
                <Star size={14} className="text-accent" />
                <span className="text-sm font-semibold text-white tabular">{totalPoints} pts</span>
              </div>
            ) : null}
            {/* Phase 9E, Part 11 — same contextual /admin/payments link as
                LmsPotDetail.jsx, shown only to this pot's own admin. */}
            {isPotAdmin ? (
              <Link
                to="/admin/payments"
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/60 transition-colors hover:text-white"
              >
                <Settings size={13} />
                Manage
              </Link>
            ) : null}
          </div>
        </div>

        {!entry ? (
          <div className="mt-6">
            <Button onClick={handleJoin} loading={getOrCreateEntry.isPending} disabled={getOrCreateEntry.isPending}>
              Join competition
            </Button>
          </div>
        ) : null}
      </section>

      {entry ? (
        <section>
          <Card className="p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-white">Your prediction</h2>

              {gameweeks.length > 0 ? (
                <select
                  value={selectedGameweekId}
                  onChange={(e) => setSelectedGameweekId(e.target.value)}
                  className="rounded-xl border border-white/10 bg-surface-2 px-3 py-2 text-sm text-white outline-none"
                >
                  {gameweeks.map((gw) => (
                    <option key={gw.id} value={gw.id}>
                      GW{gw.number} — {gw.name}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>

            {selectedGameweek?.deadline_utc && !deadlinePassed ? (
              <div className="mb-4">
                <CountdownTimer deadlineUtc={selectedGameweek.deadline_utc} />
              </div>
            ) : null}

            {deadlinePassed || currentPick?.locked_at ? (
              <div className="rounded-xl border border-white/10 bg-surface-2/50 p-4">
                <div className="mb-1 flex items-center gap-2 text-sm text-white/60">
                  <Lock size={14} />
                  Locked prediction
                </div>
                {currentPick ? (
                  <>
                    <p className="text-white font-medium">
                      {currentPick.fixtures?.home_team?.name} {currentPick.predicted_home_score} - {currentPick.predicted_away_score} {currentPick.fixtures?.away_team?.name}
                    </p>
                    {currentPick.points_awarded !== null ? (
                      <p className="mt-1 text-xs text-white/45">{currentPick.points_awarded} points awarded</p>
                    ) : (
                      <p className="mt-1 text-xs text-white/45">Not yet scored</p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-white/45">No prediction was made for this gameweek.</p>
                )}
              </div>
            ) : fixturesLoading ? (
              <div className="flex justify-center py-6">
                <Spinner />
              </div>
            ) : fixtures.length === 0 ? (
              <EmptyState icon={Target} title="No fixtures" description="This gameweek has no fixtures yet." />
            ) : (
              <div className="space-y-3">
                {/* Phase 8B — fixture-first redesign. One fixture predicted
                    per gameweek (unchanged rule) — each row shows the
                    shared FixtureCard (crests/form/position/difficulty,
                    click -> Match Centre) plus a "Predict" toggle;
                    selecting a different fixture replaces the prior
                    selection, same single-value selectedFixtureId as
                    before, just chosen by tapping a card instead of a
                    <select>. */}
                {fixtures.map((fixture) => {
                  const isSelected = String(fixture.id) === selectedFixtureId
                  const isCurrentPickFixture = currentPick && String(currentPick.fixture_id) === String(fixture.id)
                  return (
                    <div key={fixture.id} className="space-y-2">
                      <FixtureCard
                        fixture={fixture}
                        leagueId={pot.league_id}
                        seasonId={pot.season_id}
                        competitionName={pot.leagues?.name}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedFixtureId(isSelected ? '' : String(fixture.id))
                          setGoalscorerId('')
                        }}
                        aria-expanded={isSelected}
                        className={`flex w-full items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                          isSelected ? 'border-accent/40 bg-accent/10 text-accent' : 'border-white/10 bg-surface-2 text-white/60 hover:text-white'
                        }`}
                      >
                        {isSelected ? (
                          <>
                            Predicting this fixture
                            <ChevronDown size={14} className="rotate-180 transition-transform" />
                          </>
                        ) : isCurrentPickFixture ? (
                          <span className="flex flex-1 flex-col items-center gap-0.5 py-0.5">
                            <span className="font-semibold">
                              {fixture.home_team?.short_name || fixture.home_team?.name} {currentPick.predicted_home_score}&ndash;{currentPick.predicted_away_score} {fixture.away_team?.short_name || fixture.away_team?.name}
                            </span>
                            <span className="text-xs font-normal text-white/45">
                              {currentPick.goalscorer?.display_name ? `Goalscorer: ${currentPick.goalscorer.display_name}` : 'No goalscorer selected'}
                            </span>
                          </span>
                        ) : (
                          <>
                            Predict this fixture
                            <ChevronDown size={14} className="transition-transform" />
                          </>
                        )}
                      </button>

                      {isSelected && selectedFixture ? (
                        <div className="space-y-4 rounded-2xl border border-accent/20 bg-accent/5 p-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="mb-2 block text-sm text-white/70">{selectedFixture.home_team?.name}</label>
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={homeScore}
                                onChange={(e) => setHomeScore(e.target.value)}
                                className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-center text-2xl font-bold text-white outline-none focus:border-accent/50"
                              />
                            </div>
                            <div>
                              <label className="mb-2 block text-sm text-white/70">{selectedFixture.away_team?.name}</label>
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={awayScore}
                                onChange={(e) => setAwayScore(e.target.value)}
                                className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-center text-2xl font-bold text-white outline-none focus:border-accent/50"
                              />
                            </div>
                          </div>

                          <div>
                            {/* Backend genuinely treats a goalscorer guess
                                as optional (submitting none is fully
                                valid) — deliberately not labeled
                                "optional" anywhere here, per the brief. */}
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
                                              seasonId={pot.season_id}
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

                          <Button onClick={handleSubmit} loading={submitPicks.isPending} disabled={submitPicks.isPending || !canPick} className="w-full sm:w-auto">
                            {currentPick ? 'Update prediction' : 'Save prediction'}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        </section>
      ) : null}

      <section className="space-y-6">
        {isPotAdmin ? (
          <InviteCard
            potId={potId}
            inviteCode={potWithMembers?.invite_code}
            existingMemberIds={new Set(members.map((m) => m.user_id))}
          />
        ) : null}
        <MemberList potId={potId} members={members} isAdmin={isPotAdmin} />
      </section>

      {/* Deliberately labeled "Live fixtures", not "& standings" — see
          LmsPotDetail.jsx's identical note: PredictorEngine.generateStandings()
          only ever writes the overall (gameweek_id IS NULL) row, already
          shown above, so GameweekPage's own gameweek-scoped Standings
          section would just be empty for this mode. */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Standings</h2>
          {selectedGameweekId ? (
            <Link
              to={`/pot/${potId}/gameweek/${selectedGameweekId}`}
              className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
            >
              <Trophy size={14} />
              Live fixtures
            </Link>
          ) : null}
        </div>
        <LeaderboardTable rows={standings} gameType="score_predictor" />
      </section>

      {message ? <Toast message={message} type="success" /> : null}
      {errorMessage ? <Toast message={errorMessage} type="error" /> : null}
    </div>
  )
}
