import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import AuthLayout from '../../components/layout/AuthLayout'
import Button from '../../components/ui/Button'
import { useUiStore } from '../../store/uiStore'

const RESEND_COOLDOWN_SECONDS = 30

// Phase 8D, Part 4 — lands here right after signup (config.toml's
// enable_confirmations = true means signUp() never returns a session, so
// SignUp.jsx redirects here rather than to sign-in) and also whenever a
// signed-in-but-unverified user tries a gated action elsewhere in the app.
export default function VerifyEmail() {
  const navigate = useNavigate()
  const addToast = useUiStore((s) => s.addToast)
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  // A signed-in unverified user's own email is the source of truth once
  // they have a session; the query param only covers the pre-session
  // just-signed-up case (see SignUp.jsx's redirect).
  const email = user?.email || searchParams.get('email') || ''
  const redirectTo = searchParams.get('redirect') || '/dashboard'

  const [cooldown, setCooldown] = useState(0)
  const [resending, setResending] = useState(false)
  const resendGuard = useRef(false)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000)
    return () => clearInterval(t)
  }, [cooldown])

  // If the user already verified (e.g. clicked the email link in another
  // tab) and this tab's session refreshes, move them on automatically.
  useEffect(() => {
    if (user?.email_confirmed_at) {
      navigate(redirectTo, { replace: true })
    }
  }, [user, redirectTo, navigate])

  async function handleResend() {
    if (resendGuard.current || cooldown > 0 || !email) return
    resendGuard.current = true
    setResending(true)
    const { error } = await supabase.auth.resend({ type: 'signup', email })
    setResending(false)
    resendGuard.current = false

    if (error) {
      addToast({ type: 'error', message: error.message })
      return
    }
    addToast({ type: 'success', message: 'Verification email sent.' })
    setCooldown(RESEND_COOLDOWN_SECONDS)
  }

  return (
    <AuthLayout title="Check your email" subtitle="You're almost there.">
      <div className="flex flex-col items-center text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10">
          <MailCheck size={26} className="text-accent" />
        </div>
        <p className="mt-4 text-sm text-white/70">
          We sent a verification link to
        </p>
        <p className="mt-1 break-all text-sm font-semibold text-white">{email || 'your email address'}</p>
        <p className="mt-4 text-sm text-white/50">
          Click the link in that email to verify your account. You won't be able to create or join
          pots, or submit picks, until you do.
        </p>
      </div>

      <div className="mt-6 space-y-3">
        <Button
          type="button"
          variant="secondary"
          fullWidth
          loading={resending}
          disabled={resending || cooldown > 0 || !email}
          onClick={handleResend}
        >
          {cooldown > 0 ? `Resend email (${cooldown}s)` : 'Resend verification email'}
        </Button>

        <p className="text-center text-xs text-white/40">
          Didn't get it? Check your spam folder, or{' '}
          <Link to={`/sign-up${email ? `?email=${encodeURIComponent(email)}` : ''}`} className="text-accent hover:text-accent-muted">
            use a different email
          </Link>.
        </p>
      </div>

      <div className="mt-6 border-t border-white/8 pt-4 text-center text-sm">
        <Link to="/sign-in" className="text-white/50 hover:text-white">Back to sign in</Link>
      </div>
    </AuthLayout>
  )
}
