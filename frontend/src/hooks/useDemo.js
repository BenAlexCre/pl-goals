import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, extractFunctionError } from '../lib/supabase'

// Phase 8C, Slice 1 — Demo Centre & Demo Gameweek. Uses
// supabase.functions.invoke() + extractFunctionError() throughout, the same
// pattern useMarkPayment/useRecordPayment/useReinstateEntry already use —
// deliberately not useTriggerSync's raw fetch() (that pattern only sends an
// Authorization header, which Kong 401s locally for missing apikey, per
// that hook's own comment; invoke() attaches it automatically).

export function useDemoSession() {
  return useQuery({
    queryKey: ['demo-session'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('demo_sessions')
        .select('*')
        .in('status', ['draft', 'active'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}

async function callDemoGenerate(body) {
  const { data, error } = await supabase.functions.invoke('demo-generate-data', { body })
  if (error) throw await extractFunctionError(error)
  if (data?.error) throw new Error(data.error)
  return data
}

// Phase 8C — demo-generate-data is a multi-step Edge Function, not a single
// call: the local Edge Runtime enforces a hard ~2s CPU-time budget per
// invocation (confirmed live — generating even 10 users in one call
// reliably crashed the isolate), very likely a real platform constraint,
// not a local-only quirk. This hook drives the 'league' -> repeated
// 'users' batches -> 'settle' sequence, reporting progress via onProgress
// so the UI can show something better than a single opaque spinner for
// what can be a 10+ request sequence at 50 users.
export function useGenerateDemoData() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ userCount, onProgress }) => {
      onProgress?.({ phase: 'league' })
      const leagueResult = await callDemoGenerate({ step: 'league', userCount })
      const demoSessionId = leagueResult.demoSession.id

      let done = false
      let createdCount = 0
      while (!done) {
        const batchResult = await callDemoGenerate({ step: 'users', demoSessionId })
        done = batchResult.done
        createdCount = batchResult.createdCount ?? createdCount
        onProgress?.({ phase: 'users', createdCount, total: userCount })
      }

      onProgress?.({ phase: 'settle' })
      const settleResult = await callDemoGenerate({ step: 'settle', demoSessionId })
      return settleResult
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['demo-session'] })
    },
  })
}

export function useTeardownDemo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ demoSessionId }) => {
      const { data, error } = await supabase.functions.invoke('demo-teardown', {
        body: { demoSessionId },
      })
      if (error) throw await extractFunctionError(error)
      if (data?.error) throw new Error(data.error)
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['demo-session'] })
    },
  })
}

export function useDemoGameweekControl() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ action, demoSessionId, batchSize }) => {
      const { data, error } = await supabase.functions.invoke('demo-gameweek-control', {
        body: { action, demoSessionId, batchSize },
      })
      if (error) throw await extractFunctionError(error)
      if (data?.error) throw new Error(data.error)
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['demo-session'] })
      qc.invalidateQueries({ queryKey: ['demo-timeline'] })
      // The gameweek page / Match Centre reuse the same query keys real
      // fixtures use — invalidate broadly so the operator's own view of the
      // demo gameweek (if they have it open in another tab) refreshes too,
      // on top of the realtime channel already covering fixtures/fixture_events.
      qc.invalidateQueries({ queryKey: ['gameweek'] })
    },
  })
}

export function useDemoTimeline(demoSessionId) {
  return useQuery({
    queryKey: ['demo-timeline', demoSessionId],
    enabled: !!demoSessionId,
    refetchInterval: 5_000,
    queryFn: async () => {
      // Phase 8C verification sprint — real bug caught live: demo_timeline_events
      // has two FKs into players (player_id, assist_player_id), so the bare
      // `players(display_name)` embed below was ambiguous — PostgREST rejected
      // every call with PGRST201, which the UI silently swallowed into "no
      // timeline generated" despite real data existing. Disambiguated per
      // PostgREST's own error hint; aliased back to `players` so this hook's
      // callers (DemoGameweek.jsx reads `e.players.display_name`) don't change.
      const { data, error } = await supabase
        .from('demo_timeline_events')
        .select('*, fixtures(home_team_id, away_team_id, teams_home:teams!fixtures_home_team_id_fkey(short_name), teams_away:teams!fixtures_away_team_id_fkey(short_name)), players:players!demo_timeline_events_player_id_fkey(display_name)')
        .eq('demo_session_id', demoSessionId)
        .order('sequence_order', { ascending: true })
      if (error) throw error
      return data ?? []
    },
  })
}

// Phase 9 — retired in favor of useGameweek(gameweekId) + useLiveScores()
// (hooks/useGameweek.js / useLiveScores.js), the same pair every real
// gameweek page already uses: one query that includes fixture_events (this
// one never did — no goalscorer data), kept fresh by the real realtime
// subscription instead of a second, demo-only 5s poll. See DemoGameweek.jsx.
