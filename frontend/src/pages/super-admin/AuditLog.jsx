import { ScrollText } from 'lucide-react'
import Card from '../../components/ui/Card'
import Spinner from '../../components/ui/Spinner'
import EmptyState from '../../components/ui/EmptyState'
import { useAuditLog } from '../../hooks/useSuperAdmin'

const ACTION_LABEL = {
  user_banned: 'Banned user',
  user_unbanned: 'Unbanned user',
  app_admin_granted: 'Granted app_admin',
  app_admin_removed: 'Removed app_admin',
}

function who(person) {
  if (!person) return 'Unknown'
  return person.display_name || person.username || 'Unknown'
}

export default function AuditLog() {
  const { data, isLoading, error } = useAuditLog(100)
  const entries = data?.entries ?? []

  if (isLoading) return <div className="flex justify-center py-12"><Spinner size="lg" /></div>
  if (error) return <p className="text-sm text-red-goal">{error.message}</p>

  return (
    <div className="space-y-4">
      {entries.length === 0 ? (
        <EmptyState icon={ScrollText} title="No admin actions yet" description="Ban, unban, and role changes will appear here." />
      ) : (
        <Card className="divide-y divide-white/5 p-0">
          {entries.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <div>
                <span className="font-medium text-white">{ACTION_LABEL[e.action] ?? e.action}</span>
                {e.target ? <span className="text-white/50"> — {who(e.target)}</span> : null}
                {e.metadata?.reason ? <span className="text-white/40"> ({e.metadata.reason})</span> : null}
              </div>
              <div className="text-xs text-white/40">
                {who(e.actor)} · {new Date(e.created_at).toLocaleString()}
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
