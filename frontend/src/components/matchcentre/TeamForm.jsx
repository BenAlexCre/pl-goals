// Colour-coded WWDWL row — green win, amber draw, red loss, oldest-first
// (left-to-right reads as chronological). `results` comes from
// useTeamForm() in hooks/useMatchCentre.js. Renders nothing (not a row of
// dashes) when there's genuinely no completed-fixture data yet, e.g.
// before a season has kicked off — hiding gracefully rather than
// fabricating a form line.
const RESULT_STYLES = {
  W: 'bg-accent/20 text-accent',
  D: 'bg-amber/20 text-amber',
  L: 'bg-red-goal/20 text-red-goal',
}

export default function TeamForm({ results, size = 'sm' }) {
  if (!results || results.length === 0) return null

  const dims = size === 'sm' ? 'h-5 w-5 text-[10px]' : 'h-6 w-6 text-xs'

  return (
    <div className="flex items-center gap-1" aria-label={`Recent form: ${results.join('')}`}>
      {results.map((r, i) => (
        <span
          key={i}
          className={`flex ${dims} items-center justify-center rounded font-bold ${RESULT_STYLES[r] || 'bg-white/8 text-white/40'}`}
        >
          {r}
        </span>
      ))}
    </div>
  )
}
