import { useMemo, useState } from 'react'
import { Crown, ShieldOff } from 'lucide-react'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import Spinner from '../../components/ui/Spinner'
import EmptyState from '../../components/ui/EmptyState'
import { useUserSearch, useSetAppAdmin } from '../../hooks/useSuperAdmin'
import { useUiStore } from '../../store/uiStore'

// Phase 8D, Part 7/12 — "Manage app_admin membership." Deliberately does
// NOT offer granting/revoking super_admin — see super-admin-actions/
// index.ts's own comment: that value is never accepted by the API at all,
// only the separate manual provisioning script (DEPLOYMENT.md) can set it.
export default function Roles() {
  const { data, isLoading, error } = useUserSearch('')
  const admins = useMemo(
    () => (data?.users ?? []).filter((u) => u.role === 'app_admin' || u.role === 'super_admin'),
    [data]
  )
  const [revokeTarget, setRevokeTarget] = useState(null)
  const setAppAdmin = useSetAppAdmin()
  const addToast = useUiStore((s) => s.addToast)

  async function confirmRevoke() {
    try {
      await setAppAdmin.mutateAsync({ targetUserId: revokeTarget.id, grant: false })
      addToast({ type: 'success', message: `app_admin removed from ${revokeTarget.display_name || revokeTarget.email}.` })
      setRevokeTarget(null)
    } catch (err) {
      addToast({ type: 'error', message: err.message })
    }
  }

  if (isLoading) return <div className="flex justify-center py-12"><Spinner size="lg" /></div>
  if (error) return <p className="text-sm text-red-goal">{error.message}</p>

  return (
    <div className="space-y-4">
      <p className="text-sm text-white/40">
        Current app_admin and Super Admin accounts. Grant app_admin to a new account from the{' '}
        <a href="/super-admin/users" className="text-accent hover:text-accent-muted">Users</a> page.
      </p>

      {admins.length === 0 ? (
        <EmptyState icon={Crown} title="No admins" description="No app_admin or Super Admin accounts exist yet." />
      ) : (
        <Card className="divide-y divide-white/5 p-0">
          {admins.map((u) => (
            <div key={u.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="text-sm font-medium text-white">{u.display_name || u.username || 'User'}</div>
                <div className="text-xs text-white/40">{u.email}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1 text-xs capitalize text-white/60">
                  <Crown size={13} className={u.role === 'super_admin' ? 'text-amber' : 'text-white/40'} />
                  {u.role.replace('_', ' ')}
                </span>
                {u.role === 'app_admin' ? (
                  <Button size="sm" variant="ghost" onClick={() => setRevokeTarget(u)}>
                    <ShieldOff size={13} /> Remove
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </Card>
      )}

      <Modal open={!!revokeTarget} onClose={() => setRevokeTarget(null)} title="Remove app_admin" size="sm">
        <p className="text-sm text-white/60">
          Remove app_admin from <span className="font-medium text-white">{revokeTarget?.display_name || revokeTarget?.email}</span>?
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRevokeTarget(null)} disabled={setAppAdmin.isPending}>Cancel</Button>
          <Button variant="danger" onClick={confirmRevoke} loading={setAppAdmin.isPending} disabled={setAppAdmin.isPending}>
            Remove
          </Button>
        </div>
      </Modal>
    </div>
  )
}
