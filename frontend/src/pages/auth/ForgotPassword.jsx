import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import { useUiStore } from '../../store/uiStore'

export default function ForgotPassword() {
  const addToast = useUiStore((s) => s.addToast)
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/sign-in`,
    })
    setLoading(false)

    if (error) {
      addToast({ type: 'error', message: error.message })
      return
    }
    addToast({ type: 'success', message: 'Password reset email sent.' })
  }

  return (
    <div className="min-h-screen bg-pitch-950 flex items-center justify-center px-4">
      <Card className="w-full max-w-md p-6">
        <h1 className="text-2xl font-bold text-white">Reset password</h1>
        <p className="text-sm text-white/40 mt-1">We’ll send you a reset link.</p>

        <form onSubmit={handleSubmit} className="space-y-4 mt-6">
          <div>
            <label className="block text-sm text-white/70 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl bg-surface-2 border border-white/8 px-4 py-3 outline-none focus:border-accent/40"
            />
          </div>
          <Button fullWidth loading={loading}>Send reset email</Button>
        </form>

        <div className="mt-4 text-sm">
          <Link to="/sign-in" className="text-accent hover:text-accent-muted">Back to sign in</Link>
        </div>
      </Card>
    </div>
  )
}