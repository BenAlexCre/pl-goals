import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Shield, Lock, History, Trophy } from 'lucide-react'
import Card from '../ui/Card'
import Button from '../ui/Button'
import Badge from '../ui/Badge'
import Spinner from '../ui/Spinner'
import EmptyState from '../ui/EmptyState'
import CountdownTimer from '../ui/CountdownTimer'
import Toast from '../ui/Toast'
import LeaderboardTable from '../leaderboard/LeaderboardTable'
import { useGameweeksForPot } from '../../hooks/useAdmin'
import { useLmsEntry, useTeamsForGameweek, useGetOrCreateLmsEntry, useSubmitLmsPick } from '../../hooks/useLmsEntry'
import { useLeaderboard } from '../../hooks/useLeaderboard'
import { isPastDeadline } from '../../utils/time'

// Last Man Standing "pot home" — the LMS sibling of PotDetail.jsx's Pick 5
// body, kept as its own component rather than crammed into that file's
// already-large Pick5-specific state machine (MAX_PICKS, pick5_picks, the
// player-filter grid — none of it applies here). Mirrors the backend's own
// per-mode separation (GE-18: modes never share implementation) at the
// frontend layer too.
export default function LmsPotDetail({ pot, potId }) {
  const { data: gameweeks = [], isLoading: gameweeksLoading } = useGameweeksForPot(pot.season_id, pot.league_id)
  const { data: entry, isLoading: entryLoading } = useLmsEntry(potId)
  const { data: standings = [] } = useLeaderboard(potId, null)

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

  const { data: teams = [], isLoading: teamsLoading } = useTeamsForGameweek(
    selectedGameweekId ? Number(selectedGameweekId) : null
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
  const picks = entry?.lms_team_picks ?? []
  const currentPick = picks.find((p) => String(p.gameweek_id) === selectedGameweekId)
  const usedTeamIds = new Set(picks.filter((p) => String(p.gameweek_id) !== selectedGameweekId).map((p) => p.team_id))
  const eliminated = entry?.game_entry_lms?.competitive_status === 'eliminated'
  const eliminatedGameweekId = entry?.game_entry_lms?.eliminated_gameweek_id
  const canPick = entry && !eliminated && entry.status === 'pending' && !deadlinePassed

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
            </div>
            <h1 className="flex items-center gap-2 text-3xl font-bold text-white">
              <Shield size={26} />
              {pot.name}
            </h1>
            <p className="mt-1 text-sm text-white/45">
              {pot.leagues?.name} · {pot.seasons?.name}
            </p>
          </div>

          {entry ? (
            <Badge status={eliminated ? 'eliminated' : 'alive'} />
          ) : null}
        </div>

        {!entry ? (
          <div className="mt-6">
            <Button onClick={handleJoin} loading={getOrCreateEntry.isPending} disabled={getOrCreateEntry.isPending}>
              Join competition
            </Button>
          </div>
        ) : eliminated ? (
          <p className="mt-4 text-sm text-white/60">
            Eliminated {eliminatedGameweekId ? `in GW${gameweeks.find((gw) => gw.id === eliminatedGameweekId)?.number ?? eliminatedGameweekId}` : ''} — thanks for playing this competition.
          </p>
        ) : null}
      </section>

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
              <div className="mb-4">
                <CountdownTimer deadlineUtc={selectedGameweek.deadline_utc} />
              </div>
            ) : null}

            {deadlinePassed || currentPick?.locked_at ? (
              <div className="rounded-xl border border-white/10 bg-surface-2/50 p-4">
                <div className="mb-1 flex items-center gap-2 text-sm text-white/60">
                  <Lock size={14} />
                  Locked pick
                </div>
                {currentPick ? (
                  <p className="text-white font-medium">{currentPick.teams?.name}</p>
                ) : (
                  <p className="text-sm text-white/45">No pick was made for this gameweek.</p>
                )}
              </div>
            ) : teamsLoading ? (
              <div className="flex justify-center py-6">
                <Spinner />
              </div>
            ) : teams.length === 0 ? (
              <EmptyState icon={Shield} title="No fixtures" description="This gameweek has no fixtures yet." />
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {teams.map((team) => {
                    const disabled = usedTeamIds.has(team.id)
                    const selected = String(selectedTeamId) === String(team.id) || (!selectedTeamId && currentPick?.team_id === team.id)
                    return (
                      <button
                        key={team.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => setSelectedTeamId(String(team.id))}
                        title={disabled ? 'Already used this competition' : undefined}
                        className={`rounded-xl border p-3 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                          selected ? 'border-accent/50 bg-accent/10 text-white' : 'border-white/10 bg-surface-2 text-white/70 hover:border-white/20'
                        }`}
                      >
                        {team.name}
                      </button>
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

      {entry && picks.length > 0 ? (
        <section>
          <Card className="p-5">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-white">
              <History size={16} />
              Previously used teams
            </h2>
            <div className="flex flex-wrap gap-2">
              {picks
                .slice()
                .sort((a, b) => a.gameweek_id - b.gameweek_id)
                .map((p) => (
                  <span key={p.id} className="rounded-full border border-white/10 bg-surface-2 px-3 py-1 text-xs text-white/60">
                    GW{gameweeks.find((gw) => gw.id === p.gameweek_id)?.number ?? p.gameweek_id}: {p.teams?.name}
                  </span>
                ))}
            </div>
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
        <LeaderboardTable rows={standings} gameType="last_man_standing" />
      </section>

      {message ? <Toast message={message} type="success" /> : null}
      {errorMessage ? <Toast message={errorMessage} type="error" /> : null}
    </div>
  )
}
