import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Avatar from '../components/ui/Avatar'
import { useUiStore } from '../store/uiStore'
import { resolveDisplayName } from '../utils/format'

export default function Profile() {
  const { user, profile } = useAuth()
  const addToast = useUiStore((s) => s.addToast)
  const [form, setForm] = useState({
    display_name: '',
    username: '',
    timezone: 'Europe/Dublin',
  })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (profile) {
      setForm({
        display_name: profile.display_name || '',
        username: profile.username || '',
        timezone: profile.timezone || 'Europe/Dublin',
      })
    }
  }, [profile])

  async function saveProfile(e) {
    e.preventDefault()
    setLoading(true)
    const { error } = await supabase
      .from('profiles')
      .update(form)
      .eq('id', user.id)
    setLoading(false)

    if (error) {
      addToast({ type: 'error', message: error.message })
      return
    }
    addToast({ type: 'success', message: 'Profile updated' })
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Card className="p-6">
        <div className="flex items-center gap-4">
          <Avatar user={profile} size="lg" />
          <div>
            {/* Phase 25 — the page's own identity heading now uses the
                same resolveDisplayName() every other part of the app
                shows (TopNav, leaderboards, member lists), instead of the
                generic "Profile" title — email stays visible, but only
                ever as the secondary account-identifier line below, never
                as the primary displayed identity. */}
            <h1 className="text-2xl font-bold text-white">{resolveDisplayName(profile) || 'Profile'}</h1>
            <p className="text-sm text-white/40">{user?.email}</p>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <form onSubmit={saveProfile} className="space-y-4">
          {[
            ['Display name', 'display_name', 'How your name appears to other members — pot leaderboards, member lists, the header. Can be anything (a full name, a nickname).'],
            ['Username', 'username', 'A unique handle others can search for. Letters, numbers and underscores only.'],
            ['Timezone', 'timezone', null],
          ].map(([label, key, help]) => (
            <div key={key}>
              <label className="block text-sm text-white/70 mb-1">{label}</label>
              <input
                value={form[key]}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                className="w-full rounded-xl bg-surface-2 border border-white/8 px-4 py-3 outline-none focus:border-accent/40"
              />
              {help && <p className="mt-1 text-xs text-white/35">{help}</p>}
            </div>
          ))}
          <Button loading={loading}>Save profile</Button>
        </form>
      </Card>
    </div>
  )
}