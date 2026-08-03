// Shared data shapes for the Game Engine. Mirrors the schema in
// supabase/migrations/004_game_engine_shared_platform.sql — docs/game-engine.md
// (GE-4) is the authoritative source of truth these types track; update both
// together if the schema changes.

export type GameType = 'pick5' | 'last_man_standing' | 'score_predictor'

export type EntryStatus = 'pending' | 'locked' | 'void' | 'settled'

export type PotScope = 'gameweek' | 'season'

export interface Pot {
  id: string
  gameType: GameType
  entryFee: number
  endGameweekId: number | null
  predictorCycleMode: 'two_halves' | 'single_cycle'
  predictorScorerScope: 'fixture_only' | 'gameweek_wide'
}

export interface GameEntry {
  id: string
  potId: string
  userId: string
  gameweekId: number | null
  entryScope: PotScope
  status: EntryStatus
  payoutAmount: number
  settledAt: string | null
}

export interface StandingsRow {
  potId: string
  gameweekId: number | null
  userId: string
  rank: number
  score: number
  meta?: Record<string, unknown>
}

export interface NotificationEvent {
  userId: string
  potId: string | null
  type: string
  payload?: Record<string, unknown>
}
