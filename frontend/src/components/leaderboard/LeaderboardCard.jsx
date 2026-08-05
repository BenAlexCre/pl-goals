import Card from '../ui/Card'
import Badge from '../ui/Badge'
import Avatar from '../ui/Avatar'
import { PICK5_PICK_COUNT, strikeRate } from '../../utils/scoring'

export default function LeaderboardCard({ rows = [] }) {
  return (
    <div className="grid gap-2">
      {rows.map((row) => (
        <Card key={`${row.user_id}-${row.gameweek_id ?? 'overall'}`} className="p-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-surface-3 flex items-center justify-center text-sm tabular text-white/55">
              #{row.rank}
            </div>
            <Avatar user={row.profiles} size="md" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-white truncate">
                  {row.profiles?.display_name ?? 'Unknown'}
                </p>
                <Badge status="pending">{`${row.score}/${PICK5_PICK_COUNT}`}</Badge>
              </div>
              <p className="text-sm text-white/35 mt-1">
                {row.score} correct picks • {strikeRate(row.score, PICK5_PICK_COUNT)}% strike rate
              </p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}