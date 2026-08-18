import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Phase 8a — Match Centre Core: player/assist names added to the
// fixture_events select (previously player_id only) so the new
// FixtureEventsTimeline can render "Salah (assist: Trent)" and make each
// name clickable into PlayerDrawer, without a second query. Every other
// field is unchanged — GameweekPage's existing FixtureEvents rendering
// keeps working as-is.
const FIXTURES_WITH_EVENTS_SELECT = `
  *,
  home_team:teams!home_team_id(id, name, short_name, crest_url),
  away_team:teams!away_team_id(id, name, short_name, crest_url),
  fixture_events(
    id, player_id, team_id, event_type,
    minute, extra_minute, assist_player_id,
    is_own_goal, is_penalty,
    player:players!fixture_events_player_id_fkey(id, display_name),
    assist_player:players!fixture_events_assist_player_id_fkey(id, display_name)
  )
`

// Phase 11 — ISSUE-52 fix. `leagues` is reference data that accumulates
// every league the app has ever synced or generated (a retired
// api-football-provider "Premier League" row, a genuinely unrelated "FIFA
// World Cup" row, two synthetic Demo Centre leagues, and the one real,
// currently-used "Premier League" row) — confirmed live via direct query,
// not assumed. Neither of these two hooks filtered on anything but
// `gameweeks` itself, so the homepage's own "what's the current/next
// gameweek" query was free to surface ANY of them, real or not. Reusing
// two pieces of reference data that already exist and already mean
// exactly this, rather than inventing a new "is this the real league"
// flag or hard-coding the string "Premier League" anywhere:
//   - `leagues.is_active` — false for both the decommissioned
//     api-football Premier League row and the FIFA World Cup row here;
//     true for the one real, current Premier League row.
//   - `leagues.provider_name = 'demo'` — the exact identifier
//     `_shared/demo/teardown.ts` already uses to find and delete every
//     demo-generated reference row; reused here as a read-side filter
//     instead of a second, invented "is this demo" signal.
// `leagues!inner(...)` (not the default left-embed) is required for
// PostgREST to accept `.eq('leagues.is_active', ...)`/
// `.neq('leagues.provider_name', ...)` as embedded-resource filters.
//
// `.limit(1)` + take the first row, not `.single()` — found live while
// verifying this fix: `.single()` sets PostgREST's singular-object Accept
// header, which responds `406`/`PGRST116` for a genuinely expected empty
// result (ISSUE-39 — no gameweek has `is_current = true` locally). The
// code already treated that as a normal "nothing found" case, but the
// underlying failed HTTP request still logged as a browser console error
// on every single Dashboard load regardless. `.limit(1)` never 406s.
export function useCurrentGameweek() {
  return useQuery({
    queryKey: ['gameweek', 'current'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gameweeks')
        .select(`*, leagues!inner(name, is_active, provider_name), fixtures(${FIXTURES_WITH_EVENTS_SELECT})`)
        .eq('is_current', true)
        .eq('leagues.is_active', true)
        .neq('leagues.provider_name', 'demo')
        .limit(1)
      if (error) throw error
      return data?.[0] ?? null
    },
  })
}

// Phase 10B, Part 17/18/19 — Dashboard's "boring empty state" fallback.
// useCurrentGameweek() only ever finds is_current=true (still none,
// ISSUE-39, not fixed this phase). This finds the soonest gameweek that
// isn't already completed — real fixture data, same
// FIXTURES_WITH_EVENTS_SELECT shape useCurrentGameweek()/useGameweek()
// already use, no fabrication. Scoped to the real, active, non-demo
// league only (see the comment above useCurrentGameweek() — Phase 11,
// ISSUE-52) — this is what actually caused "FIFA World Cup" to appear on
// the homepage: that league's own gameweeks have earlier deadlines
// (June 2026) than the real Premier League's (August 2026), so the
// previous unscoped "soonest deadline across every league" query always
// won with the wrong competition.
export function useNextGameweek(enabled = true) {
  return useQuery({
    queryKey: ['gameweek', 'next'],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gameweeks')
        .select(`*, leagues!inner(name, is_active, provider_name), fixtures(${FIXTURES_WITH_EVENTS_SELECT})`)
        .neq('status', 'completed')
        .eq('leagues.is_active', true)
        .neq('leagues.provider_name', 'demo')
        .order('deadline_utc', { ascending: true, nullsFirst: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data ?? null
    },
  })
}

export function useGameweek(gameweekId) {
  return useQuery({
    queryKey: ['gameweek', gameweekId],
    enabled: !!gameweekId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gameweeks')
        .select(`*, leagues(name), fixtures(${FIXTURES_WITH_EVENTS_SELECT})`)
        .eq('id', gameweekId)
        .single()
      if (error) throw error
      return data
    },
  })
}

export function useAllGameweeks() {
  return useQuery({
    queryKey: ['gameweeks', 'all'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gameweeks')
        .select('id, number, name, status, deadline_utc, is_current')
        .order('number')
      if (error) throw error
      return data ?? []
    },
  })
}