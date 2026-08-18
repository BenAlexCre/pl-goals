import { Link } from 'react-router-dom'
import { CreditCard, RefreshCw, Sparkles } from 'lucide-react'
import { useTriggerSync, useSyncLogs, useIsSuperAdmin } from '../hooks/useAdmin'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import SyncLog from '../components/admin/SyncLog'
import { useUiStore } from '../store/uiStore'

export default function AdminDashboard() {
  const addToast = useUiStore((s) => s.addToast)
  const { data: logs = [] } = useSyncLogs()
  // Phase 10B, Part 23 — Manual jobs (sync-fixtures/compute-scores/
  // settle-gameweek/sync-live-events) narrowed from "any app_admin" to
  // super_admin-only, the user's own explicit instruction, enforced at
  // both levels: this frontend gate AND `_shared/adminOrCronAuth.ts`'s
  // backend check (now `role === 'super_admin'`, see that file's own
  // comment). Payment verification/Rollover management below are
  // unconditional on this page — they're correctly open to any pot
  // organiser via AdminRoute itself, not gated locally, unaffected by
  // this change.
  const isSuperAdmin = useIsSuperAdmin()

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
          <h2 className="text-sm font-semibold text-white">Payment verification</h2>
          <p className="text-xs text-white/40">Mark entries paid/unpaid, single or via CSV import.</p>
          <Link to="/admin/payments">
            <Button fullWidth variant="secondary">
              <CreditCard size={16} />
              Open payment verification
            </Button>
          </Link>
        </Card>

        <Card className="p-4 space-y-3">
          <h2 className="text-sm font-semibold text-white">Rollover management</h2>
          <p className="text-xs text-white/40">Review, rename, and activate draft pots created after an unclaimed jackpot or wipeout.</p>
          <Link to="/admin/rollovers">
            <Button fullWidth variant="secondary">
              <RefreshCw size={16} />
              Manage rollover pots
            </Button>
          </Link>
        </Card>

        {isSuperAdmin && (
          <Card className="p-4 space-y-3">
            <h2 className="text-sm font-semibold text-white">Demo Centre</h2>
            <p className="text-xs text-white/40">Generate an isolated demo environment and run a live one-hour Demo Gameweek.</p>
            <Link to="/admin/demo">
              <Button fullWidth variant="secondary">
                <Sparkles size={16} />
                Open Demo Centre
              </Button>
            </Link>
          </Card>
        )}

        {isSuperAdmin && (
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
        )}

        {isSuperAdmin && <SyncLog logs={logs} />}
      </div>
    </div>
  )
}