import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Target, Lock, Trophy, Star } from 'lucide-react'
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

          {entry ? (
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-surface-2 px-4 py-2">
              <Star size={14} className="text-accent" />
              <span className="text-sm font-semibold text-white tabular">{totalPoints} pts</span>
            </div>
          ) : null}
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
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm text-white/70" htmlFor="predictor-fixture">Fixture</label>
                  <select
                    id="predictor-fixture"
                    value={selectedFixtureId}
                    onChange={(e) => {
                      setSelectedFixtureId(e.target.value)
                      setGoalscorerId('')
                    }}
                    className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none"
                  >
                    <option value="">Select a fixture</option>
                    {fixtures.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.home_team?.name} vs {f.away_team?.name}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedFixture ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-2 block text-sm text-white/70">{selectedFixture.home_team?.name}</label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={homeScore}
                        onChange={(e) => setHomeScore(e.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none"
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
                        className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none"
                      />
                    </div>
                  </div>
                ) : null}

                {selectedFixture ? (
                  <div>
                    <label className="mb-2 block text-sm text-white/70" htmlFor="predictor-scorer">
                      Goalscorer (optional)
                    </label>
                    <select
                      id="predictor-scorer"
                      value={goalscorerId}
                      onChange={(e) => setGoalscorerId(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none"
                    >
                      <option value="">No prediction</option>
                      {eligiblePlayers.map((p) => (
                        <option key={p.id} value={p.id}>{p.display_name}</option>
                      ))}
                    </select>
                  </div>
                ) : null}

                <Button onClick={handleSubmit} loading={submitPicks.isPending} disabled={submitPicks.isPending || !canPick}>
                  {currentPick ? 'Update prediction' : 'Save prediction'}
                </Button>
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
