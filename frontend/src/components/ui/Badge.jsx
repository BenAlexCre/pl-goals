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
  alive:      'bg-accent/15 text-accent border-accent/30',
  eliminated: 'bg-red-goal/15 text-red-goal border-red-goal/30',
  // Phase 25 — official lineup status (fixture_player_status.status).
  // sub_on/sub_off both read as "bench" here (a player who came off the
  // bench or was substituted out is, for selection purposes, not part of
  // the starting XI) — the raw distinction is preserved in the data,
  // just not worth a 4th visual style for this use.
  starting:    'bg-accent/15 text-accent border-accent/30',
  bench:       'bg-amber/15 text-amber border-amber/30',
  not_in_squad:'bg-white/5 text-white/30 border-white/8',
}

const defaultLabels = {
  won: '✓ Won', winning: '⚡ Winning', lost: '✗ Lost', losing: '↓ Losing',
  pending: '· Pending', void: '∅ Void', locked: '🔒 Locked', settled: '✓ Settled',
  paid: '✓ Paid', unpaid: '✗ Unpaid', live: '● Live', upcoming: 'Upcoming',
  completed: 'Final', admin: 'Admin', member: 'Member',
  alive: '● Alive', eliminated: '✗ Eliminated',
  starting: 'Starting XI', bench: 'Bench', not_in_squad: 'Not in squad',
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