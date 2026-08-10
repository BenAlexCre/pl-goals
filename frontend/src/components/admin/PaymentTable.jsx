import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import Card from '../ui/Card'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Modal from '../ui/Modal'

export default function PaymentTable({ rows = [], onMarkPaid, onMarkUnpaid, onReinstate, loadingUserId = null, reinstatingUserId = null, weekly = true }) {
  const [pendingReinstate, setPendingReinstate] = useState(null)

  function confirmReinstate() {
    if (!pendingReinstate) return
    onReinstate(pendingReinstate)
    setPendingReinstate(null)
  }

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-white/8">
        <h3 className="text-sm font-semibold text-white">Payments</h3>
      </div>

      <div className="divide-y divide-white/6">
        {rows.map((row) => (
          <div key={row.user_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="text-sm text-white">{row.display_name}</p>
              <p className="text-xs text-white/35">@{row.username}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge status={row.is_paid ? 'paid' : 'unpaid'}>
                {row.is_paid ? 'Paid' : 'Unpaid'}
              </Badge>
              {row.canReinstate && onReinstate && (
                <Button
                  size="sm"
                  variant="outline"
                  loading={reinstatingUserId === row.user_id}
                  onClick={() => setPendingReinstate(row)}
                  aria-label={`Reinstate ${row.display_name}'s entry`}
                >
                  <RotateCcw size={13} />
                  Reinstate entry
                </Button>
              )}
              {row.is_paid ? (
                <Button
                  size="sm"
                  variant="danger"
                  loading={loadingUserId === row.user_id}
                  onClick={() => onMarkUnpaid(row)}
                >
                  Mark unpaid
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="primary"
                  loading={loadingUserId === row.user_id}
                  onClick={() => onMarkPaid(row)}
                >
                  {weekly ? 'Mark paid for this week' : 'Mark paid'}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <Modal open={!!pendingReinstate} onClose={() => setPendingReinstate(null)} title="Reinstate entry" size="sm">
        <p className="text-sm text-white/60">
          Reinstate <span className="font-medium text-white">{pendingReinstate?.display_name}</span>'s entry? Their
          picks will be re-scored for any gameweek missed while void, and they'll rejoin the competition from where
          they left off. This cannot be undone once the competition concludes and its prize is paid.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setPendingReinstate(null)}>Cancel</Button>
          <Button type="button" onClick={confirmReinstate}>
            Reinstate
          </Button>
        </div>
      </Modal>
    </Card>
  )
}
