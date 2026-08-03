import { formatDistanceToNow, parseISO, isAfter } from 'date-fns'

export function toLocalTime(utcString, locale = 'en-IE', tz = 'Europe/Dublin') {
  if (!utcString) return ''
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone:  tz,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(utcString))
  } catch {
    return utcString
  }
}

export function toLocalTimeShort(utcString, tz = 'Europe/Dublin') {
  if (!utcString) return ''
  try {
    return new Intl.DateTimeFormat('en-IE', {
      timeZone: tz,
      weekday: 'short',
      month:   'short',
      day:     'numeric',
      hour:    '2-digit',
      minute:  '2-digit',
    }).format(new Date(utcString))
  } catch {
    return utcString
  }
}

export function isPastDeadline(deadlineUtc) {
  if (!deadlineUtc) return false
  return isAfter(new Date(), parseISO(deadlineUtc))
}

export function getCountdownParts(deadlineUtc) {
  if (!deadlineUtc) return null
  const diff = parseISO(deadlineUtc).getTime() - Date.now()
  if (diff <= 0) return null
  const h = Math.floor(diff / 3_600_000)
  const m = Math.floor((diff % 3_600_000) / 60_000)
  const s = Math.floor((diff % 60_000) / 1_000)
  return { h, m, s, total: diff }
}

export function relativeTime(utcString) {
  if (!utcString) return ''
  try {
    return formatDistanceToNow(parseISO(utcString), { addSuffix: true })
  } catch {
    return ''
  }
}