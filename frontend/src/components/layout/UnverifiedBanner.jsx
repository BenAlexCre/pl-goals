import { Link } from 'react-router-dom'
import { MailWarning } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'

// Phase 8D, Part 4/5 — UX layer only, not the enforcement boundary (that's
// the backend: migration 027's RLS/redeem_invite() checks and
// requireVerifiedActiveUser() in the six competition Edge Functions).
// Deliberately non-blocking: dashboard/profile/browsing stay available,
// matching Part 5's literal restriction list ("cannot join a pot, create a
// pot, submit picks/predictions") rather than locking the whole app.
export default function UnverifiedBanner() {
  const { user } = useAuth()
  if (!user || user.email_confirmed_at) return null

  return (
    <div className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-200">
      <div className="mx-auto flex max-w-7xl items-center gap-2">
        <MailWarning size={16} className="shrink-0" />
        <span>
          Verify your email to create or join pots and submit picks.{' '}
          <Link to={`/verify-email?email=${encodeURIComponent(user.email ?? '')}`} className="font-semibold underline underline-offset-2 hover:text-white">
            Verify now
          </Link>
        </span>
      </div>
    </div>
  )
}
