import { useState } from 'react'
import { UserX, Users } from 'lucide-react'
import Card from '../ui/Card'
import Button from '../ui/Button'
import Badge from '../ui/Badge'
import Avatar from '../ui/Avatar'
import EmptyState from '../ui/EmptyState'
import Modal from '../ui/Modal'
import { useUiStore } from '../../store/uiStore'
import { useRemoveMember } from '../../hooks/useMembership'

// Plain member list + admin-only removal, reused by every pot-detail
// surface (Pick 5's own Members tab already has a richer, picks-reveal
// list of its own — this is the LMS/Predictor equivalent, which had none).
// Removal calls the already-implemented admin-actions' remove_member —
// nothing new on the backend.
export default function MemberList({ potId, members = [], isAdmin }) {
  const addToast = useUiStore((s) => s.addToast)
  const removeMember = useRemoveMember()
  const [pendingRemoval, setPendingRemoval] = useState(null)

  async function confirmRemove() {
    if (!pendingRemoval) return
    try {
      await removeMember.mutateAsync({ potId, userId: pendingRemoval.user_id })
      addToast({ type: 'success', message: `${pendingRemoval.profiles?.display_name || 'Member'} removed from the pot` })
      setPendingRemoval(null)
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to remove member' })
    }
  }

  return (
    <Card className="p-5">
      <h3 className="mb-4 text-sm font-semibold text-white">Members ({members.length})</h3>

      {members.length === 0 ? (
        <EmptyState icon={Users} title="No members" description="No one has joined this pot yet." />
      ) : (
        <div className="space-y-2">
          {members.map((m) => (
            <div key={m.user_id} className="flex items-center justify-between rounded-xl border border-white/8 bg-surface-2/40 px-3 py-2.5">
              <div className="flex items-center gap-3">
                <Avatar user={m.profiles} size="sm" />
                <div>
                  <div className="text-sm text-white">{m.profiles?.display_name || 'Unknown'}</div>
                  <div className="text-xs text-white/40">@{m.profiles?.username || 'unknown'}</div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Badge status={m.role === 'admin' ? 'admin' : 'member'} />
                {isAdmin ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setPendingRemoval(m)}
                    aria-label={`Remove ${m.profiles?.display_name || 'member'}`}
                  >
                    <UserX size={15} />
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!pendingRemoval} onClose={() => setPendingRemoval(null)} title="Remove member" size="sm">
        <p className="text-sm text-white/60">
          Remove <span className="font-medium text-white">{pendingRemoval?.profiles?.display_name}</span> from this pot?
          They will lose access to picks, standings, and payments for this competition.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setPendingRemoval(null)}>
            Cancel
          </Button>
          <Button type="button" variant="danger" onClick={confirmRemove} loading={removeMember.isPending} disabled={removeMember.isPending}>
            Remove
          </Button>
        </div>
      </Modal>
    </Card>
  )
}
