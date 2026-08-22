import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import AuthLayout from '../../components/layout/AuthLayout'
import Button from '../../components/ui/Button'
import { humanizeAuthError, AUTH_NETWORK_ERROR_MESSAGE } from '../../utils/authErrors'

export default function ForgotPassword() {
  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState(searchParams.get('email') || '')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  // Phase 13 — ISSUE-55's same bug class: no try/catch left this button
  // stuck on a network-level failure with no feedback.
  async function handleSubmit(e) {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    setError('')
    try {
      // Live-review fix (item 14) — was /sign-in, which has no password
      // form at all; a recovering user landed there fully signed in (the
      // recovery link's own token) with no way to actually change their
      // password. /reset-password is the dedicated page for that.
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (resetError) {
        setError(humanizeAuthError(resetError))
        return
      }
      setSent(true)
    } catch (err) {
      console.error('Password reset request failed', err)
      setError(AUTH_NETWORK_ERROR_MESSAGE)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout title="Reset password" subtitle="We'll send you a reset link.">
      {sent ? (
        <div className="rounded-xl border border-accent/30 bg-accent/10 p-4 text-sm text-accent">
          If an account exists for {email.trim()}, a password reset link is on its way.
        </div>
      ) : (
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
              className="w-full rounded-xl bg-surface-2 border border-white/8 px-4 py-3 outline-none focus:border-accent/40"
            />
          </div>
          {error ? (
            <div role="alert" className="rounded-xl border border-red-goal/25 bg-red-goal/10 p-3 text-sm text-red-goal">
              {error}
            </div>
          ) : null}

          <Button type="submit" fullWidth loading={loading} disabled={loading}>
            {loading ? 'Sending…' : 'Send reset email'}
          </Button>
        </form>
      )}

      <div className="mt-4 text-sm">
        <Link to="/sign-in" className="text-accent hover:text-accent-muted">Back to sign in</Link>
      </div>
    </AuthLayout>
  )
}
