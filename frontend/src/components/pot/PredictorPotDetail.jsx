import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Target, Lock, Trophy, Star, Settings, Check, Clock } from 'lucide-react'
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
import PredictorFixtureCard from './predictor/PredictorFixtureCard'
import { useGameweeksForPot } from '../../hooks/useAdmin'
import {
  usePredictorEntry,
  useFixturesForGameweek,
  useGetOrCreatePredictorEntry,
  useSubmitPredictorPicks,
  usePredictorGameweekProgress,
} from '../../hooks/usePredictorEntry'
import { useLeaderboard } from '../../hooks/useLeaderboard'
import { usePot } from '../../hooks/usePots'
import { useAuthStore } from '../../store/authStore'
import { isPastDeadline } from '../../utils/time'

// Score Predictor "pot home" — the Predictor sibling of LmsPotDetail.jsx,
// same reasoning for staying its own component rather than a branch inside
// PotDetail.jsx's already Pick5-specific body.
//
// Phase 9 — prediction-screen rework. The real, database-enforced rule
// (predictor_fixture_picks has a UNIQUE(game_entry_id, gameweek_id)
// constraint; business-rules.md § Score Predictor: "chooses exactly one
// fixture") is that an entrant makes ONE prediction per gameweek, not one
// per fixture — confirmed with the user directly after their own first
// draft of this rework's target mockup implied otherwise. "N / M
// predicted" below is therefore pot-wide participation for this gameweek
// (how many of this pot's members have made their one prediction), not a
// per-fixture completion count. The per-fixture score-entry state that
// used to leak between fixtures (see PredictorFixtureCard.jsx's own
// comment for the root cause and fix) now lives entirely in that
// component, one instance per fixture — this file only tracks which
// fixture is currently expanded.
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
  const [expandedFixtureId, setExpandedFixtureId] = useState('')
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (!gameweeks.length || selectedGameweekId) return
    const upcoming = gameweeks.find((gw) => !isPastDeadline(gw.deadline_utc))
    setSelectedGameweekId(String((upcoming ?? gameweeks[gameweeks.length - 1]).id))
  }, [gameweeks, selectedGameweekId])

  // Switching gameweeks always starts collapsed — the collapsed view
  // already shows the saved prediction clearly (Part 3), so there's
  // nothing to gain by force-opening the editor on every navigation.
  useEffect(() => {
    setExpandedFixtureId('')
  }, [selectedGameweekId])

  const { data: fixtures = [], isLoading: fixturesLoading } = useFixturesForGameweek(
    selectedGameweekId ? Number(selectedGameweekId) : null
  )

  const picks = entry?.predictor_fixture_picks ?? []
  const currentPick = picks.find((p) => String(p.gameweek_id) === selectedGameweekId)

  const { data: progress } = usePredictorGameweekProgress(potId, selectedGameweekId ? Number(selectedGameweekId) : null)

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

  async function handleSave({ fixtureId, homeScore, awayScore, goalscorerId }) {
    try {
      setErrorMessage('')
      setMessage('')
      await submitPicks.mutateAsync({
        gameEntryId: entry.id,
        gameweekId: Number(selectedGameweekId),
        fixtureId,
        predictedHomeScore: homeScore,
        predictedAwayScore: awayScore,
        goalscorerPlayerId: goalscorerId,
        potId,
      })
      setMessage('Prediction saved')
      // Collapse back to the compact view so the just-saved score is
      // immediately visible without a second click (Part 10).
      setExpandedFixtureId('')
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
            {/* Prediction status header — Parts 1/5/6/12. Gameweek, pot-wide
                progress, the viewer's own status, and the deadline, all
                answered before the user has to scan a single fixture. */}
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Your prediction</h2>
                <p className="mt-0.5 text-sm text-white/45">
                  {selectedGameweek ? `Gameweek ${selectedGameweek.number}` : 'Select a gameweek'} — make your prediction before the deadline.
                </p>
              </div>

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

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/8 bg-black/10 px-4 py-3 text-sm">
              <div className="flex items-center gap-2">
                {progress ? (
                  <>
                    <span className="font-semibold text-white tabular">{progress.predictedCount} / {progress.totalMembers}</span>
                    <span className="text-white/45">predicted this gameweek</span>
                  </>
                ) : (
                  <span className="text-white/30">Loading progress…</span>
                )}
              </div>

              {selectedGameweek?.deadline_utc && !deadlinePassed ? (
                <div className="flex items-center gap-1.5 text-white/60">
                  <Clock size={13} className="text-white/35" />
                  <span>Predictions close in</span>
                  <CountdownTimer deadlineUtc={selectedGameweek.deadline_utc} showSeconds={false} />
                </div>
              ) : deadlinePassed ? (
                <span className="flex items-center gap-1.5 text-white/40">
                  <Lock size={13} />
                  Predictions closed
                </span>
              ) : null}
            </div>

            <div className="mt-3">
              {currentPick ? (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-accent">
                  <Check size={14} />
                  You&apos;ve predicted this gameweek
                </span>
              ) : deadlinePassed ? (
                <span className="text-sm text-white/45">The deadline passed — no prediction was made.</span>
              ) : (
                <span className="text-sm text-white/45">You haven&apos;t predicted this gameweek yet — choose a fixture below.</span>
              )}
            </div>

            <div className="mt-5">
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
                  {fixtures.map((fixture) => {
                    const isYourPick = !!currentPick && String(currentPick.fixture_id) === String(fixture.id)
                    return (
                      <PredictorFixtureCard
                        key={fixture.id}
                        fixture={fixture}
                        leagueId={pot.league_id}
                        seasonId={pot.season_id}
                        competitionName={pot.leagues?.name}
                        isYourPick={isYourPick}
                        savedPick={isYourPick ? currentPick : null}
                        expanded={String(fixture.id) === expandedFixtureId}
                        onToggleExpand={() =>
                          setExpandedFixtureId((current) => (current === String(fixture.id) ? '' : String(fixture.id)))
                        }
                        canPick={canPick}
                        saving={submitPicks.isPending}
                        onSave={handleSave}
                      />
                    )
                  })}
                </div>
              )}
            </div>
          </Card>
        </section>
      ) : null}

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

      {/* Part 13 — moved below the prediction workflow and standings, so
          invite/membership admin no longer competes visually with "what do
          I need to do right now." Functionality unchanged. */}
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

      {message ? <Toast message={message} type="success" /> : null}
      {errorMessage ? <Toast message={errorMessage} type="error" /> : null}
    </div>
  )
}
