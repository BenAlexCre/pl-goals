import { useState } from 'react'
import { RefreshCw, Pencil, Rocket, AlertTriangle } from 'lucide-react'
import { useDraftRolloverPots, useRenamePot, useActivateRolloverPot, useGameweeksForPot } from '../hooks/useAdmin'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Spinner from '../components/ui/Spinner'
import EmptyState from '../components/ui/EmptyState'
import Modal from '../components/ui/Modal'
import { useUiStore } from '../store/uiStore'

const GAME_TYPE_LABEL = {
  pick5: 'Pick 5',
  last_man_standing: 'Last Man Standing',
  score_predictor: 'Score Predictor',
}

function InheritedField({ label, value }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-white/35">{label}</div>
      <div className="text-sm text-white">{value}</div>
    </div>
  )
}

function feeSummary(type, amount, percentage) {
  if (type === 'none' || !type) return 'None'
  if (type === 'fixed') return `${amount} fixed`
  return `${percentage}%`
}

function RenameModal({ pot, onClose }) {
  const addToast = useUiStore((s) => s.addToast)
  const renamePot = useRenamePot()
  const [name, setName] = useState(pot?.name ?? '')

  async function handleSave() {
    const trimmed = name.trim()
    if (!trimmed || trimmed === pot.name) return onClose()
    try {
      await renamePot.mutateAsync({ potId: pot.id, name: trimmed })
      addToast({ type: 'success', message: 'Rollover pot renamed' })
      onClose()
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to rename pot' })
    }
  }

  return (
    <Modal open={!!pot} onClose={onClose} title="Rename rollover pot" size="sm">
      <label htmlFor="rollover-rename-input" className="mb-2 block text-sm text-white/70">Pot name</label>
      <input
        id="rollover-rename-input"
        type="text"
        maxLength={80}
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none transition-colors focus:border-accent/50"
        autoFocus
      />
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="button" onClick={handleSave} loading={renamePot.isPending} disabled={!name.trim()}>
          Save
        </Button>
      </div>
    </Modal>
  )
}

function ActivateModal({ pot, onClose }) {
  const addToast = useUiStore((s) => s.addToast)
  const activatePot = useActivateRolloverPot()
  const { data: gameweeks = [] } = useGameweeksForPot(pot?.season?.id, pot?.league?.id)

  // LMS's rollover pot deliberately leaves start/end gameweek unset —
  // start_gameweek_id is required before activation (get-or-create-lms-
  // entry's entry-window check depends on it existing at all) and
  // end_gameweek_id is required for consistency with potManager.jsx's own
  // pot-creation form, which already treats it as required for LMS
  // (without it, determineWinner()'s season-end path never resolves).
  // Pick 5's own rollover pot already has both resolved automatically
  // (docs/decisions.md § Pick 5 jackpot and season rollover), so no input
  // is needed there.
  const needsStart = pot?.game_type === 'last_man_standing' && !pot?.start_gameweek_id
  const needsEnd = pot?.game_type === 'last_man_standing' && !pot?.end_gameweek_id
  const [startGameweekId, setStartGameweekId] = useState('')
  const [endGameweekId, setEndGameweekId] = useState('')

  const canActivate = (!needsStart || !!startGameweekId) && (!needsEnd || !!endGameweekId)

  async function handleActivate() {
    if (!canActivate) return
    try {
      await activatePot.mutateAsync({
        potId: pot.id,
        startGameweekId: needsStart ? Number(startGameweekId) : undefined,
        endGameweekId: needsEnd ? Number(endGameweekId) : undefined,
      })
      addToast({ type: 'success', message: `${pot.name} activated — open for joining` })
      onClose()
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to activate pot' })
    }
  }

  return (
    <Modal open={!!pot} onClose={onClose} title="Activate rollover pot" size="sm">
      <p className="text-sm text-white/60">
        Activate <span className="font-medium text-white">{pot?.name}</span>? Once active, members can join and it
        behaves like any other pot — this cannot be undone from here.
      </p>

      {needsStart && (
        <div className="mt-4">
          <label htmlFor="rollover-start-gw" className="mb-2 block text-sm text-white/70">
            Starting gameweek <span className="text-red-goal">*</span>
          </label>
          <select
            id="rollover-start-gw"
            value={startGameweekId}
            onChange={(e) => setStartGameweekId(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none transition-colors focus:border-accent/50"
          >
            <option value="">Select a gameweek</option>
            {gameweeks.map((gw) => (
              <option key={gw.id} value={gw.id}>GW{gw.number} — {gw.name}</option>
            ))}
          </select>
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-amber">
            <AlertTriangle size={12} /> Required — Last Man Standing entries need a starting gameweek before anyone can join.
          </p>
        </div>
      )}

      {needsEnd && (
        <div className="mt-4">
          <label htmlFor="rollover-end-gw" className="mb-2 block text-sm text-white/70">
            Final gameweek <span className="text-red-goal">*</span>
          </label>
          <select
            id="rollover-end-gw"
            value={endGameweekId}
            onChange={(e) => setEndGameweekId(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-white outline-none transition-colors focus:border-accent/50"
          >
            <option value="">Select a gameweek</option>
            {gameweeks.map((gw) => (
              <option key={gw.id} value={gw.id}>GW{gw.number} — {gw.name}</option>
            ))}
          </select>
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-amber">
            <AlertTriangle size={12} /> Required — without it, a season-end tie can never resolve.
          </p>
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="button" onClick={handleActivate} loading={activatePot.isPending} disabled={!canActivate}>
          <Rocket size={16} />
          Activate
        </Button>
      </div>
    </Modal>
  )
}

function RolloverPotCard({ pot, onRename, onActivate }) {
  return (
    <Card className="p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-white">{pot.name}</h3>
          <p className="mt-0.5 text-xs text-white/40">
            Rolled over from <span className="text-white/60">{pot.rollover_source_name ?? 'a previous pot'}</span>
            {' '}&middot; generation {pot.rollover_generation}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge>{GAME_TYPE_LABEL[pot.game_type] ?? pot.game_type}</Badge>
          <Badge status="pending">Draft</Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-xl border border-white/8 bg-black/10 p-4 sm:grid-cols-3">
        <InheritedField label="League" value={pot.league?.name ?? '—'} />
        <InheritedField label="Season" value={pot.season?.name ?? '—'} />
        <InheritedField label="Entry fee" value={pot.entry_fee} />
        <InheritedField label="Jackpot inherited" value={pot.carry_over_amount} />
        <InheritedField label="Admin fee" value={feeSummary(pot.admin_fee_type, pot.admin_fee_amount, pot.admin_fee_percentage)} />
        <InheritedField label="Charity fee" value={feeSummary(pot.charity_fee_type, pot.charity_fee_amount, pot.charity_fee_percentage)} />
        <InheritedField
          label="Gameweek range"
          value={
            pot.start_gameweek || pot.end_gameweek
              ? `GW${pot.start_gameweek?.number ?? '?'} – GW${pot.end_gameweek?.number ?? '?'}`
              : 'Not yet set'
          }
        />
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => onRename(pot)}>
          <Pencil size={14} />
          Rename
        </Button>
        <Button type="button" size="sm" onClick={() => onActivate(pot)}>
          <Rocket size={14} />
          Activate
        </Button>
      </div>
    </Card>
  )
}

export default function AdminRollovers() {
  const { data: pots = [], isLoading } = useDraftRolloverPots()
  const [renamingPot, setRenamingPot] = useState(null)
  const [activatingPot, setActivatingPot] = useState(null)

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Rollover management</h1>
            <p className="mt-1 text-sm text-white/40">
              Pots the Game Engine created automatically after an unclaimed Pick 5 jackpot or Last Man Standing
              wipeout. Review what each one inherited, rename it if you like, then activate it when ready.
            </p>
          </div>
          <Badge status="admin">Admin</Badge>
        </div>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : pots.length === 0 ? (
        <EmptyState
          icon={RefreshCw}
          title="No draft rollover pots"
          description="When a Pick 5 jackpot or Last Man Standing pot rolls over with no winner, the new pot appears here in draft, ready to review and activate."
        />
      ) : (
        <div className="space-y-4">
          {pots.map((pot) => (
            <RolloverPotCard key={pot.id} pot={pot} onRename={setRenamingPot} onActivate={setActivatingPot} />
          ))}
        </div>
      )}

      <RenameModal pot={renamingPot} onClose={() => setRenamingPot(null)} />
      <ActivateModal pot={activatingPot} onClose={() => setActivatingPot(null)} />
    </div>
  )
}
