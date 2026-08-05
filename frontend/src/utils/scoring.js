// Mirrors PICK5_PICK_COUNT in supabase/functions/_shared/game-engine/pick5/engine.ts —
// duplicated deliberately, not imported: the frontend (Vite) and the Edge
// Functions (Deno) are separate runtimes with no shared module resolution.
export const PICK5_PICK_COUNT = 5

export function computePickResult(goalsScored, threshold, isLive) {
  if (goalsScored >= threshold) return isLive ? 'winning' : 'won'
  return isLive ? 'losing' : 'lost'
}

export function getThresholdForPlayer(picks, playerId) {
  return picks.filter((p) => p.player_id === playerId).length
}

export function summariseEntry(picks = []) {
  const won     = picks.filter((p) => ['won',  'winning'].includes(p.result)).length
  const lost    = picks.filter((p) => ['lost', 'losing' ].includes(p.result)).length
  const pending = picks.filter((p) => p.result === 'pending').length
  const voided  = picks.filter((p) => p.result === 'void').length
  return { won, lost, pending, voided, total: picks.length }
}

export function strikeRate(won, total) {
  if (!total) return 0
  return Math.round((won / total) * 100)
}