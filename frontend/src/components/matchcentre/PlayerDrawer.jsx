import { Shield } from 'lucide-react'
import SlideDrawer from '../ui/SlideDrawer'
import TeamForm from './TeamForm'
import Spinner from '../ui/Spinner'
import {
  usePlayerProfile,
  usePlayerSeasonStats,
  usePlayerRecentAppearances,
  useTeamNextFixtures,
  useTeamForm,
} from '../../hooks/useMatchCentre'
import { toLocalTimeShort } from '../../utils/time'
import { initials } from '../../utils/format'

function Stat({ label, value }) {
  if (value === null || value === undefined) return null
  return (
    <div className="rounded-lg border border-white/8 bg-black/10 px-3 py-2 text-center">
      <p className="text-lg font-bold tabular text-white">{value}</p>
      <p className="text-[11px] text-white/40">{label}</p>
    </div>
  )
}

function AppearanceRow({ row }) {
  const fixture = row.fixtures
  if (!fixture) return null
  return (
    <div className="flex items-center justify-between rounded-lg border border-white/8 bg-surface-2/40 px-3 py-2 text-sm">
      <span className="text-white/70">
        {fixture.home_team?.short_name} {fixture.home_goals}&ndash;{fixture.away_goals} {fixture.away_team?.short_name}
      </span>
      <span className="text-xs text-white/35">
        {row.status === 'sub_on' ? `On ${row.came_on_minute ?? ''}'` : row.status === 'sub_off' ? `Off ${row.went_off_minute ?? ''}'` : 'Started'}
      </span>
    </div>
  )
}

// Player profile drawer — reused everywhere a player name is clickable
// (fixture events timeline today; the three picker redesigns in a later
// phase). Every stat here comes from usePlayerSeasonStats/
// usePlayerRecentAppearances — nothing fabricated; fields the underlying
// data doesn't support (minutes/starts/appearances when
// fixture_player_status has nothing for this player) are hidden via
// <Stat>'s own null-check rather than shown as 0.
export default function PlayerDrawer({ open, onClose, playerId }) {
  const { data: profile, isLoading: profileLoading } = usePlayerProfile(playerId)
  const { data: stats } = usePlayerSeasonStats(playerId, profile?.seasonId)
  const { data: recentAppearances = [] } = usePlayerRecentAppearances(playerId)
  const { data: nextFixtures = [] } = useTeamNextFixtures(profile?.team?.id)
  const { data: clubForm } = useTeamForm(profile?.team?.id, profile?.team?.league_id, profile?.team?.season_id)

  return (
    <SlideDrawer open={open} onClose={onClose} title="Player" widthClass="max-w-md">
      {profileLoading || !profile ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : (
        <div className="space-y-6">
          <section className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-surface-3">
              {profile.photo_url ? (
                <img src={profile.photo_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="text-lg font-bold text-accent">{initials(profile.display_name)}</span>
              )}
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-lg font-bold text-white">{profile.display_name}</h3>
              <div className="mt-1 flex items-center gap-2 text-sm text-white/45">
                {profile.team?.crest_url ? (
                  <img src={profile.team.crest_url} alt="" className="h-4 w-4 object-contain" />
                ) : (
                  <Shield size={14} className="text-white/25" />
                )}
                <span className="truncate">{profile.team?.name || 'Free agent'}</span>
              </div>
              <p className="mt-0.5 text-xs text-white/35">
                {profile.position || 'Player'}
                {profile.shirtNumber ? ` · #${profile.shirtNumber}` : ''}
              </p>
            </div>
          </section>

          <section className="grid grid-cols-3 gap-2">
            <Stat label="Goals" value={stats?.goals ?? 0} />
            <Stat label="Assists" value={stats?.assists ?? 0} />
            <Stat label="Yellow cards" value={stats?.yellowCards ?? 0} />
            <Stat label="Red cards" value={stats?.redCards ?? 0} />
            <Stat label="Appearances" value={stats?.appearances} />
            <Stat label="Starts" value={stats?.starts} />
            <Stat label="Minutes" value={stats?.minutesPlayed} />
            <Stat label="Goal contributions" value={(stats?.goals ?? 0) + (stats?.assists ?? 0)} />
          </section>

          <section>
            <h4 className="mb-2 text-sm font-semibold text-white">Club form</h4>
            {clubForm?.results?.length ? (
              <TeamForm results={clubForm.results} />
            ) : (
              <p className="text-xs text-white/35">No completed fixtures yet.</p>
            )}
          </section>

          <section>
            <h4 className="mb-2 text-sm font-semibold text-white">Last five appearances</h4>
            {recentAppearances.length > 0 ? (
              <div className="space-y-1.5">
                {recentAppearances.map((row, i) => <AppearanceRow key={i} row={row} />)}
              </div>
            ) : (
              <p className="text-xs text-white/35">No recorded appearances yet.</p>
            )}
          </section>

          <section>
            <h4 className="mb-2 text-sm font-semibold text-white">Next fixtures</h4>
            {nextFixtures.length > 0 ? (
              <div className="space-y-1.5">
                {nextFixtures.map((f) => (
                  <div key={f.id} className="flex items-center justify-between rounded-lg border border-white/8 bg-surface-2/40 px-3 py-2 text-sm text-white/70">
                    <span>{f.home_team?.short_name} vs {f.away_team?.short_name}</span>
                    <span className="text-xs text-white/35">{toLocalTimeShort(f.kickoff_utc)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-white/35">No upcoming fixtures scheduled.</p>
            )}
          </section>
        </div>
      )}
    </SlideDrawer>
  )
}
