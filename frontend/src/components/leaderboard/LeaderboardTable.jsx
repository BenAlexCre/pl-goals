import Card from '../ui/Card'
import Badge from '../ui/Badge'
import Avatar from '../ui/Avatar'
import { PICK5_PICK_COUNT, strikeRate } from '../../utils/scoring'

// Mode-aware per-row rendering. pot_standings_snapshots' shape is already
// generic (rank/score/meta) — only the DISPLAY of score/meta differs per
// mode (Pick5: score is picks-won-of-5; LMS: score is 1/0 alive/eliminated,
// meta.competitiveStatus/eliminatedGameweekId; Predictor: score is
// unbounded cumulative points, meta.exactScoreCount/correctScorerCount) —
// see each engine's own generateStandings() for the exact meta shape this
// mirrors. gameType defaults to 'pick5' so the one existing call site
// (GameweekPage.jsx) needs no change.
export default function LeaderboardTable({ rows = [], gameType = 'pick5' }) {
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
              <RowDetailLabel gameType={gameType} row={row} />
            </div>
            <RowDetailBadge gameType={gameType} row={row} />
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

// Split into two so the badge (trailing, flex-shrink-0) and label (in the
// flex-1 middle column) can live in their correct JSX positions above
// without RowDetail's fragment being torn apart by layout — same visual
// result as the original single Badge-at-the-end layout, per mode.
function RowDetailLabel({ gameType, row }) {
  if (gameType === 'last_man_standing') {
    const status = row.meta?.competitiveStatus ?? 'alive'
    const eliminatedGw = row.meta?.eliminatedGameweekId
    return (
      <p className="text-xs text-white/35">
        {status === 'eliminated' && eliminatedGw ? `Eliminated in GW${eliminatedGw}` : 'Still alive'}
      </p>
    )
  }

  if (gameType === 'score_predictor') {
    const exact = row.meta?.exactScoreCount ?? 0
    const scorer = row.meta?.correctScorerCount ?? 0
    return (
      <p className="text-xs text-white/35">
        {exact} exact score{exact === 1 ? '' : 's'} • {scorer} scorer bonus{scorer === 1 ? '' : 'es'}
      </p>
    )
  }

  return (
    <p className="text-xs text-white/35">
      {row.score}/{PICK5_PICK_COUNT} correct • {strikeRate(row.score, PICK5_PICK_COUNT)}% strike rate
    </p>
  )
}

function RowDetailBadge({ gameType, row }) {
  if (gameType === 'last_man_standing') {
    return <Badge status={row.meta?.competitiveStatus ?? 'alive'} />
  }

  if (gameType === 'score_predictor') {
    return (
      <span className="rounded-full border border-white/10 bg-white/8 px-3 py-1 text-xs font-medium text-white/70 tabular flex-shrink-0">
        {row.score} pts
      </span>
    )
  }

  return (
    <Badge status={row.score === PICK5_PICK_COUNT ? 'won' : 'pending'}>
      {row.score}/{PICK5_PICK_COUNT}
    </Badge>
  )
}
