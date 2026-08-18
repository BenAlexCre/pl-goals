// Phase 11, Part 5 — the app has real crest_url values for every real
// (non-demo) team, synced from football-data.org and confirmed live to
// resolve (not invented, not broken) — so this is NOT an "image pipeline"
// component, just a single, consistent fallback for the cases that
// genuinely have no image: the Demo Centre's synthetic teams (which never
// had a real crest to sync) and any future team a provider hasn't synced
// yet. One shared component instead of every fixture card/picker
// inventing its own fallback shape, per the brief's "keep the treatment
// consistent across the entire application."
function abbreviation(team) {
  const source = team?.short_name || team?.name || '?'
  const words = source.trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return source.slice(0, 3).toUpperCase()
}

const SIZES = {
  sm: { box: 'h-8 w-8', img: 'h-6 w-6', text: 'text-[9px]' },
  md: { box: 'h-9 w-9', img: 'h-7 w-7', text: 'text-[10px]' },
  lg: { box: 'h-11 w-11', img: 'h-8 w-8', text: 'text-[11px]' },
}

export default function TeamCrest({ team, size = 'md', className = '' }) {
  const s = SIZES[size] ?? SIZES.md
  return (
    <div className={`flex ${s.box} shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-3 ${className}`}>
      {team?.crest_url ? (
        <img src={team.crest_url} alt="" className={`${s.img} object-contain`} loading="lazy" />
      ) : (
        <span className={`font-bold tracking-wide text-white/40 ${s.text}`}>{abbreviation(team)}</span>
      )}
    </div>
  )
}
