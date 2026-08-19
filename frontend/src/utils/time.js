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

// Phase 19 — root cause traced to ingestion, not display: football-data.org
// (and api-football) both send a real, distinct status for "this match's
// date is known but its exact kickoff time hasn't been confirmed by
// broadcasters yet" (`SCHEDULED`/`TBD`, as opposed to `TIMED`/`NS` once a
// real time is set) — sent with `utcDate` at a literal `00:00:00Z`
// placeholder. Our own ingestion (fullSyncInsert.js, sync-fixtures)
// previously collapsed that distinction into the same `'scheduled'`
// fixture_status our confirmed fixtures use, discarding the exact signal
// needed to tell the two apart — fixed at the ingestion layer (both
// scripts now map it to the schema's own pre-existing `'tbd'` enum value,
// already present in fixture_status and already read by
// Dashboard.jsx/useMatchCentre.js, just never populated). This function is
// the one place that turns `fixture.status === 'tbd'` into copy — never
// inferred from a bare `00:00` time, which a genuinely confirmed midnight
// kickoff (rare, but real for some competitions) would also produce. The
// date itself IS real even when unconfirmed (the provider gives it), so
// only the time is replaced, not the whole string.
export function formatFixtureKickoff(kickoffUtc, status, tz = 'Europe/Dublin') {
  if (!kickoffUtc) return 'Time TBC'
  if (status === 'tbd') {
    try {
      const datePart = new Intl.DateTimeFormat('en-IE', {
        timeZone: tz, weekday: 'short', day: 'numeric', month: 'short',
      }).format(new Date(kickoffUtc))
      return `${datePart} · Time TBC`
    } catch {
      return 'Time TBC'
    }
  }
  return toLocalTimeShort(kickoffUtc, tz)
}

// Phase 18 — Dashboard gameweek hero. A fuller, unambiguous format for a
// single prominent headline date ("Friday 21 August at 20:00"), distinct
// from toLocalTimeShort()'s compact per-fixture-card form ("Fri, 21 Aug,
// 20:00") — same tz-aware Intl.DateTimeFormat primitive, just a different
// display context, not a second date-handling mechanism.
export function toLocalDateTimeLong(utcString, tz = 'Europe/Dublin') {
  if (!utcString) return ''
  try {
    const d = new Date(utcString)
    const datePart = new Intl.DateTimeFormat('en-IE', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(d)
    const timePart = new Intl.DateTimeFormat('en-IE', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
    return `${datePart} at ${timePart}`
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