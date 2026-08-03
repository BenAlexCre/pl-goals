import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Users, PlusCircle, ChevronDown } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import Card from '../ui/Card'
import Button from '../ui/Button'
import EmptyState from '../ui/EmptyState'
import Spinner from '../ui/Spinner'
import Toast from '../ui/Toast'

export default function PotManager() {
  const [pots, setPots] = useState([])
  const [leagues, setLeagues] = useState([])
  const [name, setName] = useState('')
  const [leagueId, setLeagueId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  async function loadPots() {
    const { data, error } = await supabase
      .from('pot_members')
      .select(`
        pot_id,
        role,
        pots (
          id,
          name,
          status,
          season_id,
          league_id,
          created_by,
          seasons (
            id,
            name,
            year_start,
            year_end
          ),
          leagues (
            id,
            name,
            country
          )
        )
      `)
      .order('joined_at', { ascending: false })

    if (error) throw error
    setPots(data || [])
  }

  async function loadLeagues() {
    const { data, error } = await supabase
      .from('leagues')
      .select(`
        id,
        name,
        country,
        season_id,
        is_active,
        seasons (
          id,
          name,
          year_start,
          year_end,
          is_current
        )
      `)
      .eq('is_active', true)
      .order('name', { ascending: true })

    if (error) throw error

    const rows = Array.isArray(data) ? data : []

    rows.sort((a, b) => {
      const aCurrent = a.seasons?.is_current ? 1 : 0
      const bCurrent = b.seasons?.is_current ? 1 : 0
      if (aCurrent !== bCurrent) return bCurrent - aCurrent
      return a.name.localeCompare(b.name)
    })

    setLeagues(rows)
  }

  const selectedLeague = useMemo(
    () => leagues.find((league) => String(league.id) === String(leagueId)) || null,
    [leagues, leagueId]
  )

  useEffect(() => {
    async function init() {
      try {
        setLoading(true)
        setErrorMessage('')
        await Promise.all([loadPots(), loadLeagues()])
      } catch (err) {
        setErrorMessage(err.message || 'Failed to load pot setup data')
      } finally {
        setLoading(false)
      }
    }

    init()
  }, [])

  async function handleCreatePot(e) {
    e.preventDefault()

    const trimmedName = name.trim()

    if (!trimmedName) {
      setErrorMessage('Pot name is required')
      return
    }

    if (!selectedLeague) {
      setErrorMessage('Select a league/tournament')
      return
    }

    try {
      setSaving(true)
      setMessage('')
      setErrorMessage('')

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError) throw userError
      if (!user) throw new Error('You must be signed in')

      const { data: newPotRows, error: potError } = await supabase
        .from('pots')
        .insert([
          {
            name: trimmedName,
            season_id: selectedLeague.season_id,
            league_id: selectedLeague.id,
            status: 'active',
            created_by: user.id,
          },
        ])
        .select()

      if (potError) throw potError
      if (!newPotRows?.length) throw new Error('Pot was not created')

      const newPot = newPotRows[0]

      const { error: memberError } = await supabase
        .from('pot_members')
        .insert([
          {
            pot_id: newPot.id,
            user_id: user.id,
            role: 'admin',
          },
        ])

      if (memberError) throw memberError

      setName('')
      setLeagueId('')
      setMessage('Pot created successfully')
      await loadPots()
    } catch (err) {
      setErrorMessage(err.message || 'Failed to create pot')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-white/6 bg-gradient-to-br from-surface-1 to-surface-3 p-6">
        <div className="mb-3 flex items-center gap-3">
          <Users className="text-white" size={22} />
          <h1 className="text-3xl font-bold text-white">Pots</h1>
        </div>
        <p className="max-w-2xl text-white/45">
          Create a private pot, become the admin, and start inviting members.
        </p>
      </section>

      <section>
        <Card className="p-5">
          <h2 className="mb-4 text-lg font-semibold text-white">Create pot</h2>

          <form onSubmit={handleCreatePot} className="space-y-4">
            <div>
              <label className="mb-2 block text-sm text-white/70">Pot name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Office pool"
                className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white placeholder:text-white/25 outline-none transition-colors focus:border-accent/50"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-white/70">League / tournament</label>
              <div className="relative">
                <select
                  value={leagueId}
                  onChange={(e) => setLeagueId(e.target.value)}
                  className="w-full appearance-none rounded-xl border border-white/10 bg-surface-2 px-4 py-3 pr-12 text-white outline-none transition-colors focus:border-accent/50"
                >
                  <option value="">Select a league/tournament</option>
                  {leagues.map((league) => (
                    <option key={league.id} value={league.id}>
                      {league.name}
                      {league.country ? ` (${league.country})` : ''}
                      {league.seasons?.is_current ? ' — Current' : ''}
                    </option>
                  ))}
                </select>

                <ChevronDown
                  size={18}
                  className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-white/45"
                />
              </div>

              {selectedLeague ? (
                <p className="mt-2 text-xs text-white/45">
                  Season: {selectedLeague.seasons?.name || 'Unknown'}
                </p>
              ) : null}
            </div>

            <Button type="submit" disabled={saving} className="inline-flex items-center gap-2">
              <PlusCircle size={16} />
              {saving ? 'Creating...' : 'Create pot'}
            </Button>
          </form>
        </Card>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Your pots</h2>
          <span className="text-sm text-white/45">{pots.length} total</span>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : pots.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No pots yet"
            description="Create your first pot to get started."
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {pots.map((row) => (
              <Link key={row.pot_id} to={`/pot/${row.pot_id}`}>
                <Card hover className="h-full p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-white">
                        {row.pots?.name || 'Unnamed pot'}
                      </h3>
                      <p className="mt-1 text-sm text-white/35">Role: {row.role}</p>
                    </div>
                    <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/70">
                      {row.pots?.status || 'unknown'}
                    </span>
                  </div>

                  <div className="mt-4 space-y-1 text-sm text-white/40">
                    <div>League / tournament: {row.pots?.leagues?.name || '-'}</div>
                    <div>Season: {row.pots?.seasons?.name || '-'}</div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      {message ? <Toast message={message} type="success" /> : null}
      {errorMessage ? <Toast message={errorMessage} type="error" /> : null}
    </div>
  )
}