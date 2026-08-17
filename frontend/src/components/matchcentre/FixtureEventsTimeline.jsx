// Extracted and generalized from GameweekPage.jsx's previously-inline
// FixtureEvents — same event data (fixture.fixture_events, already
// fetched by useGameweek/useCurrentGameweek, no second query), but now
// also renders substitutions (the data already existed —
// event_type 'sub_on'/'sub_off' — GameweekPage just never rendered it)
// and makes each player's name clickable into PlayerDrawer via onPlayerClick.
// No VAR event type exists anywhere in fixture_events.event_type — nothing
// invented for it here; only real event types render.
const EVENT_ICON = {
  goal: '⚽',
  yellow_card: '🟨',
  red_card: '🟥',
  second_yellow: '🟨🟥',
  sub_on: '↑',
  sub_off: '↓',
  missed_penalty: '❌',
}

function PlayerName({ player, onPlayerClick, className = '' }) {
  if (!player) return null
  if (!onPlayerClick) return <span className={className}>{player.display_name}</span>
  return (
    <button
      type="button"
      onClick={() => onPlayerClick(player.id)}
      className={`${className} underline decoration-white/20 underline-offset-2 hover:text-white hover:decoration-white/50`}
    >
      {player.display_name}
    </button>
  )
}

export default function FixtureEventsTimeline({ events = [], onPlayerClick }) {
  const sorted = events
    .filter((e) => EVENT_ICON[e.event_type])
    .sort((a, b) => a.minute - b.minute || (a.extra_minute ?? 0) - (b.extra_minute ?? 0))

  if (sorted.length === 0) {
    return <p className="text-sm text-white/35">No events recorded for this fixture yet.</p>
  }

  return (
    <div className="space-y-2">
      {sorted.map((e) => (
        <div key={e.id} className="flex items-start gap-2.5 text-sm">
          <span className="w-10 shrink-0 text-right text-white/30 tabular">
            {e.minute}{e.extra_minute ? `+${e.extra_minute}` : ''}'
          </span>
          <span className="shrink-0">{EVENT_ICON[e.event_type]}</span>
          <span className="text-white/70">
            <PlayerName player={e.player} onPlayerClick={onPlayerClick} />
            {e.event_type === 'goal' && e.assist_player && (
              <span className="text-white/40">
                {' '}(assist: <PlayerName player={e.assist_player} onPlayerClick={onPlayerClick} className="text-white/50" />)
              </span>
            )}
            {e.is_own_goal && <span className="ml-1.5 rounded bg-white/5 px-1.5 py-0.5 text-xs text-white/40">OG</span>}
            {e.is_penalty && <span className="ml-1.5 rounded bg-white/5 px-1.5 py-0.5 text-xs text-white/40">Pen</span>}
          </span>
        </div>
      ))}
    </div>
  )
}
