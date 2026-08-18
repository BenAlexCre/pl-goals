import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, ShieldOff, ShieldCheck, Crown } from 'lucide-react'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import Spinner from '../../components/ui/Spinner'
import EmptyState from '../../components/ui/EmptyState'
import { useUserSearch, useBanUser, useUnbanUser, useSetAppAdmin } from '../../hooks/useSuperAdmin'
import { useUiStore } from '../../store/uiStore'

// Phase 8D, Part 8/12 — ban/unban/role actions each go through a confirming
// Modal, guarded against rapid double-clicks with a synchronous useRef
// check, same discipline AdminPayments.jsx's own money-moving actions
// already use ("a ref updates synchronously... covers the render before
// [Button's disabled] does").
function BanModal({ user, onClose }) {
  const addToast = useUiStore((s) => s.addToast)
  const banUser = useBanUser()
  const [reason, setReason] = useState('')
  const guard = useRef(false)

  async function confirm() {
    if (guard.current) return
    guard.current = true
    try {
      await banUser.mutateAsync({ targetUserId: user.id, reason: reason.trim() || undefined })
      addToast({ type: 'success', message: `${user.display_name || user.email} banned.` })
      onClose()
    } catch (err) {
      addToast({ type: 'error', message: err.message })
    } finally {
      guard.current = false
    }
  }

  return (
    <Modal open={!!user} onClose={onClose} title="Ban account" size="sm">
      <p className="text-sm text-white/60">
        Ban <span className="font-medium text-white">{user?.display_name || user?.email}</span>? They will not be
        able to sign in again, and any currently active session will be blocked from creating/joining pots or
        submitting picks on its very next request. Historical competition data is not deleted.
      </p>
      <label className="mb-1 mt-4 block text-sm text-white/70" htmlFor="ban-reason">Reason (optional)</label>
      <input
        id="ban-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. abusive behaviour"
        className="w-full rounded-xl border border-white/8 bg-surface-2 px-4 py-3 text-white outline-none focus:border-accent/40"
      />
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={banUser.isPending}>Cancel</Button>
        <Button variant="danger" onClick={confirm} loading={banUser.isPending} disabled={banUser.isPending}>
          Ban account
        </Button>
      </div>
    </Modal>
  )
}

function UnbanModal({ user, onClose }) {
  const addToast = useUiStore((s) => s.addToast)
  const unbanUser = useUnbanUser()
  const guard = useRef(false)

  async function confirm() {
    if (guard.current) return
    guard.current = true
    try {
      await unbanUser.mutateAsync({ targetUserId: user.id })
      addToast({ type: 'success', message: `${user.display_name || user.email} unbanned.` })
      onClose()
    } catch (err) {
      addToast({ type: 'error', message: err.message })
    } finally {
      guard.current = false
    }
  }

  return (
    <Modal open={!!user} onClose={onClose} title="Unban account" size="sm">
      <p className="text-sm text-white/60">
        Unban <span className="font-medium text-white">{user?.display_name || user?.email}</span>? They will be able
        to sign in and use the app normally again.
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={unbanUser.isPending}>Cancel</Button>
        <Button variant="primary" onClick={confirm} loading={unbanUser.isPending} disabled={unbanUser.isPending}>
          Unban account
        </Button>
      </div>
    </Modal>
  )
}

function RoleModal({ user, grant, onClose }) {
  const addToast = useUiStore((s) => s.addToast)
  const setAppAdmin = useSetAppAdmin()
  const guard = useRef(false)

  async function confirm() {
    if (guard.current) return
    guard.current = true
    try {
      await setAppAdmin.mutateAsync({ targetUserId: user.id, grant })
      addToast({ type: 'success', message: `app_admin ${grant ? 'granted to' : 'removed from'} ${user.display_name || user.email}.` })
      onClose()
    } catch (err) {
      addToast({ type: 'error', message: err.message })
    } finally {
      guard.current = false
    }
  }

  return (
    <Modal open={!!user} onClose={onClose} title={grant ? 'Grant app_admin' : 'Remove app_admin'} size="sm">
      <p className="text-sm text-white/60">
        {grant ? 'Grant' : 'Remove'} app_admin {grant ? 'to' : 'from'}{' '}
        <span className="font-medium text-white">{user?.display_name || user?.email}</span>?{' '}
        {grant
          ? 'They will gain access to platform admin tools (Manual jobs, Demo Centre is Super Admin-only). This does not grant Super Admin.'
          : 'They will lose access to platform admin tools, but keep any pots they personally administer.'}
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={setAppAdmin.isPending}>Cancel</Button>
        <Button variant="primary" onClick={confirm} loading={setAppAdmin.isPending} disabled={setAppAdmin.isPending}>
          Confirm
        </Button>
      </div>
    </Modal>
  )
}

export default function Users() {
  const [search, setSearch] = useState('')
  const { data, isLoading, error } = useUserSearch(search)
  const users = data?.users ?? []

  const [banTarget, setBanTarget] = useState(null)
  const [unbanTarget, setUnbanTarget] = useState(null)
  const [roleTarget, setRoleTarget] = useState(null) // { user, grant }

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by display name, username, or email"
          className="w-full rounded-xl border border-white/8 bg-surface-2 py-3 pl-9 pr-4 text-white outline-none focus:border-accent/40"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : error ? (
        <p className="text-sm text-red-goal">{error.message}</p>
      ) : users.length === 0 ? (
        <EmptyState icon={Search} title="No users found" description="Try a different search term." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-white/8 text-xs uppercase tracking-wide text-white/40">
              <tr>
                <th className="px-4 py-3 font-medium">Player</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Verified</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Pots</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                  <td className="px-4 py-3">
                    <Link to={`/super-admin/users/${u.id}`} className="font-medium text-white hover:text-accent">
                      {u.display_name || u.username || 'User'}
                    </Link>
                    {u.is_demo ? <span className="ml-2 rounded bg-white/8 px-1.5 py-0.5 text-[10px] text-white/40">demo</span> : null}
                  </td>
                  <td className="px-4 py-3 text-white/60">{u.email}</td>
                  <td className="px-4 py-3">
                    {u.email_verified ? (
                      <span className="text-accent">Verified</span>
                    ) : (
                      <span className="text-white/30">Unverified</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {u.banned ? <span className="text-red-goal">Banned</span> : <span className="text-white/60">Active</span>}
                  </td>
                  <td className="px-4 py-3 text-white/60 capitalize">{u.role}</td>
                  <td className="px-4 py-3 text-white/60">{u.pot_count}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      {u.role === 'super_admin' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs text-white/30">
                          <Crown size={12} /> Super Admin
                        </span>
                      ) : (
                        <>
                          {u.banned ? (
                            <Button size="sm" variant="secondary" onClick={() => setUnbanTarget(u)}>
                              <ShieldCheck size={13} /> Unban
                            </Button>
                          ) : (
                            <Button size="sm" variant="danger" onClick={() => setBanTarget(u)}>
                              <ShieldOff size={13} /> Ban
                            </Button>
                          )}
                          {u.role === 'app_admin' ? (
                            <Button size="sm" variant="ghost" onClick={() => setRoleTarget({ user: u, grant: false })}>
                              Remove admin
                            </Button>
                          ) : (
                            <Button size="sm" variant="ghost" onClick={() => setRoleTarget({ user: u, grant: true })}>
                              Make admin
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <BanModal user={banTarget} onClose={() => setBanTarget(null)} />
      <UnbanModal user={unbanTarget} onClose={() => setUnbanTarget(null)} />
      <RoleModal user={roleTarget?.user} grant={roleTarget?.grant} onClose={() => setRoleTarget(null)} />
    </div>
  )
}
