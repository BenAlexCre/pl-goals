import { useTriggerSync, useSyncLogs } from '../hooks/useAdmin'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import SyncLog from '../components/admin/SyncLog'
import { useUiStore } from '../store/uiStore'

export default function AdminDashboard() {
  const addToast = useUiStore((s) => s.addToast)
  const { data: logs = [] } = useSyncLogs()

  const syncFixtures   = useTriggerSync('sync-fixtures')
  const syncLive       = useTriggerSync('sync-live-events')
  const computeScores  = useTriggerSync('compute-scores')
  const settleGameweek = useTriggerSync('settle-gameweek')

  async function runSync(mutation, label) {
    try {
      await mutation.mutateAsync()
      addToast({ type: 'success', message: `${label} triggered` })
    } catch (err) {
      addToast({ type: 'error', message: err.message })
    }
  }

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Admin dashboard</h1>
            <p className="text-sm text-white/40 mt-1">Run syncs and inspect logs.</p>
          </div>
          <Badge status="admin">Admin</Badge>
        </div>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-4 space-y-3">
          <h2 className="text-sm font-semibold text-white">Manual jobs</h2>
          <Button fullWidth variant="secondary" loading={syncFixtures.isPending} onClick={() => runSync(syncFixtures, 'Fixture sync')}>
            Sync fixtures / squads
          </Button>
          <Button fullWidth variant="secondary" loading={syncLive.isPending} onClick={() => runSync(syncLive, 'Live events sync')}>
            Sync live events
          </Button>
          <Button fullWidth variant="secondary" loading={computeScores.isPending} onClick={() => runSync(computeScores, 'Score compute')}>
            Compute live scores
          </Button>
          <Button fullWidth variant="secondary" loading={settleGameweek.isPending} onClick={() => runSync(settleGameweek, 'Settlement')}>
            Settle finished gameweeks
          </Button>
        </Card>

        <SyncLog logs={logs} />
      </div>
    </div>
  )
}