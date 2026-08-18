import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import AuthLayout from '../../components/layout/AuthLayout'
import Button from '../../components/ui/Button'

// Phase 8D, Part 1/14 — rewritten on the shared AuthLayout, matching
// SignUp.jsx/ForgotPassword.jsx's existing design system (Card/Button/
// Tailwind) instead of this file's previous standalone inline-style
// prototype. The old internal signin/signup mode toggle is removed
// entirely — it was a second, divergent implementation of signup
// (no display_name field, different validation, different copy) living
// alongside the real /sign-up page; consolidating to one signup surface is
// the literal "duplicate auth form" Part 14 asks to remove.
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

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    setLoading(false)
    if (error) {
      setError(error.message || 'Something went wrong')
      return
    }
    navigate(redirectTo, { replace: true })
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
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-xl bg-surface-2 border border-white/8 px-4 py-3 outline-none focus:border-accent/40"
          />
        </div>

        <div>
          <label className="block text-sm text-white/70 mb-1" htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            className="w-full rounded-xl bg-surface-2 border border-white/8 px-4 py-3 outline-none focus:border-accent/40"
          />
        </div>

        {error ? (
          <div role="alert" className="rounded-xl border border-red-goal/25 bg-red-goal/10 p-3 text-sm text-red-goal">
            {error}
          </div>
        ) : null}

        <Button type="submit" fullWidth loading={loading} disabled={loading}>Sign in</Button>
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
