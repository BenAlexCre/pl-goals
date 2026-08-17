import { CheckCircle2, CreditCard, Lock, XCircle } from 'lucide-react'
import Button from '../../ui/Button'
import PickCard from './PickCard'

function Chip({ icon: Icon, label, tone }) {
  const tones = {
    success: 'bg-accent/15 text-accent',
    warning: 'bg-amber/15 text-amber',
    danger: 'bg-red-goal/15 text-red-goal',
    neutral: 'bg-white/8 text-white/50',
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${tones[tone]}`}>
      <Icon size={11} />
      {label}
    </span>
  )
}

export default function MemberCard({ member, isAdmin, deadlineClosed, onRemove }) {
  const displayName = member.member?.profiles?.display_name || member.member?.profiles?.username || 'User'
  const username = member.member?.profiles?.username || 'unknown'
  const isLocked = member.entryStatus === 'locked' || member.entryStatus === 'settled'
  const canRevealPicks = deadlineClosed && member.picks.length > 0

  return (
    <div className="rounded-2xl border border-white/8 bg-surface-1 p-4 transition-colors hover:border-white/15">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-3 text-sm font-semibold text-white/70">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium text-white">{displayName}</p>
            <p className="truncate text-xs text-white/40">@{username}{member.member.role === 'admin' ? ' · Admin' : ''}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Chip
            icon={member.isPaid ? CheckCircle2 : CreditCard}
            label={member.isPaid ? 'Paid' : 'Unpaid'}
            tone={member.isPaid ? 'success' : 'danger'}
          />
          <Chip
            icon={member.hasEntry ? CheckCircle2 : XCircle}
            label={member.hasEntry ? 'Submitted' : 'Not submitted'}
            tone={member.hasEntry ? 'success' : 'neutral'}
          />
          {isLocked && <Chip icon={Lock} label="Locked" tone="neutral" />}

          {isAdmin ? (
            <Button type="button" size="sm" variant="ghost" onClick={onRemove} aria-label={`Remove ${displayName}`}>
              Remove
            </Button>
          ) : null}
        </div>
      </div>

      {deadlineClosed ? (
        canRevealPicks ? (
          <div className="mt-4 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {member.picks.map((pick) => (
              <PickCard
                key={pick.id}
                pickNumber={pick.pick_position}
                displayName={pick.display_name}
                teamName={pick.team_name || pick.team_short_name}
                crestUrl={pick.crest_url}
                position={pick.position}
              />
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-white/40">No picks saved for this round.</p>
        )
      ) : (
        <p className="mt-3 text-sm text-white/40">Picks will be revealed when the deadline has passed.</p>
      )}
    </div>
  )
}
