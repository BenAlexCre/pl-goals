import { Shield } from 'lucide-react'
import { useLeagueStandings, useTeamForm, useTeamHomeAwayRecord } from '../../hooks/useMatchCentre'
import TeamForm from './TeamForm'

function ordinal(n) {
  if (!n) return ''
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1: return `${n}st`
    case 2: return `${n}nd`
    case 3: return `${n}rd`
    default: return `${n}th`
  }
}

// Phase 8B — the one reusable team card: used in the redesigned Last Man
// Standing picker today, and explicitly meant for Match Centre / future
// dashboards per the brief. `useLeagueStandings` is called once per
// (leagueId, seasonId) — React Query dedupes identical query keys, so
// rendering many TeamCards for the same league/season (e.g. every fixture
// in a gameweek) shares one cached standings fetch, not N of them; only
// `useTeamForm`/`useTeamHomeAwayRecord` are genuinely per-team.
export default function TeamCard({ team, leagueId, seasonId, venue, selected = false, disabled = false, disabledReason, onSelect }) {
  const { data: standings = [] } = useLeagueStandings(leagueId, seasonId)
  const standing = standings.find((s) => s.team_id === team.id)
  const { data: form } = useTeamForm(team.id, leagueId, seasonId)
  const { data: record } = useTeamHomeAwayRecord(team.id, leagueId, seasonId)

  const venueRecord = venue === 'home' ? record?.home : venue === 'away' ? record?.away : null

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      aria-pressed={selected}
      aria-label={`${team.name}${selected ? ', selected' : ''}${disabled ? `, unavailable${disabledReason ? `: ${disabledReason}` : ''}` : ''}`}
      className={`
        w-full rounded-2xl border p-4 text-left transition-all
        ${selected ? 'border-accent bg-accent/10 shadow-[0_0_0_1px_rgba(0,230,118,0.4)]' : 'border-white/8 bg-surface-1 hover:border-white/20 hover:bg-surface-2'}
        disabled:cursor-not-allowed disabled:opacity-35
      `}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-3">
          {team.crest_url ? (
            <img src={team.crest_url} alt="" className="h-7 w-7 object-contain" loading="lazy" />
          ) : (
            <Shield size={18} className="text-white/25" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{team.name}</p>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-white/40">
            {standing ? (
              <span>{ordinal(standing.position)} · {standing.points}pts · GD {standing.goal_difference > 0 ? '+' : ''}{standing.goal_difference}</span>
            ) : (
              <span>No completed fixtures yet</span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <TeamForm results={form?.results} size="sm" />
        {venueRecord && venueRecord.played > 0 ? (
          <span className="text-[11px] text-white/40">
            {venue === 'home' ? 'Home' : 'Away'}: {venueRecord.won}W {venueRecord.drawn}D {venueRecord.lost}L
          </span>
        ) : null}
      </div>

      {disabled && disabledReason ? (
        <p className="mt-2 text-[11px] text-red-goal/70">{disabledReason}</p>
      ) : null}
    </button>
  )
}
