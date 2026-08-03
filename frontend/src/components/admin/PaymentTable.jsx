import Card from '../ui/Card'
import Badge from '../ui/Badge'
import Button from '../ui/Button'

export default function PaymentTable({ rows = [], onMarkPaid, onMarkUnpaid, loadingUserId = null }) {
  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-white/8">
        <h3 className="text-sm font-semibold text-white">Payments</h3>
      </div>

      <div className="divide-y divide-white/6">
        {rows.map((row) => (
          <div key={row.user_id} className="px-4 py-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-white">{row.display_name}</p>
              <p className="text-xs text-white/35">@{row.username}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge status={row.is_paid ? 'paid' : 'unpaid'}>
                {row.is_paid ? 'Paid' : 'Unpaid'}
              </Badge>
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
                  Mark paid
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}