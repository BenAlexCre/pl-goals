import { useState } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import { ArrowLeft, Trophy, LogIn } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useRedeemInvite } from '../hooks/useMembership'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import Spinner from '../components/ui/Spinner'

// Public route (outside ProtectedRoute/AppShell) — a real invite link must
// work for someone who isn't signed in yet, not just an existing member.
// Membership is immediate on redeem (MVP decision, no pending/invitation
// state — see decisions.md § Member invitations). pots itself isn't
// readable pre-membership (pots_select_member/"users can view pots they
// belong to" both require an existing pot_members row), so there's no pot
// name/preview to show before joining — the redirect after a successful
// join is what shows the player what they joined.
export default function JoinPot() {
  const { inviteCode: inviteCodeParam } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { user, loading: authLoading } = useAuth()
  const redeemInvite = useRedeemInvite()

  // Phase 12, Part 13 — this screen previously had no way back at all
  // (confirmed live: no header, no link, browser back only). Prefers the
  // actual page that linked here (Dashboard's Quick Actions passes
  // `state={{ from: '/dashboard' }}`) over a guessed destination; falls
  // back to Dashboard for a signed-in visitor or the landing page for a
  // signed-out one arriving via a raw invite URL, since neither has a
  // real "origin" to return to.
  const backTo = location.state?.from || (user ? '/dashboard' : '/')
  const backLabel = backTo === '/pots' ? 'Back to Pots' : backTo === '/dashboard' ? 'Back to Dashboard' : 'Back to home'

  const [code, setCode] = useState(inviteCodeParam || '')
  const [error, setError] = useState('')
  const [joined, setJoined] = useState(false)

  const redirectPath = `/join${inviteCodeParam ? `/${inviteCodeParam}` : ''}`

  async function handleJoin(e) {
    e.preventDefault()
    setError('')

    if (!code.trim()) {
      setError('Enter an invite code')
      return
    }

    try {
      const result = await redeemInvite.mutateAsync(code)
      setJoined(true)
      setTimeout(() => navigate(`/pot/${result.potId}`, { replace: true }), 900)
    } catch (err) {
      setError(err.message || 'Could not join with that invite code')
    }
  }

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-pitch-950">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-pitch-950 px-4">
      <div className="w-full max-w-md">
        <Link to={backTo} className="mb-3 inline-flex items-center gap-1.5 text-sm text-white/50 transition-colors hover:text-white">
          <ArrowLeft size={14} />
          {backLabel}
        </Link>
        <Card className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10">
            <Trophy size={20} className="text-white" />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-white/40">You're invited</div>
            <h1 className="text-xl font-bold text-white">Join a pot</h1>
          </div>
        </div>

        {!user ? (
          <>
            <p className="mb-5 text-sm text-white/50">
              Sign in or create an account to join this pot{inviteCodeParam ? ' with your invite code' : ''}.
            </p>
            <div className="flex gap-2">
              <Link to={`/sign-in?redirect=${encodeURIComponent(redirectPath)}`} className="flex-1">
                <Button fullWidth variant="primary">
                  <LogIn size={15} />
                  Sign in
                </Button>
              </Link>
              <Link to={`/sign-up?redirect=${encodeURIComponent(redirectPath)}`} className="flex-1">
                <Button fullWidth variant="secondary">
                  Create account
                </Button>
              </Link>
            </div>
          </>
        ) : joined ? (
          <div className="rounded-xl border border-accent/30 bg-accent/10 p-4 text-sm text-accent">
            You're in! Taking you to the pot...
          </div>
        ) : (
          <form onSubmit={handleJoin} className="space-y-4">
            <div>
              <label className="mb-2 block text-sm text-white/70" htmlFor="join-code">Invite code</label>
              <input
                id="join-code"
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="e.g. AB3D9F2K"
                autoFocus
                className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 font-mono text-white outline-none tracking-wider placeholder:text-white/25 focus:border-accent/50"
              />
            </div>

            {error ? (
              <div className="rounded-xl border border-red-goal/25 bg-red-goal/10 p-3 text-sm text-red-goal">
                {error}
              </div>
            ) : null}

            <Button type="submit" fullWidth loading={redeemInvite.isPending} disabled={redeemInvite.isPending}>
              Join pot
            </Button>
          </form>
        )}
        </Card>
      </div>
    </div>
  )
}
