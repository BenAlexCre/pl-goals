import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import AuthLayout from '../../components/layout/AuthLayout'
import Button from '../../components/ui/Button'
import { useUiStore } from '../../store/uiStore'
import { humanizeAuthError, AUTH_NETWORK_ERROR_MESSAGE } from '../../utils/authErrors'

export default function SignUp() {
  const navigate = useNavigate()
  const addToast = useUiStore((s) => s.addToast)
  const [searchParams] = useSearchParams()
  // Same "preserve a pending /join/:inviteCode destination" reasoning as
  // SignIn.jsx.
  const redirectTo = searchParams.get('redirect') || '/dashboard'
  const redirectQuery = searchParams.get('redirect')
    ? `?redirect=${encodeURIComponent(searchParams.get('redirect'))}`
    : ''

  const [form, setForm] = useState({
    display_name: '',
    email: '',
    password: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Phase 13 — ISSUE-55's same bug class: no try/catch meant a network-
  // level failure (signUp() rethrows exactly like signInWithPassword()
  // for a non-AuthError exception — see authErrors.js) left the button
  // stuck on "Creating account..." forever with no feedback.
  async function handleSubmit(e) {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    setError('')

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: form.email.trim().toLowerCase(),
        password: form.password,
        options: {
          data: {
            display_name: form.display_name.trim(),
          },
          // Live-review fix: this was never set, so the confirmation
          // email's link fell back to whatever the Supabase project's own
          // Auth "Site URL" happens to be configured to — on this project
          // that produced a 404 in production (root-caused: Site URL isn't
          // the live custom domain). Setting it explicitly to this app's
          // own current origin means the link is correct regardless of
          // that dashboard setting, PROVIDED this origin is also in
          // Supabase's Redirect URLs allow-list (Supabase rejects a
          // redirect_to that isn't allow-listed even when the client
          // supplies it — a real, separate dashboard setting, not
          // something this code change can satisfy on its own).
          // `/verify-email` already auto-navigates to the pending
          // `redirect` destination once `email_confirmed_at` appears on
          // the session (see that page's own effect) — the correct
          // landing spot whether the link is opened in the original
          // signup tab or a completely different one (e.g. on a phone).
          emailRedirectTo: `${window.location.origin}/verify-email${redirectQuery}`,
        },
      })

      if (signUpError) {
        setError(humanizeAuthError(signUpError))
        return
      }

      if (data.session) {
        // Phase 8D — local email verification is enabled (config.toml), so
        // this branch is effectively unreachable in this environment
        // (data.session is only ever non-null when Supabase Auth signs a new
        // user straight in, which it doesn't do while confirmations are
        // required) — kept as the correct behavior if verification is ever
        // disabled for a different environment.
        addToast({ type: 'success', message: 'Account created. You are now signed in.' })
        navigate(redirectTo, { replace: true })
      } else {
        navigate(`/verify-email?email=${encodeURIComponent(form.email.trim())}${redirectQuery ? `&redirect=${encodeURIComponent(searchParams.get('redirect'))}` : ''}`, { replace: true })
      }
    } catch (err) {
      console.error('Sign-up request failed', err)
      setError(AUTH_NETWORK_ERROR_MESSAGE)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout title="Create your account" subtitle="Create your account to join private pots and submit picks.">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label className="block text-sm text-white/70 mb-1" htmlFor="display_name">Display name</label>
          <input
            id="display_name"
            type="text"
            autoComplete="nickname"
            required
            maxLength={60}
            value={form.display_name}
            onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
            placeholder="e.g. Alex"
            className="w-full rounded-xl bg-surface-2 border border-white/8 px-4 py-3 outline-none focus:border-accent/40"
          />
          <p className="mt-1 text-xs text-white/40">The name other players will see</p>
        </div>

        <div>
          <label className="block text-sm text-white/70 mb-1" htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            className="w-full rounded-xl bg-surface-2 border border-white/8 px-4 py-3 outline-none focus:border-accent/40"
          />
        </div>

        <div>
          <label className="block text-sm text-white/70 mb-1" htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            className="w-full rounded-xl bg-surface-2 border border-white/8 px-4 py-3 outline-none focus:border-accent/40"
          />
        </div>

        {error ? (
          <div role="alert" className="rounded-xl border border-red-goal/25 bg-red-goal/10 p-3 text-sm text-red-goal">
            {error}
          </div>
        ) : null}

        <Button type="submit" fullWidth loading={loading} disabled={loading}>
          {loading ? 'Creating account…' : 'Create account'}
        </Button>
      </form>

      <div className="mt-4 text-sm">
        <Link to={`/sign-in${redirectQuery}`} className="text-accent hover:text-accent-muted">
          Already have an account? Sign in
        </Link>
      </div>
    </AuthLayout>
  )
}
