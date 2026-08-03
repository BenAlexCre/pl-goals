// GE-6: the eight-method lifecycle every game mode implements identically.
// See docs/game-engine.md § GE-6 for what each method is responsible for and
// when it's called. No game-mode logic lives in this file, and it should
// never need to change when a new mode is added — if it does, that's a
// signal the contract itself was wrong, not that this file needs a special
// case for one mode.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { GameEntry, NotificationEvent, StandingsRow } from './types.ts'

// GE-17/GE-18: the dependency-injection boundary. A GameEngine implementation
// never constructs its own Supabase client or reads Deno.env directly — the
// calling Edge Function builds the context once and passes it in. This is
// what makes an implementation testable with a fake/mock client instead of a
// real database connection.
export interface GameEngineContext {
  supabase: SupabaseClient
  now: () => Date
}

export interface GameEngine {
  validateEntry(ctx: GameEngineContext, entry: GameEntry, picks: unknown): Promise<void>
  lockEntries(ctx: GameEngineContext, gameweekId: number): Promise<number>
  calculateScore(ctx: GameEngineContext, gameweekId: number): Promise<void>
  settle(ctx: GameEngineContext, gameweekId: number): Promise<void>
  generateStandings(ctx: GameEngineContext, potId: string): Promise<StandingsRow[]>
  determineWinner(ctx: GameEngineContext, potId: string): Promise<string[]>
  awardPrize(ctx: GameEngineContext, potId: string): Promise<void>
  notifyUsers(ctx: GameEngineContext, event: NotificationEvent): Promise<void>
}
