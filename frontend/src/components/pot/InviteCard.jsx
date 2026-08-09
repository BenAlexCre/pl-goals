import { useState } from 'react'
import { Copy, Link2, UserPlus, Search } from 'lucide-react'
import Card from '../ui/Card'
import Button from '../ui/Button'
import Spinner from '../ui/Spinner'
import { useUiStore } from '../../store/uiStore'
import { useGenerateInviteCode, useSearchProfilesByUsername, useAddMember } from '../../hooks/useMembership'

// Organiser-only invite controls — copy the existing shareable code/link
// (pots.invite_code + redeem_invite(), both already implemented), or add a
// known registered user directly (admin-actions' add_member, already
// implemented). No new membership state: adding is immediate, same as
// redeem_invite() itself — matches the explicit MVP decision to keep
// membership immediate rather than introduce a pending/invitation layer.
// onChange: called after a successful generate/add, in addition to this
// hook's own react-query cache invalidation — needed because PotDetail.jsx
// (Pick 5) still holds its own pot/members state via plain useState +
// imperative fetches, not react-query, so invalidating the ['pot', potId]
// query alone never touches it. LMS/Predictor's usePot()-based callers
// don't need to pass this; their own cache invalidation already covers it.
export default function InviteCard({ potId, inviteCode, existingMemberIds, onChange }) {
  const addToast = useUiStore((s) => s.addToast)
  const generateCode = useGenerateInviteCode()
  const addMember = useAddMember()

  const [usernameQuery, setUsernameQuery] = useState('')
  const { data: searchResults = [], isFetching: searching } = useSearchProfilesByUsername(usernameQuery)

  const inviteLink = inviteCode ? `${window.location.origin}/join/${inviteCode}` : null

  async function copyToClipboard(text, label) {
    try {
      await navigator.clipboard.writeText(text)
      addToast({ type: 'success', message: `${label} copied to clipboard` })
    } catch {
      addToast({ type: 'error', message: `Could not copy ${label.toLowerCase()} — copy it manually` })
    }
  }

  async function handleGenerate() {
    try {
      await generateCode.mutateAsync(potId)
      await onChange?.()
      addToast({ type: 'success', message: 'Invite code generated' })
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to generate invite code' })
    }
  }

  async function handleAdd(userId, label) {
    try {
      await addMember.mutateAsync({ potId, userId })
      await onChange?.()
      addToast({ type: 'success', message: `${label} added to the pot` })
      setUsernameQuery('')
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to add member' })
    }
  }

  const visibleResults = searchResults.filter((p) => !existingMemberIds?.has(p.id))

  return (
    <Card className="p-5">
      <h3 className="mb-4 text-sm font-semibold text-white">Invite players</h3>

      {inviteCode ? (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-white/45">Invite code</label>
            <div className="flex gap-2">
              <input
                readOnly
                value={inviteCode}
                className="flex-1 rounded-xl border border-white/10 bg-surface-2 px-4 py-2.5 font-mono text-sm tracking-wider text-white outline-none"
              />
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => copyToClipboard(inviteCode, 'Invite code')}
              >
                <Copy size={15} />
              </Button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-white/45">Invite link</label>
            <div className="flex gap-2">
              <input
                readOnly
                value={inviteLink}
                className="flex-1 truncate rounded-xl border border-white/10 bg-surface-2 px-4 py-2.5 text-sm text-white/70 outline-none"
              />
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => copyToClipboard(inviteLink, 'Invite link')}
              >
                <Link2 size={15} />
              </Button>
            </div>
            <p className="mt-1 text-xs text-white/35">
              Share this link — anyone who opens it can sign in and join instantly.
            </p>
          </div>
        </div>
      ) : (
        <div>
          <p className="mb-3 text-sm text-white/45">
            No invite code yet — generate one to share a join link with anyone.
          </p>
          <Button type="button" onClick={handleGenerate} loading={generateCode.isPending} disabled={generateCode.isPending}>
            Generate invite code
          </Button>
        </div>
      )}

      <div className="mt-5 border-t border-white/8 pt-4">
        <label className="mb-2 flex items-center gap-2 text-xs text-white/45" htmlFor="invite-username-search">
          <Search size={13} />
          Add a registered player by username
        </label>
        <input
          id="invite-username-search"
          type="text"
          value={usernameQuery}
          onChange={(e) => setUsernameQuery(e.target.value)}
          placeholder="Search by username"
          className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-2.5 text-sm text-white outline-none"
        />

        {usernameQuery.trim().length >= 2 ? (
          <div className="mt-2 space-y-1">
            {searching ? (
              <div className="flex justify-center py-3">
                <Spinner size="sm" />
              </div>
            ) : visibleResults.length === 0 ? (
              <p className="py-2 text-xs text-white/35">No matching players found.</p>
            ) : (
              visibleResults.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-xl border border-white/8 bg-surface-2/50 px-3 py-2">
                  <div>
                    <div className="text-sm text-white">{p.display_name}</div>
                    <div className="text-xs text-white/40">@{p.username}</div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => handleAdd(p.id, p.display_name)}
                    loading={addMember.isPending}
                    disabled={addMember.isPending}
                  >
                    <UserPlus size={13} />
                    Add
                  </Button>
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>
    </Card>
  )
}
