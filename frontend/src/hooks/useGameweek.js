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

export function useCurrentGameweek() {
  return useQuery({
    queryKey: ['gameweek', 'current'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gameweeks')
        .select(`*, leagues(name), fixtures(${FIXTURES_WITH_EVENTS_SELECT})`)
        .eq('is_current', true)
        .single()
      if (error && error.code !== 'PGRST116') throw error
      return data ?? null
    },
  })
}

// Phase 10B, Part 17/18/19 — Dashboard's "boring empty state" fallback.
// useCurrentGameweek() only ever finds is_current=true (still none,
// ISSUE-39, not fixed this phase). This finds the soonest gameweek that
// isn't already completed — real fixture data, same
// FIXTURES_WITH_EVENTS_SELECT shape useCurrentGameweek()/useGameweek()
// already use, no fabrication. Deliberately global (not scoped to any one
// league), matching useCurrentGameweek()'s own cross-league scope — the
// real, usable gameweek data today happens to live under a non-"current"
// league (ISSUE-39's own finding), so scoping this to "the current
// league" would just rediscover the same empty result.
export function useNextGameweek(enabled = true) {
  return useQuery({
    queryKey: ['gameweek', 'next'],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gameweeks')
        .select(`*, leagues(name), fixtures(${FIXTURES_WITH_EVENTS_SELECT})`)
        .neq('status', 'completed')
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