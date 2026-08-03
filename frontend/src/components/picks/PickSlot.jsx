import Badge from '../ui/Badge'
import Avatar from '../ui/Avatar'

export default function PickSlot({ pick, index, onRemove, locked = false }) {
  const player = pick?.players?.display_name ? pick.players : null
  const team = pick?.players?.player_team_history?.[0]?.teams

  return (
    <div className="bg-surface-1 border border-white/8 rounded-xl p-3 flex items-center gap-3">
      <div className="w-8 h-8 rounded-full bg-surface-3 flex items-center justify-center text-xs text-white/40 font-semibold flex-shrink-0">
        {index + 1}
      </div>

      {player ? (
        <>
          <Avatar
            user={{ display_name: player.display_name, avatar_url: player.photo_url }}
            size="sm"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <p className="text-sm font-medium text-white truncate">{player.display_name}</p>
              {team?.short_name && (
                <Badge status="member" className="shrink-0">{team.short_name}</Badge>
              )}
            </div>
            <p className="text-xs text-white/35">
              Threshold: {pick.goal_threshold ?? 1} goal{(pick.goal_threshold ?? 1) !== 1 ? 's' : ''}
            </p>
          </div>
          {!locked && onRemove && (
            <button
              onClick={onRemove}
              className="text-white/30 hover:text-red-goal transition-colors text-xs px-2 py-1"
            >
              Remove
            </button>
          )}
        </>
      ) : (
        <div className="flex-1">
          <p className="text-sm text-white/35">Empty slot</p>
        </div>
      )}
    </div>
  )
}