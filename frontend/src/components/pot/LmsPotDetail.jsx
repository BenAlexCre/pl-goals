import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Shield, Lock, Trophy, Settings, Users, AlertTriangle } from 'lucide-react'
import Card from '../ui/Card'
import Button from '../ui/Button'
import Badge from '../ui/Badge'
import Spinner from '../ui/Spinner'
import EmptyState from '../ui/EmptyState'
import CountdownTimer from '../ui/CountdownTimer'
import Toast from '../ui/Toast'
import LeaderboardTable from '../leaderboard/LeaderboardTable'
import LmsFixtureSelector from './lms/LmsFixtureSelector'
import { useGameweeksForPot } from '../../hooks/useAdmin'
import { useLmsEntry, useGetOrCreateLmsEntry, useSubmitLmsPick, useLmsCompetitionPicks } from '../../hooks/useLmsEntry'
import { useFixturesForGameweek } from '../../hooks/usePredictorEntry'
import { useLeaderboard } from '../../hooks/useLeaderboard'
import { usePot } from '../../hooks/usePots'
import { useAuthStore } from '../../store/authStore'
import { isPastDeadline } from '../../utils/time'
import { formatSeasonName } from '../../utils/format'

// Last Man Standing "pot home" — the LMS sibling of PotDetail.jsx's Pick 5
// body, kept as its own component rather than crammed into that file's
// already-large Pick5-specific state machine (MAX_PICKS, pick5_picks, the
// player-filter grid — none of it applies here). Mirrors the backend's own
// per-mode separation (GE-18: modes never share implementation) at the
// frontend layer too.
export default function LmsPotDetail({ pot, potId }) {
  const { user } = useAuthStore()
  const { data: gameweeks = [], isLoading: gameweeksLoading } = useGameweeksForPot(pot.season_id, pot.league_id)
  const { data: entry, isLoading: entryLoading } = useLmsEntry(potId)
  const { data: standings = [] } = useLeaderboard(potId, null)
  const { data: potWithMembers } = usePot(potId)
  const members = potWithMembers?.pot_members ?? []
  const isPotAdmin = members.some((m) => m.user_id === user?.id && m.role === 'admin')

  const getOrCreateEntry = useGetOrCreateLmsEntry()
  const submitPick = useSubmitLmsPick()

  const [selectedGameweekId, setSelectedGameweekId] = useState('')
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  // Default to the first not-yet-locked gameweek, falling back to the most
  // recent one if the whole season has passed — never the global "current
  // gameweek" concept (that's pot-independent and would be wrong for any
  // pot not on whichever league/season happens to be marked current).
  useEffect(() => {
    if (!gameweeks.length || selectedGameweekId) return
    const upcoming = gameweeks.find((gw) => !isPastDeadline(gw.deadline_utc))
    setSelectedGameweekId(String((upcoming ?? gameweeks[gameweeks.length - 1]).id))
  }, [gameweeks, selectedGameweekId])

  // Phase 8B — fixture-first redesign. Was useTeamsForGameweek() (a flat,
  // deduped team list with the fixture pairing thrown away); now the
  // actual fixture pairs, reused as-is from Score Predictor's own hook —
  // a plain "fixtures for this gameweek" query has no LMS-specific
  // business logic in it, so there's nothing mode-specific to duplicate.
  const { data: fixtures = [], isLoading: fixturesLoading } = useFixturesForGameweek(
    selectedGameweekId ? Number(selectedGameweekId) : null
  )

  // Phase 10B, Part 3/4/10 — every entrant's pick history for this pot, used
  // both for the compact alive/eliminated member summary below and for the
  // leaderboard's own expandable "who picked what" rows.
  const { data: competitionPicks = [] } = useLmsCompetitionPicks(
    potId,
    selectedGameweekId ? Number(selectedGameweekId) : null
  )
  const lmsPickData = useMemo(
    () => new Map(competitionPicks.map((row) => [row.userId, row])),
    [competitionPicks]
  )
  const aliveCount = competitionPicks.filter((row) => row.competitiveStatus !== 'eliminated').length
  const eliminatedCount = competitionPicks.length - aliveCount

  if (gameweeksLoading || entryLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    )
  }

  const selectedGameweek = gameweeks.find((gw) => String(gw.id) === selectedGameweekId)
  const deadlinePassed = selectedGameweek ? isPastDeadline(selectedGameweek.deadline_utc) : false
  const picks = entry?.lms_team_picks ?? []
  const currentPick = picks.find((p) => String(p.gameweek_id) === selectedGameweekId)
  const usedTeamIds = new Set(picks.filter((p) => String(p.gameweek_id) !== selectedGameweekId).map((p) => p.team_id))
  const eliminated = entry?.game_entry_lms?.competitive_status === 'eliminated'
  const eliminatedGameweekId = entry?.game_entry_lms?.eliminated_gameweek_id
  const canPick = entry && !eliminated && entry.status === 'pending' && !deadlinePassed

  // Phase 10B, Part 14 — a rollover pot (Roll Prize wipeout) is created with
  // no start_gameweek_id, left for the organiser to set via Rollover
  // Management (decisions.md's own documented design). A fresh, non-rollover
  // LMS pot can't reach this state — PotManager.jsx's create form already
  // requires a start gameweek — so this only ever fires for that one real
  // path, instead of ever letting a player reach get-or-create-lms-entry's
  // cryptic "no start gameweek configured" 403.
  const needsSetup = potWithMembers ? !potWithMembers.start_gameweek_id : false

  async function handleJoin() {
    try {
      setErrorMessage('')
      setMessage('')
      await getOrCreateEntry.mutateAsync(potId)
      setMessage('You’re in — pick a team before the next deadline.')
    } catch (err) {
      setErrorMessage(err.message || 'Failed to join')
    }
  }

  async function handleSubmitPick() {
    if (!selectedTeamId) {
      setErrorMessage('Select a team')
      return
    }
    try {
      setErrorMessage('')
      setMessage('')
      await submitPick.mutateAsync({
        gameEntryId: entry.id,
        gameweekId: Number(selectedGameweekId),
        teamId: Number(selectedTeamId),
        potId,
      })
      setMessage('Pick saved')
      setSelectedTeamId('')
    } catch (err) {
      setErrorMessage(err.message || 'Failed to save pick')
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-white/6 bg-gradient-to-br from-surface-1 to-surface-3 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Badge status="member">Last Man Standing</Badge>
              <Badge status={pot.status}>{pot.status}</Badge>
              {entry ? <Badge status={eliminated ? 'eliminated' : 'alive'} /> : null}
            </div>
            <h1 className="flex items-center gap-2 text-3xl font-bold text-white">
              <Shield size={26} />
              {pot.name}
            </h1>
            <p className="mt-1 text-sm text-white/45">
              {pot.leagues?.name} · {formatSeasonName(pot.seasons)}
            </p>
            <p className="mt-2 max-w-xl text-sm text-white/50">
              Pick one team to win its fixture each gameweek — a loss or draw eliminates you, and no team can ever be picked twice.
            </p>
          </div>

          {/* Phase 10B, Part 2 — retargeted from /admin/payments to this
              pot's own membership-management page, same as PotDetail.jsx
              (Pick 5)/PredictorPotDetail.jsx. */}
          {isPotAdmin ? (
            <Link
              to={`/pot/${potId}/manage`}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/60 transition-colors hover:text-white"
            >
              <Settings size={13} />
              Manage
            </Link>
          ) : null}
        </div>

        {!needsSetup && !entry ? (
          <div className="mt-6">
            <Button onClick={handleJoin} loading={getOrCreateEntry.isPending} disabled={getOrCreateEntry.isPending}>
              {/* Phase 10B, Part 11 — every pot member (including its own
                  admin) still needs their own entry to actually play; the
                  copy just stops implying an admin needs to "join" their
                  own competition. Same getOrCreateEntry call either way. */}
              {isPotAdmin ? 'Start playing' : 'Join competition'}
            </Button>
          </div>
        ) : !needsSetup && eliminated ? (
          <p className="mt-4 text-sm text-white/60">
            Eliminated {eliminatedGameweekId ? `in GW${gameweeks.find((gw) => gw.id === eliminatedGameweekId)?.number ?? eliminatedGameweekId}` : ''} — thanks for playing this competition.
          </p>
        ) : null}

        {/* Phase 10B, Part 2 — compact member summary, replacing the large
            inline InviteCard/MemberList block. Full membership management
            now lives on the Manage page linked above. */}
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-white/6 pt-4 text-sm">
          <span className="inline-flex items-center gap-1.5 text-white/60">
            <Users size={14} className="text-white/35" />
            {members.length} member{members.length === 1 ? '' : 's'}
          </span>
          {competitionPicks.length > 0 ? (
            <>
              <span className="text-white/15">•</span>
              <span className="text-accent">{aliveCount} alive</span>
              {eliminatedCount > 0 ? <span className="text-white/40">{eliminatedCount} eliminated</span> : null}
            </>
          ) : null}
          {isPotAdmin ? (
            <Link to={`/pot/${potId}/manage`} className="ml-auto text-accent hover:underline">
              Manage members
            </Link>
          ) : null}
        </div>
      </section>

      {needsSetup ? (
        <Card className="p-6">
          <EmptyState
            icon={AlertTriangle}
            title="This competition still needs a start gameweek"
            description={
              isPotAdmin
                ? 'This is a rollover pot — set its starting gameweek in Rollover Management before players can join or pick.'
                : "The organiser hasn't finished setting up this competition yet. Check back soon."
            }
            action={
              isPotAdmin ? (
                <Link
                  to="/admin/rollovers"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-accent/30 bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/15"
                >
                  Open Rollover Management
                </Link>
              ) : null
            }
          />
        </Card>
      ) : (
        <>
          {entry && !eliminated ? (
            <section>
              <Card className="p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold text-white">Your pick</h2>

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
                  <div className="mb-4 flex items-center gap-2 text-sm text-white/50">
                    <span>Deadline:</span>
                    <CountdownTimer deadlineUtc={selectedGameweek.deadline_utc} showSeconds={false} />
                  </div>
                ) : null}

                {deadlinePassed || currentPick?.locked_at ? (
                  <div className="rounded-xl border border-white/10 bg-surface-2/50 p-4">
                    <div className="mb-1 flex items-center gap-2 text-sm text-white/60">
                      <Lock size={14} />
                      Picks are locked for this gameweek
                    </div>
                    {currentPick ? (
                      <p className="text-white font-medium">{currentPick.teams?.name}</p>
                    ) : (
                      <p className="text-sm text-white/45">No pick was made for this gameweek.</p>
                    )}
                  </div>
                ) : fixturesLoading ? (
                  <div className="flex justify-center py-6">
                    <Spinner />
                  </div>
                ) : fixtures.length === 0 ? (
                  <EmptyState icon={Shield} title="No fixtures" description="This gameweek has no fixtures yet." />
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm text-white/45">
                      {currentPick ? 'Tap a different team to change your pick before the deadline.' : 'Choose the team you think will win.'}
                    </p>
                    <div className="space-y-3">
                      {fixtures.map((fixture) => {
                        const homeDisabled = usedTeamIds.has(fixture.home_team?.id)
                        const awayDisabled = usedTeamIds.has(fixture.away_team?.id)
                        const homeSelected = String(selectedTeamId) === String(fixture.home_team?.id) || (!selectedTeamId && currentPick?.team_id === fixture.home_team?.id)
                        const awaySelected = String(selectedTeamId) === String(fixture.away_team?.id) || (!selectedTeamId && currentPick?.team_id === fixture.away_team?.id)
                        const homeIsSaved = !selectedTeamId && currentPick?.team_id === fixture.home_team?.id
                        const awayIsSaved = !selectedTeamId && currentPick?.team_id === fixture.away_team?.id
                        return (
                          <LmsFixtureSelector
                            key={fixture.id}
                            fixture={fixture}
                            leagueId={pot.league_id}
                            seasonId={pot.season_id}
                            competitionName={pot.leagues?.name}
                            homeSelected={homeSelected}
                            awaySelected={awaySelected}
                            homeIsSaved={homeIsSaved}
                            awayIsSaved={awayIsSaved}
                            homeDisabled={homeDisabled}
                            awayDisabled={awayDisabled}
                            disabledReason="Already used this competition"
                            onSelectHome={() => setSelectedTeamId(String(fixture.home_team.id))}
                            onSelectAway={() => setSelectedTeamId(String(fixture.away_team.id))}
                          />
                        )
                      })}
                    </div>
                    <Button onClick={handleSubmitPick} loading={submitPick.isPending} disabled={submitPick.isPending || !canPick}>
                      {currentPick ? 'Update pick' : 'Save pick'}
                    </Button>
                  </div>
                )}
              </Card>
            </section>
          ) : null}

          {/* Deliberately labeled "Live fixtures", not "& standings" — GameweekPage's
              own Standings section queries pot_standings_snapshots scoped to this
              specific gameweek_id, but LmsEngine.generateStandings() only ever
              writes the overall (gameweek_id IS NULL) row — the real standings
              are already shown right above, via the same overall query. */}
          <section>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">Standings</h2>
                <p className="mt-0.5 text-sm text-white/40">Tap a member to see their pick history.</p>
              </div>
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
            <LeaderboardTable rows={standings} gameType="last_man_standing" lmsPickData={lmsPickData} gameweeks={gameweeks} />
          </section>
        </>
      )}

      {message ? <Toast message={message} type="success" /> : null}
      {errorMessage ? <Toast message={errorMessage} type="error" /> : null}
    </div>
  )
}
