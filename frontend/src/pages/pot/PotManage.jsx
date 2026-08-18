import { Link, useLocation, useParams } from 'react-router-dom'
import { ArrowLeft, Trophy, Shield, Target, CreditCard, CheckCircle2, X } from 'lucide-react'
import { useState } from 'react'
import Card from '../../components/ui/Card'
import Badge from '../../components/ui/Badge'
import Spinner from '../../components/ui/Spinner'
import InviteCard from '../../components/pot/InviteCard'
import MemberList from '../../components/pot/MemberList'
import { usePot } from '../../hooks/usePots'
import { useAuthStore } from '../../store/authStore'
import { formatSeasonName } from '../../utils/format'

const GAME_TYPE_META = {
  pick5: { label: 'Pick 5', icon: Trophy },
  last_man_standing: { label: 'Last Man Standing', icon: Shield },
  score_predictor: { label: 'Score Predictor', icon: Target },
}

// Phase 10B, Part 2/12 — the destination "Manage" links across the pot
// pages now point to, instead of straight into the cross-pot
// /admin/payments tool. Hosts exactly the membership-administration
// pieces that used to sit inline on the main competition page
// (InviteCard, MemberList — both reused completely unmodified, no new
// membership mechanism) so that page can stay focused on actually
// playing the competition. Payment verification itself stays a separate,
// cross-pot admin surface (linked below) — not duplicated here.
//
// Membership itself isn't secret to fellow members (every pot page
// already shows a member list to any member), so a non-admin landing
// here sees the member list read-only rather than a hard block —
// InviteCard/removal are still admin-only, same as before.
export default function PotManage() {
  const { potId } = useParams()
  const location = useLocation()
  const { user } = useAuthStore()
  const { data: pot, isLoading } = usePot(potId)
  const [dismissedBanner, setDismissedBanner] = useState(false)

  const justCreated = location.state?.justCreated && !dismissedBanner

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="lg" />
      </div>
    )
  }

  if (!pot) {
    return (
      <div className="space-y-6">
        <Link to="/pots" className="inline-flex items-center gap-1.5 text-sm text-white/50 hover:text-white">
          <ArrowLeft size={14} />
          Back to Pots
        </Link>
        <p className="text-white/45">This pot could not be found.</p>
      </div>
    )
  }

  const members = pot.pot_members ?? []
  const isPotAdmin = members.some((m) => m.user_id === user?.id && m.role === 'admin')
  const meta = GAME_TYPE_META[pot.game_type] ?? GAME_TYPE_META.pick5
  const Icon = meta.icon

  return (
    <div className="space-y-6">
      <Link to={`/pot/${potId}`} className="inline-flex items-center gap-1.5 text-sm text-white/50 hover:text-white">
        <ArrowLeft size={14} />
        Back to {pot.name}
      </Link>

      {/* Phase 10B, Part 13 — the create-pot flow's own "you're here, now
          invite players" confirmation. Secondary/dismissible, not a modal
          — the page itself (landing directly on Manage with InviteCard
          right below) is the primary confirmation. */}
      {justCreated ? (
        <div className="flex items-start justify-between gap-3 rounded-2xl border border-accent/25 bg-accent/10 p-4">
          <div className="flex items-start gap-2.5">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-accent" />
            <div>
              <p className="text-sm font-semibold text-white">{pot.name} is ready</p>
              <p className="mt-0.5 text-sm text-white/60">Generate an invite code or add players by username to get started.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setDismissedBanner(true)}
            aria-label="Dismiss"
            className="shrink-0 rounded-lg p-1 text-white/40 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>
      ) : null}

      <section className="rounded-3xl border border-white/6 bg-gradient-to-br from-surface-1 to-surface-3 p-6">
        <div className="mb-2 flex items-center gap-2">
          <Badge status="member">{meta.label}</Badge>
          <Badge status={pot.status}>{pot.status}</Badge>
        </div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-white sm:text-3xl">
          <Icon size={24} />
          Manage {pot.name}
        </h1>
        <p className="mt-1 text-sm text-white/45">
          {pot.leagues?.name} · {formatSeasonName(pot.seasons)}
        </p>
      </section>

      {isPotAdmin ? (
        <InviteCard
          potId={potId}
          inviteCode={pot.invite_code}
          existingMemberIds={new Set(members.map((m) => m.user_id))}
        />
      ) : null}

      <MemberList potId={potId} members={members} isAdmin={isPotAdmin} />

      {isPotAdmin ? (
        <Card className="p-5">
          <h3 className="mb-1 text-sm font-semibold text-white">Payments</h3>
          <p className="mb-4 text-sm text-white/45">Verify who's paid for this competition, individually or via CSV import.</p>
          <Link
            to="/admin/payments"
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-white/70 transition-colors hover:text-white"
          >
            <CreditCard size={15} />
            Open payment verification
          </Link>
        </Card>
      ) : null}
    </div>
  )
}
