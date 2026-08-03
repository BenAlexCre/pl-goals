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