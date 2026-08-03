import Card from '../ui/Card'
import Badge from '../ui/Badge'
import { relativeTime } from '../../utils/time'

export default function SyncLog({ logs = [] }) {
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-white mb-3">Recent sync logs</h2>
      <div className="space-y-3 max-h-[480px] overflow-auto pr-1">
        {logs.map((log) => (
          <div key={log.id} className="rounded-xl bg-surface-2 border border-white/8 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-white">{log.job_name}</p>
              <Badge status={log.status === 'success' ? 'won' : log.status === 'failed' ? 'lost' : 'pending'}>
                {log.status}
              </Badge>
            </div>
            <p className="text-xs text-white/35 mt-1">
              {relativeTime(log.started_at)} • {log.records_processed ?? 0} processed
            </p>
          </div>
        ))}
        {logs.length === 0 && (
          <p className="text-sm text-white/35">No logs yet.</p>
        )}
      </div>
    </Card>
  )
}