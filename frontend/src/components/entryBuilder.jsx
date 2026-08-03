import React, { useEffect, useMemo, useState } from 'react'
import {
  getCurrentOrUpcomingGameweeks,
  getAvailablePlayersByGameweek,
  getOrCreateEntry,
  getEntryWithPicks,
  saveEntryPicks,
  submitEntry,
} from '../lib/gameApi'

export function EntryBuilder({ potId }) {
  const [gameweeks, setGameweeks] = useState([])
  const [selectedGameweekId, setSelectedGameweekId] = useState(null)
  const [entry, setEntry] = useState(null)
  const [players, setPlayers] = useState([])
  const [selectedPlayers, setSelectedPlayers] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    async function init() {
      try {
        setLoading(true)
        const gw = await getCurrentOrUpcomingGameweeks()
        setGameweeks(gw)
        if (gw.length) setSelectedGameweekId(gw[0].id)
      } catch (err) {
        setMessage(err.message || 'Failed to load gameweeks')
      } finally {
        setLoading(false)
      }
    }

    init()
  }, [])

  useEffect(() => {
    async function loadEntryFlow() {
      if (!selectedGameweekId) return

      try {
        setLoading(true)
        const nextEntry = await getOrCreateEntry(potId, selectedGameweekId)
        const hydratedEntry = await getEntryWithPicks(nextEntry.id)
        const available = await getAvailablePlayersByGameweek(selectedGameweekId)

        setEntry(hydratedEntry)
        setPlayers(available)

        const existing = [...(hydratedEntry.user_entry_picks || [])]
          .sort((a, b) => a.pick_position - b.pick_position)
          .map((p) => p.player_id)

        setSelectedPlayers(existing)
        setMessage('')
      } catch (err) {
        setMessage(err.message || 'Failed to load entry')
      } finally {
        setLoading(false)
      }
    }

    loadEntryFlow()
  }, [potId, selectedGameweekId])

  const filteredPlayers = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return players

    return players.filter(
      (player) =>
        player.display_name.toLowerCase().includes(q) ||
        player.team_name.toLowerCase().includes(q)
    )
  }, [players, search])

  function togglePlayer(playerId) {
    if (entry?.status !== 'pending') return

    setSelectedPlayers((prev) => {
      if (prev.includes(playerId)) {
        return prev.filter((id) => id !== playerId)
      }
      if (prev.length >= 5) return prev
      return [...prev, playerId]
    })
  }

  async function handleSave() {
    if (!entry) return

    if (selectedPlayers.length !== 5) {
      setMessage('Select exactly 5 players')
      return
    }

    try {
      setSaving(true)
      await saveEntryPicks(entry.id, selectedPlayers)
      const refreshed = await getEntryWithPicks(entry.id)
      setEntry(refreshed)
      setMessage('Picks saved')
    } catch (err) {
      setMessage(err.message || 'Failed to save picks')
    } finally {
      setSaving(false)
    }
  }

  async function handleSubmit() {
    if (!entry) return

    try {
      setSaving(true)
      await handleSave()
      await submitEntry(entry.id)
      const refreshed = await getEntryWithPicks(entry.id)
      setEntry(refreshed)
      setMessage('Entry submitted')
    } catch (err) {
      setMessage(err.message || 'Failed to submit entry')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div>Loading…</div>

  return (
    <div>
      <h2>Build entry</h2>

      <label>
        Gameweek
        <select
          value={selectedGameweekId ?? ''}
          onChange={(e) => setSelectedGameweekId(Number(e.target.value))}
        >
          {gameweeks.map((gw) => (
            <option key={gw.id} value={gw.id}>
              {gw.name} ({gw.status})
            </option>
          ))}
        </select>
      </label>

      <div style={{ marginTop: 12 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search players or teams"
        />
      </div>

      <div style={{ marginTop: 12 }}>
        <strong>Selected:</strong> {selectedPlayers.length}/5
      </div>

      <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
        {filteredPlayers.map((player) => {
          const active = selectedPlayers.includes(player.player_id)

          return (
            <button
              key={player.player_id}
              type="button"
              onClick={() => togglePlayer(player.player_id)}
              disabled={entry?.status !== 'pending'}
              style={{
                textAlign: 'left',
                padding: 12,
                border: '1px solid #ccc',
                background: active ? '#e8f5e9' : '#fff',
              }}
            >
              <div>
                <strong>{player.display_name}</strong>
              </div>
              <div>{player.team_name}</div>
              <div>{player.position ?? 'Unknown position'}</div>
            </button>
          )
        })}
      </div>

      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button onClick={handleSave} disabled={saving || entry?.status !== 'pending'}>
          Save picks
        </button>
        <button onClick={handleSubmit} disabled={saving || entry?.status !== 'pending'}>
          Submit entry
        </button>
      </div>

      {entry && (
        <div style={{ marginTop: 16 }}>
          <div>Status: {entry.status}</div>
          <div>Submitted: {entry.submitted_at || 'Not yet'}</div>
        </div>
      )}

      {message && <p style={{ marginTop: 12 }}>{message}</p>}
    </div>
  )
}