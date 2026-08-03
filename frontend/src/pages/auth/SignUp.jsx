import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import { useUiStore } from '../../store/uiStore'

export default function SignUp() {
  const navigate = useNavigate()
  const addToast = useUiStore((s) => s.addToast)

  const [form, setForm] = useState({
    display_name: '',
    email: '',
    password: '',
  })
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
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
      addToast({ type: 'success', message: 'Account created. You are now signed in.' })
      navigate('/dashboard', { replace: true })
    } else {
      addToast({
        type: 'success',
        message: 'Account created. Check your email if confirmation is enabled.',
      })
      navigate('/sign-in', { replace: true })
    }
  }

  return (
    <div className="min-h-screen bg-pitch-950 flex items-center justify-center px-4">
      <Card className="w-full max-w-md p-6">
        <h1 className="text-2xl font-bold text-white">Create account</h1>
        <p className="text-sm text-white/40 mt-1">
          Create your account to join private pots and submit picks.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4 mt-6">
          {[
            ['Display name', 'display_name', 'text'],
            ['Email', 'email', 'email'],
            ['Password', 'password', 'password'],
          ].map(([label, key, type]) => (
            <div key={key}>
              <label className="block text-sm text-white/70 mb-1">{label}</label>
              <input
                type={type}
                required
                value={form[key]}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                className="w-full rounded-xl bg-surface-2 border border-white/8 px-4 py-3 outline-none focus:border-accent/40"
              />
            </div>
          ))}

          <Button fullWidth loading={loading}>Create account</Button>
        </form>

        <div className="mt-4 text-sm">
          <Link to="/sign-in" className="text-accent hover:text-accent-muted">
            Already have an account? Sign in
          </Link>
        </div>
      </Card>
    </div>
  )
}