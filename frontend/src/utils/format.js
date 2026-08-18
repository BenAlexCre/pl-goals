// Phase 10B — Part 15. `seasons.name` is free-text and already
// inconsistent live ("2025/26" for the current season vs a bare "2026"
// for another real season row, one of which even has year_end===
// year_start) — never trustworthy for display. Derives the standard
// football-season "2026/27" format from `year_start` alone, which is
// reliable regardless of what the free-text name column holds. Falls back
// to the stored name (then a plain dash) only when year_start itself is
// missing, so a malformed row never renders blank.
export function formatSeasonName(season) {
  if (!season) return '—'
  if (typeof season.year_start === 'number') {
    return `${season.year_start}/${String(season.year_start + 1).slice(-2)}`
  }
  return season.name || '—'
}

export function ordinal(n) {
  const s = ['th','st','nd','rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

export function pluralise(n, word) {
  return `${n} ${word}${n !== 1 ? 's' : ''}`
}

export function truncate(str, max = 24) {
  if (!str) return ''
  return str.length > max ? str.slice(0, max) + '…' : str
}

export function initials(name = '') {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}