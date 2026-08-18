import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import AuthLayout from '../../components/layout/AuthLayout'
import Button from '../../components/ui/Button'
import { humanizeAuthError, AUTH_NETWORK_ERROR_MESSAGE } from '../../utils/authErrors'

// Phase 8D, Part 1/14 — rewritten on the shared AuthLayout, matching
// SignUp.jsx/ForgotPassword.jsx's existing design system (Card/Button/
// Tailwind) instead of this file's previous standalone inline-style
// prototype. The old internal signin/signup mode toggle is removed
// entirely — it was a second, divergent implementation of signup
// (no display_name field, different validation, different copy) living
// alongside the real /sign-up page; consolidating to one signup surface is
// the literal "duplicate auth form" Part 14 asks to remove.
//
// Phase 13 — ISSUE-55. `handleSubmit` previously had no try/catch around
// `signInWithPassword()`. auth-js only ever RETHROWS (rather than
// resolving with `{ error }`) for a non-AuthError exception — a genuine
// network/infrastructure failure, not a wrong password (confirmed by
// reading auth-js's own source). With no catch, that exception was an
// unhandled rejection: `setLoading(false)` was never reached, so the
// button stayed stuck on "Signing in..." forever with zero error shown —
// exactly the silent failure reported. Root-caused live: this
// environment's own GoTrue<->Postgres connection blipped mid-session
// (real "failed SASL auth: i/o timeout" / DNS resolution errors in the
// auth container's own logs) while a real password sign-in was in
// flight, hitting this exact path. The account itself
// (benalexcre@gmail.com) was never the problem — confirmed via direct
// `auth.users` inspection: not banned, email confirmed, correct
// `super_admin` claim, password hash present — and GoTrue's own audit
// log shows several fully successful `grant_type=password` 200s for it
// around the same window, meaning the credentials were correct the whole
// time.
export default function SignIn() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // Preserves a pending /join/:inviteCode destination through sign-in —
  // otherwise a signed-out visitor clicking an invite link would land back
  // on /dashboard with no way to finish joining.
  const redirectTo = searchParams.get('redirect') || '/dashboard'
  const redirectQuery = searchParams.get('redirect')
    ? `?redirect=${encodeURIComponent(searchParams.get('redirect'))}`
    : ''

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (mounted && session?.user) navigate(redirectTo, { replace: true })
    })
    return () => {
      mounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    setError('')

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })

      if (signInError) {
        setError(humanizeAuthError(signInError))
        return
      }
      navigate(redirectTo, { replace: true })
    } catch (err) {
      // Never a wrong-password case — see the file-level note above.
      // Still logged in full for local debugging; never shown to the
      // user verbatim.
      console.error('Sign-in request failed', err)
      setError(AUTH_NETWORK_ERROR_MESSAGE)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout title="Sign in" subtitle="Sign in to view your pots, picks, and live scores.">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label className="block text-sm text-white/70 mb-1" htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            aria-invalid={!!error}
            className="w-full rounded-xl bg-surface-2 border border-white/8 px-4 py-3 outline-none focus:border-accent/40"
          />
        </div>

        <div>
          <label className="block text-sm text-white/70 mb-1" htmlFor="password">Password</label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              aria-invalid={!!error}
              aria-describedby={error ? 'sign-in-error' : undefined}
              className="w-full rounded-xl bg-surface-2 border border-white/8 px-4 py-3 pr-11 outline-none focus:border-accent/40"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              tabIndex={-1}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-white/35 hover:text-white/70"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {error ? (
          <div id="sign-in-error" role="alert" className="rounded-xl border border-red-goal/25 bg-red-goal/10 p-3 text-sm text-red-goal">
            {error}
          </div>
        ) : null}

        <Button type="submit" fullWidth loading={loading} disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <div className="mt-4 space-y-2 text-sm">
        <Link
          to={email.trim() ? `/forgot-password?email=${encodeURIComponent(email.trim())}` : '/forgot-password'}
          className="block text-white/50 hover:text-white"
        >
          Forgot password?
        </Link>
        <Link to={`/sign-up${redirectQuery}`} className="block text-accent hover:text-accent-muted">
          Don't have an account? Create one
        </Link>
      </div>
    </AuthLayout>
  )
}
