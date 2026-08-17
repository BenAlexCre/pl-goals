import { CheckCircle2, Target } from 'lucide-react'
import Button from '../../ui/Button'
import PickCard from './PickCard'

// Phase 8B — the persistent picks panel: a sidebar on desktop, the
// expanded content of a sticky bottom sheet on mobile (see PotDetail.jsx
// for how each wraps this). Reuses the existing PickCard component
// unchanged — this sprint is a picker UX change, not a new pick-summary
// design.
export default function PicksSummaryPanel({ selectedPlayers, maxPicks, onRemove, onSave, saving, savedEntry, deadlineClosed }) {
  const canRemove = !deadlineClosed

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">Your picks</h2>
        <span
          className={`rounded-full border px-2.5 py-1 text-xs font-semibold tabular ${
            selectedPlayers.length === maxPicks
              ? 'border-accent/30 bg-accent/10 text-accent'
              : 'border-white/10 bg-white/5 text-white/60'
          }`}
        >
          {selectedPlayers.length} / {maxPicks} selected
        </span>
      </div>

      {selectedPlayers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-5 text-center">
          <Target size={20} className="mx-auto mb-2 text-white/25" />
          <p className="text-sm text-white/45">Tap a player to add them here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {selectedPlayers.map((player, index) => (
            <PickCard
              key={`${player.player_id}-${index}`}
              pickNumber={index + 1}
              displayName={player.display_name}
              teamName={player.team_name || player.team_short_name}
              crestUrl={player.crest_url}
              position={player.position}
              onRemove={canRemove ? () => onRemove(index) : undefined}
            />
          ))}
        </div>
      )}

      <Button
        type="button"
        onClick={onSave}
        disabled={saving || selectedPlayers.length !== maxPicks || deadlineClosed}
        className="mt-4 w-full"
      >
        <CheckCircle2 size={16} />
        {saving ? 'Saving picks...' : savedEntry ? 'Update picks' : 'Save entry'}
      </Button>
    </div>
  )
}
