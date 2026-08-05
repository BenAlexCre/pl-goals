import Card from '../ui/Card'
import Badge from '../ui/Badge'
import Avatar from '../ui/Avatar'
import { PICK5_PICK_COUNT, strikeRate } from '../../utils/scoring'

export default function LeaderboardTable({ rows = [] }) {
  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-white/8">
        <h3 className="text-sm font-semibold text-white">Leaderboard</h3>
      </div>

      <div className="divide-y divide-white/6">
        {rows.map((row) => (
          <div key={`${row.user_id}-${row.gameweek_id ?? 'overall'}`} className="px-4 py-3 flex items-center gap-3">
            <div className="w-8 text-center text-sm tabular text-white/35">
              #{row.rank}
            </div>
            <Avatar user={row.profiles} size="sm" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {row.profiles?.display_name ?? 'Unknown'}
              </p>
              <p className="text-xs text-white/35">
                {row.score}/{PICK5_PICK_COUNT} correct • {strikeRate(row.score, PICK5_PICK_COUNT)}% strike rate
              </p>
            </div>
            <Badge status={row.score === PICK5_PICK_COUNT ? 'won' : 'pending'}>
              {row.score}/{PICK5_PICK_COUNT}
            </Badge>
          </div>
        ))}

        {rows.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-white/35">
            No leaderboard data yet.
          </div>
        )}
      </div>
    </Card>
  )
}