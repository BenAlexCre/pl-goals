import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, extractFunctionError } from '../lib/supabase'

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
      if (error) throw await extractFunctionError(error)
      if (data?.error) throw new Error(data.error)
      return data.entry
    },
    onSuccess: (_entry, vars) => {
      qc.invalidateQueries({ queryKey: ['game-entry', vars.potId, vars.gameweekId] })
    },
  })
}

// Milestone 4, Slice 2 (pick submission) — docs/game-engine.md § GE-5.1/GE-6.
// Calls submit-pick5-picks, which runs Pick5Engine.validateEntry() (the Game
// Engine contract, for real, for the first time) before writing to
// pick5_picks. playerIds must be an array of exactly 5 player IDs (duplicates
// allowed — picking the same player more than once is a legitimate strategy,
// see docs/business-rules.md § How scoring works).
//
// Not wired into any page yet, same as useGetOrCreatePick5Entry — pairs with
// a picks UI, which is follow-up scope, not this slice.
export function useSubmitPick5Picks() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ gameEntryId, playerIds }) => {
      const { data, error } = await supabase.functions.invoke('submit-pick5-picks', {
        body: { game_entry_id: gameEntryId, player_ids: playerIds },
      })
      if (error) throw await extractFunctionError(error)
      if (data?.error) throw new Error(data.error)
      return data.picks
    },
    onSuccess: (_picks, vars) => {
      qc.invalidateQueries({ queryKey: ['pick5-picks', vars.gameEntryId] })
    },
  })
}
