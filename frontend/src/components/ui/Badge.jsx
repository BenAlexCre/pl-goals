const configs = {
  won:      'bg-accent/15 text-accent border-accent/30',
  winning:  'bg-accent/15 text-accent border-accent/30 animate-pulse',
  lost:     'bg-red-goal/15 text-red-goal border-red-goal/30',
  losing:   'bg-red-goal/15 text-red-goal border-red-goal/30',
  pending:  'bg-white/8 text-white/50 border-white/10',
  void:     'bg-white/5 text-white/25 border-white/8',
  locked:   'bg-amber/15 text-amber border-amber/30',
  settled:  'bg-accent/10 text-accent/70 border-accent/20',
  paid:     'bg-accent/15 text-accent border-accent/30',
  unpaid:   'bg-red-goal/15 text-red-goal border-red-goal/30',
  live:     'bg-red-goal/20 text-red-goal border-red-goal/40 animate-pulse',
  upcoming: 'bg-white/8 text-white/60 border-white/10',
  completed:'bg-white/5 text-white/40 border-white/8',
  admin:    'bg-amber/15 text-amber border-amber/30',
  member:   'bg-white/8 text-white/50 border-white/10',
}

const defaultLabels = {
  won: '✓ Won', winning: '⚡ Winning', lost: '✗ Lost', losing: '↓ Losing',
  pending: '· Pending', void: '∅ Void', locked: '🔒 Locked', settled: '✓ Settled',
  paid: '✓ Paid', unpaid: '✗ Unpaid', live: '● Live', upcoming: 'Upcoming',
  completed: 'Final', admin: 'Admin', member: 'Member',
}

export default function Badge({ status, children, className = '' }) {
  const cfg = configs[status] ?? 'bg-white/8 text-white/50 border-white/10'
  return (
    <span className={`
      inline-flex items-center gap-1 text-xs font-medium
      px-2 py-0.5 rounded-full border tabular flex-shrink-0
      ${cfg} ${className}
    `}>
      {children ?? defaultLabels[status] ?? status}
    </span>
  )
}