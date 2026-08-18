import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import AuthLayout from '../../components/layout/AuthLayout'
import Button from '../../components/ui/Button'
import { useUiStore } from '../../store/uiStore'

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

  async function handleSubmit(e) {
    e.preventDefault()
    if (loading) return
    setLoading(true)

    const { data, error } = await supabase.auth.signUp({
      email: form.email.trim().toLowerCase(),
      password: form.password,
      options: {
        data: {
          display_name: form.display_name.trim(),
        },
      },
    })

    setLoading(false)

    if (error) {
      addToast({ type: 'error', message: error.message })
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

        <Button type="submit" fullWidth loading={loading} disabled={loading}>Create account</Button>
      </form>

      <div className="mt-4 text-sm">
        <Link to={`/sign-in${redirectQuery}`} className="text-accent hover:text-accent-muted">
          Already have an account? Sign in
        </Link>
      </div>
    </AuthLayout>
  )
}
