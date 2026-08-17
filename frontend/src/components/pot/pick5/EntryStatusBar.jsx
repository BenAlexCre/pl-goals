import { CheckCircle2, CreditCard, Lock, XCircle } from 'lucide-react'
import CountdownTimer from '../../ui/CountdownTimer'

function StatusChip({ icon: Icon, label, tone }) {
  const tones = {
    success: 'border-accent/30 bg-accent/10 text-accent',
    warning: 'border-amber/30 bg-amber/10 text-amber',
    danger: 'border-red-goal/30 bg-red-goal/10 text-red-goal',
    neutral: 'border-white/10 bg-white/5 text-white/50',
  }

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${tones[tone]}`}>
      <Icon size={13} />
      {label}
    </span>
  )
}

// Reflects exactly the three facts the backend already exposes for "your
// entry" this gameweek — entry_payments.is_paid, whether a game_entries row
// exists at all, and game_entries.status — no new state invented. Color
// follows the brief's own scheme: green only for a genuinely good state,
// amber for "still time, but not done," red for "needs attention," grey
// for the immutable locked/settled state.
export default function EntryStatusBar({ isPaid, hasEntry, entryStatus, deadlineUtc, loading }) {
  if (loading) {
    return <div className="h-8 w-full max-w-md animate-pulse rounded-full bg-white/5" />
  }

  const isLocked = entryStatus === 'locked' || entryStatus === 'settled'

  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusChip
        icon={isPaid ? CheckCircle2 : CreditCard}
        label={isPaid ? 'Paid' : 'Payment due'}
        tone={isPaid ? 'success' : 'danger'}
      />

      <StatusChip
        icon={hasEntry ? CheckCircle2 : XCircle}
        label={hasEntry ? 'Picks submitted' : 'Picks missing'}
        tone={hasEntry ? 'success' : isLocked ? 'danger' : 'warning'}
      />

      {isLocked ? (
        <StatusChip icon={Lock} label={entryStatus === 'settled' ? 'Settled' : 'Locked'} tone="neutral" />
      ) : (
        <CountdownTimer deadlineUtc={deadlineUtc} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5" />
      )}
    </div>
  )
}
