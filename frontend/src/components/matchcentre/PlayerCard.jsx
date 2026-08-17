import { useState } from 'react'
import { Info, Lock, Shield, User } from 'lucide-react'
import { usePlayerSeasonStats } from '../../hooks/useMatchCentre'
import PlayerDrawer from './PlayerDrawer'
import TeamForm from './TeamForm'

// Phase 8B — the one reusable player card used everywhere a player is
// shown: Pick 5's squad picker, Score Predictor's goalscorer picker, and
// Match Centre's own player list. Two independent click targets, never
// nested (a <button> inside a <button> is invalid HTML) — the main body
// is one button (selects, when `onSelect` is provided; otherwise opens
// the Player Drawer directly, e.g. when browsing Match Centre's squad
// list with nothing to select), and a small sibling "info" button opens
// the Player Drawer without triggering selection whenever a select action
// already owns the main body.
//
// Season goals/assists/cards come from usePlayerSeasonStats — real data,
// the same source PlayerDrawer itself uses; nothing here is invented.
// "Injury/suspension indicator" from the brief is deliberately NOT
// rendered — no such data exists anywhere in this schema (players/
// fixture_player_status have no availability/fitness flag at all) and
// fabricating one would violate "do not invent data." "Recent form"/
// "next opponent" are intentionally not fetched per-card (would mean 2
// extra queries per player in a 20+ player squad list) — `form` can be
// passed down by a caller that already has it (e.g. the fixture's home/
// away form, fetched once per fixture, not once per player); the fuller
// picture (last five appearances, next fixtures, club form) is one click
// away in the Player Drawer, which already builds all of that.
export default function PlayerCard({
  player,
  seasonId,
  shirtNumber = null,
  form,
  selectedCount = 0,
  locked = false,
  disabled = false,
  onSelect,
  size = 'md',
}) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const playerId = player.player_id ?? player.id
  const { data: stats } = usePlayerSeasonStats(playerId, seasonId)

  const selected = selectedCount > 0
  const compact = size === 'sm'

  function handlePrimaryClick() {
    if (onSelect) onSelect()
    else setDrawerOpen(true)
  }

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={handlePrimaryClick}
        disabled={disabled}
        aria-pressed={onSelect ? selected : undefined}
        aria-label={`${player.display_name}${selected ? `, selected${selectedCount > 1 ? ` ${selectedCount} times` : ''}` : ''}${locked ? ', locked' : ''}`}
        className={`
          w-full rounded-2xl border p-3 text-left transition-all
          ${selected ? 'border-accent bg-accent/10 shadow-[0_0_0_1px_rgba(0,230,118,0.4)]' : 'border-white/8 bg-surface-1 hover:border-white/20 hover:bg-surface-2'}
          disabled:cursor-not-allowed disabled:opacity-40
        `}
      >
        <div className="flex items-center gap-2.5">
          <div className="relative shrink-0">
            <div className={`flex items-center justify-center overflow-hidden rounded-xl bg-surface-3 ${compact ? 'h-9 w-9' : 'h-11 w-11'}`}>
              {player.photo_url ? (
                <img src={player.photo_url} alt="" className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <User size={compact ? 16 : 20} className="text-white/25" />
              )}
            </div>
            {shirtNumber ? (
              <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-pitch-950 text-[9px] font-bold text-white/70 ring-1 ring-white/10">
                {shirtNumber}
              </span>
            ) : null}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className={`truncate font-semibold text-white ${compact ? 'text-xs' : 'text-sm'}`}>{player.display_name}</p>
              {locked && <Lock size={11} className="shrink-0 text-white/30" />}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/40">
              {player.crest_url ? (
                <img src={player.crest_url} alt="" className="h-3 w-3 object-contain" />
              ) : (
                <Shield size={10} className="text-white/20" />
              )}
              <span className="truncate">{player.team_short_name || player.team_name}</span>
              <span className="text-white/20">·</span>
              <span className="shrink-0">{player.position || 'Player'}</span>
            </div>
          </div>

          {selected && (
            <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-pitch-950">
              {selectedCount > 1 ? `${selectedCount}x` : 'IN'}
            </span>
          )}
        </div>

        {/* Hover reveals more stats — same data already fetched above, no
            extra query, just a conditionally-shown row. */}
        <div className="mt-2 flex items-center justify-between text-[11px] text-white/45">
          <span>{stats?.goals ?? 0}G · {stats?.assists ?? 0}A</span>
          {form?.length ? <TeamForm results={form.slice(-3)} size="sm" /> : null}
        </div>
        <div className="mt-1.5 hidden items-center gap-3 text-[11px] text-white/35 group-hover:flex">
          {stats?.yellowCards ? <span>🟨 {stats.yellowCards}</span> : null}
          {stats?.redCards ? <span>🟥 {stats.redCards}</span> : null}
          {stats?.minutesPlayed != null ? <span>{stats.minutesPlayed}' played</span> : null}
        </div>
      </button>

      {onSelect ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setDrawerOpen(true)
          }}
          aria-label={`View ${player.display_name}'s profile`}
          className="absolute right-2 top-2 z-10 rounded-full bg-black/40 p-1 text-white/50 opacity-0 backdrop-blur-sm transition-opacity hover:text-white group-hover:opacity-100 focus-visible:opacity-100"
        >
          <Info size={12} />
        </button>
      ) : null}

      <PlayerDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} playerId={playerId} />
    </div>
  )
}
