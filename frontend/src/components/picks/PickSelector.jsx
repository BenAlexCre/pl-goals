import { useMemo, useState } from 'react'
import PlayerSearch from './PlayerSearch'
import PickSlot from './PickSlot'
import PickSlip from './PickSlip'
import Card from '../ui/Card'
import Badge from '../ui/Badge'
import Button from '../ui/Button'

export default function PickSelector({
  players = [],
  value = [],
  onChange,
  locked = false,
  deadlinePassed = false,
  onSubmit,
  submitting = false,
}) {
  const [search, setSearch] = useState('')

  const filteredPlayers = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return players
    return players.filter((p) =>
      p.display_name.toLowerCase().includes(q) ||
      p.team_short_name?.toLowerCase().includes(q)
    )
  }, [players, search])

  const selectedIds = value.map((p) => p.player_id)

  const addPlayer = (player) => {
    if (locked || deadlinePassed) return
    if (value.length >= 5) return

    const count = value.filter((p) => p.player_id === player.player_id).length
    const next = [
      ...value,
      {
        player_id: player.player_id,
        display_name: player.display_name,
        team_short_name: player.team_short_name,
        threshold: count + 1,
      },
    ]
    onChange(next)
  }

  const removeAt = (index) => {
    if (locked || deadlinePassed) return
    const next = value.filter((_, i) => i !== index)
    // recompute thresholds after removal
    const counts = {}
    const rebuilt = next.map((p) => {
      counts[p.player_id] = (counts[p.player_id] || 0) + 1
      return { ...p, threshold: counts[p.player_id] }
    })
    onChange(rebuilt)
  }

  const clearAll = () => onChange([])

  return (
    <div className="grid lg:grid-cols-[1.2fr_0.8fr] gap-4">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Pick players</h2>
            <p className="text-sm text-white/35">Select exactly 5. Duplicates are allowed.</p>
          </div>
          <Badge status={deadlinePassed ? 'locked' : 'pending'}>
            {deadlinePassed ? 'Locked' : `${value.length}/5`}
          </Badge>
        </div>

        <PlayerSearch value={search} onChange={setSearch} />

        <div className="grid gap-2 max-h-[60dvh] overflow-auto pr-1">
          {filteredPlayers.map((player) => {
            const alreadySelected = selectedIds.includes(player.player_id)
            const totalCount = value.filter((p) => p.player_id === player.player_id).length

            return (
              <Card
                key={player.player_id}
                hover
                className={`p-3 flex items-center justify-between gap-3 ${
                  alreadySelected ? 'border-accent/20 bg-surface-2' : ''
                }`}
                onClick={() => addPlayer(player)}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white truncate">{player.display_name}</p>
                    {player.team_short_name && (
                      <Badge status="member">{player.team_short_name}</Badge>
                    )}
                  </div>
                  <p className="text-xs text-white/35">
                    {player.position ?? 'Player'} • {player.team_name}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {totalCount > 0 && (
                    <Badge status="won">{`x${totalCount}`}</Badge>
                  )}
                  <Button
                    size="sm"
                    variant={alreadySelected ? 'secondary' : 'primary'}
                    onClick={(e) => {
                      e.stopPropagation()
                      addPlayer(player)
                    }}
                    disabled={locked || deadlinePassed || value.length >= 5}
                  >
                    {alreadySelected ? 'Add again' : 'Add'}
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      </div>

      <div className="space-y-4">
        <PickSlip
          picks={value.map((p) => ({ display_name: p.display_name, threshold: p.threshold }))}
          onSubmit={onSubmit}
          submitting={submitting}
          locked={locked}
          deadlinePassed={deadlinePassed}
        />

        <Card className="p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h3 className="font-semibold text-white">Selected picks</h3>
            {value.length > 0 && !locked && !deadlinePassed && (
              <button
                onClick={clearAll}
                className="text-xs text-white/35 hover:text-white/70"
              >
                Clear all
              </button>
            )}
          </div>

          <div className="space-y-2">
            {value.length === 0 ? (
              <p className="text-sm text-white/35">No picks selected yet.</p>
            ) : (
              value.map((pick, idx) => (
                <PickSlot
                  key={`${pick.player_id}-${idx}`}
                  pick={{ players: { display_name: pick.display_name } , goal_threshold: pick.threshold }}
                  index={idx}
                  onRemove={() => removeAt(idx)}
                  locked={locked || deadlinePassed}
                />
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  )
} 