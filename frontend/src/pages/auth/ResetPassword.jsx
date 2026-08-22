import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import AuthLayout from '../../components/layout/AuthLayout'
import Button from '../../components/ui/Button'
import { humanizeAuthError, AUTH_NETWORK_ERROR_MESSAGE } from '../../utils/authErrors'

// Live-review fix (item 14) — ForgotPassword.jsx's resetPasswordForEmail()
// sends a real recovery link, and clicking it does establish a valid
// session (detectSessionInUrl processes the recovery token), but no route
// anywhere in the app ever called supabase.auth.updateUser({ password })
// — a recovering user had a session and nowhere to actually set a new
// password. This page is that missing step. It works purely off the
// session detectSessionInUrl already established (the recovery link's
// redirect_to now points here instead of /sign-in), not off any
// recovery-specific token of its own.
export default function ResetPassword() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (loading) return
    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    setLoading(true)
    setError('')
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        setError(humanizeAuthError(updateError))
        return
      }
      setDone(true)
      setTimeout(() => navigate('/dashboard', { replace: true }), 1500)
    } catch (err) {
      console.error('Password update failed', err)
      setError(AUTH_NETWORK_ERROR_MESSAGE)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout title="Set a new password" subtitle="Choose a new password for your account.">
      {done ? (
        <div className="rounded-xl border border-accent/30 bg-accent/10 p-4 text-sm text-accent">
          Password updated. Taking you to your dashboard…
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label className="block text-sm text-white/70 mb-1" htmlFor="password">New password</label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl bg-surface-2 border border-white/8 px-4 py-3 outline-none focus:border-accent/40"
            />
          </div>
          <div>
            <label className="block text-sm text-white/70 mb-1" htmlFor="confirmPassword">Confirm new password</label>
            <input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-xl bg-surface-2 border border-white/8 px-4 py-3 outline-none focus:border-accent/40"
            />
          </div>
          {error ? (
            <div role="alert" className="rounded-xl border border-red-goal/25 bg-red-goal/10 p-3 text-sm text-red-goal">
              {error}
            </div>
          ) : null}

          <Button type="submit" fullWidth loading={loading} disabled={loading}>
            {loading ? 'Updating…' : 'Update password'}
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
