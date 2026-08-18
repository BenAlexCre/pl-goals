import { Link } from 'react-router-dom'
import { Trophy, Shield, Target, ChevronRight } from 'lucide-react'
import Card from '../ui/Card'
import Badge from '../ui/Badge'

const MODE_META = {
  pick5: { icon: Trophy, label: 'Demo Pick 5', accent: 'text-accent' },
  lms: { icon: Shield, label: 'Demo Last Man Standing', accent: 'text-amber' },
  predictor: { icon: Target, label: 'Demo Score Predictor', accent: 'text-red-goal' },
}

function StatRow({ label, value }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-white/45">{label}</span>
      <span className="font-semibold text-white tabular">{value}</span>
    </div>
  )
}

// Phase 9 — Demo Gameweek enhancement (Parts 1/6). One shell, three
// mode-specific stat rows, all sourced from useDemoPotSummaries() (real
// Game Engine tables — see that hook's own comment). "View pot" opens the
// actual, unmodified pot page — no demo-only pot view exists.
export default function DemoPotSummaryCard({ mode, potId, statusTone, statusLabel, stats }) {
  const { icon: Icon, label, accent } = MODE_META[mode]

  return (
    <Card className="flex flex-col p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Icon size={16} className={accent} />
          {label}
        </h3>
        <Badge status={statusTone}>{statusLabel}</Badge>
      </div>

      <div className="flex-1 space-y-2">
        {mode === 'pick5' && (
          <>
            <StatRow label="Jackpot" value={`€${stats.jackpot.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
            <StatRow label="Entries" value={`${stats.entryCount} / ${stats.memberCount}`} />
            <StatRow label="On track for jackpot" value={stats.jackpotEligibleCount} />
          </>
        )}
        {mode === 'lms' && (
          <>
            <StatRow label="Players" value={stats.memberCount} />
            <StatRow label="Remaining" value={stats.aliveCount} />
            {stats.round != null && <StatRow label="Round" value={stats.round} />}
          </>
        )}
        {mode === 'predictor' && (
          <>
            <StatRow label="Entries" value={stats.entryCount} />
            <StatRow label="Your position" value={stats.yourRank ? `${stats.yourRank}${ordinalSuffix(stats.yourRank)}` : 'Not entered'} />
          </>
        )}
      </div>

      <Link
        to={`/pot/${potId}`}
        className="mt-4 inline-flex items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-white/70 transition-colors hover:border-accent/30 hover:text-white"
      >
        View pot
        <ChevronRight size={14} />
      </Link>
    </Card>
  )
}

function ordinalSuffix(n) {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return 'th'
  switch (n % 10) {
    case 1: return 'st'
    case 2: return 'nd'
    case 3: return 'rd'
    default: return 'th'
  }
}
