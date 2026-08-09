import { Bell, Trophy } from 'lucide-react'
import { useNotifications, useMarkNotificationRead } from '../../hooks/useNotifications'
import Spinner from '../ui/Spinner'
import EmptyState from '../ui/EmptyState'
import { relativeTime } from '../../utils/time'

// GE-4.8: type is free text at the schema level — one entry per event the
// three engines' notifyUsers() actually emit today (pick5/lms/predictor
// .prize_awarded). Unknown future types fall back to the raw type string
// rather than guessing at a label, so a new event never renders as blank.
function describeNotification(n) {
  const potName = n.pots?.name || 'a pot'
  const amount = n.payload?.amount

  if (n.type.endsWith('.prize_awarded')) {
    const amountText = typeof amount === 'number' ? `€${amount.toFixed(2)}` : 'a prize'
    const tiedText = n.payload?.tied ? ' (split with other winners)' : ''
    return `You won ${amountText} in ${potName}${tiedText}`
  }

  return `${n.type} — ${potName}`
}

export default function NotificationPanel() {
  const { data: notifications = [], isLoading } = useNotifications()
  const markRead = useMarkNotificationRead()

  return (
    <div>
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
        <Bell size={18} />
        Notifications
      </h2>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : notifications.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="No notifications yet"
          description="Prize payouts and other updates will show up here."
        />
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => {
            const unread = !n.read_at
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => unread && markRead.mutate(n.id)}
                className={`w-full rounded-xl border p-3 text-left transition-colors ${
                  unread
                    ? 'border-accent/30 bg-accent/10 hover:bg-accent/15'
                    : 'border-white/8 bg-surface-2/50 hover:bg-surface-2'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/10">
                    <Trophy size={14} className="text-white/70" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm ${unread ? 'text-white font-medium' : 'text-white/60'}`}>
                      {describeNotification(n)}
                    </p>
                    <p className="mt-1 text-xs text-white/35">{relativeTime(n.created_at)}</p>
                  </div>
                  {unread ? <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-accent" /> : null}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
