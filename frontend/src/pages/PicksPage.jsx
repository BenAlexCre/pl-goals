import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useCurrentGameweek } from '../hooks/useGameweek'
import { useAvailablePlayers } from '../hooks/usePlayers'
import { useEntry, useSubmitPicks } from '../hooks/useEntry'
import PickSelector from '../components/picks/PickSelector'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import { useUiStore } from '../store/uiStore'

export default function PicksPage() {
  const { potId } = useParams()
  const addToast = useUiStore((s) => s.addToast)
  const { data: currentGw } = useCurrentGameweek()
  const { data: players = [] } = useAvailablePlayers(currentGw?.id)
  const { data: entry } = useEntry(potId, currentGw?.id)
  const submitMutation = useSubmitPicks()

  const initialPicks = useMemo(() => {
    if (!entry?.pick5_picks?.length) return []
    return [...entry.pick5_picks]
      .sort((a, b) => a.pick_position - b.pick_position)
      .map((p) => ({
        player_id: p.player_id,
        display_name: p.players?.display_name || 'Unknown',
        threshold: p.goal_threshold,
      }))
  }, [entry])

  const [picks, setPicks] = useState(initialPicks)

  const deadlinePassed = currentGw?.deadline_utc
    ? new Date(currentGw.deadline_utc) <= new Date()
    : false

  const locked = ['locked', 'settled', 'void'].includes(entry?.status)

  async function handleSubmit() {
    try {
      await submitMutation.mutateAsync({
        potId,
        gameweekId: currentGw.id,
        picks,
      })
      addToast({ type: 'success', message: 'Picks saved successfully' })
    } catch (err) {
      addToast({ type: 'error', message: err.message })
    }
  }

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Make your picks</h1>
            <p className="text-sm text-white/40 mt-1">
              Select exactly 5 players for {currentGw?.name || 'the current gameweek'}.
            </p>
          </div>
          <Badge status={deadlinePassed ? 'locked' : entry?.status || 'pending'}>
            {deadlinePassed ? 'Locked' : entry?.status || 'Draft'}
          </Badge>
        </div>
      </Card>

      <PickSelector
        players={players}
        value={picks}
        onChange={setPicks}
        locked={locked}
        deadlinePassed={deadlinePassed}
        onSubmit={handleSubmit}
        submitting={submitMutation.isPending}
      />
    </div>
  )
}