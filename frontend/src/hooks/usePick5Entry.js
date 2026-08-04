import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

// Milestone 4, Slice 1 (entry creation) — docs/game-engine.md § GE-5.1.
// Calls the new get-or-create-pick5-entry Edge Function, which creates a
// game_entries + game_entry_pick5 row pair on the shared platform schema.
// Deliberately not wired into any page yet — pairs meaningfully with pick
// submission (Slice 2), which is when this becomes a real user-facing flow.
//
// Uses supabase.functions.invoke() rather than the raw fetch() pattern in
// hooks/useAdmin.js: invoke() attaches the apikey header automatically,
// which the raw-fetch hooks don't — confirmed this session that Kong 401s an
// Authorization-only request. That's a pre-existing bug in useAdmin.js's
// hooks, out of scope for this slice; not repeating it here.
export function useGetOrCreatePick5Entry() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ potId, gameweekId }) => {
      const { data, error } = await supabase.functions.invoke('get-or-create-pick5-entry', {
        body: { pot_id: potId, gameweek_id: gameweekId },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      return data.entry
    },
    onSuccess: (_entry, vars) => {
      qc.invalidateQueries({ queryKey: ['game-entry', vars.potId, vars.gameweekId] })
    },
  })
}
