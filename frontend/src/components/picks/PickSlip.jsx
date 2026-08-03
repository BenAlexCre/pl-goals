import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Card from '../ui/Card'
import { Ticket } from 'lucide-react'
import { summariseEntry, strikeRate } from '../../utils/scoring'

export default function PickSlip({
  picks = [],
  onSubmit,
  submitting = false,
  locked = false,
  deadlinePassed = false,
}) {
  const summary = summariseEntry(picks)
  const rate = strikeRate(summary.won, summary.total)

  return (
    <Card className="p-4 sticky top-20">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Ticket size={18} className="text-accent" />
          <h3 className="font-semibold text-white">Your slip</h3>
        </div>
        <Badge status={deadlinePassed ? 'locked' : locked ? 'settled' : 'pending'}>
          {deadlinePassed ? 'Locked' : locked ? 'Submitted' : 'Draft'}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="rounded-xl bg-surface-2 border border-white/8 p-3">
          <p className="text-[11px] uppercase tracking-wider text-white/35">Selections</p>
          <p className="mt-1 text-lg font-semibold tabular text-white">{summary.total}/5</p>
        </div>
        <div className="rounded-xl bg-surface-2 border border-white/8 p-3">
          <p className="text-[11px] uppercase tracking-wider text-white/35">Strike rate</p>
          <p className="mt-1 text-lg font-semibold tabular text-white">{rate}%</p>
        </div>
      </div>

      <div className="space-y-2 mb-4">
        {picks.length === 0 ? (
          <p className="text-sm text-white/35">Pick 5 players to see your slip.</p>
        ) : (
          picks.map((p, idx) => (
            <div
              key={`${p.player_id}-${idx}`}
              className="flex items-center justify-between text-sm"
            >
              <span className="text-white/70 truncate pr-2">
                {idx + 1}. {p.display_name}
              </span>
              <span className="text-white/35 tabular">
                x{p.threshold ?? 1}
              </span>
            </div>
          ))
        )}
      </div>

      <Button
        fullWidth
        onClick={onSubmit}
        disabled={locked || deadlinePassed || picks.length !== 5}
        loading={submitting}
      >
        {deadlinePassed ? 'Deadline passed' : locked ? 'Locked' : 'Submit picks'}
      </Button>

      {picks.length !== 5 && !deadlinePassed && (
        <p className="mt-3 text-xs text-amber">
          You must select exactly 5 players.
        </p>
      )}
    </Card>
  )
}