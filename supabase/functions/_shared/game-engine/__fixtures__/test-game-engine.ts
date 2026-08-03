// FRAMEWORK VERIFICATION ONLY.
//
// This is not a reference implementation, not a stub for Pick 5, LMS, or
// Predictor, and is never imported by production code — nothing outside
// this __fixtures__ directory and its accompanying tests should ever import
// from here. It exists solely to prove the Game Engine contract, dispatcher,
// and dependency-injection boundary work as designed (docs/game-engine.md
// § GE-6 / GE-7 / GE-18) before Pick 5 becomes the first real implementation
// in Milestone 4.
//
// Every method does the minimum possible to prove it was called correctly —
// it records the context and arguments it received, and it actually invokes
// ctx.now() so a test can prove the injected clock isn't just present but
// usable. Nothing here is business logic: no validation rule, no scoring
// formula, no elimination or payout logic of any kind.

import type { GameEngine, GameEngineContext } from '../contracts.ts'
import type { GameEntry, NotificationEvent, StandingsRow } from '../types.ts'

export interface RecordedCall {
  method: string
  ctx: GameEngineContext
  args: unknown[]
  /** Proves ctx.now() was actually invoked during this call, not just referenced. */
  nowAtCallTime: Date
}

export class TestGameEngine implements GameEngine {
  readonly calls: RecordedCall[] = []

  private record(method: string, ctx: GameEngineContext, ...args: unknown[]): void {
    this.calls.push({ method, ctx, args, nowAtCallTime: ctx.now() })
  }

  validateEntry(ctx: GameEngineContext, entry: GameEntry, picks: unknown): Promise<void> {
    this.record('validateEntry', ctx, entry, picks)
    return Promise.resolve()
  }

  lockEntries(ctx: GameEngineContext, gameweekId: number): Promise<number> {
    this.record('lockEntries', ctx, gameweekId)
    return Promise.resolve(0)
  }

  calculateScore(ctx: GameEngineContext, gameweekId: number): Promise<void> {
    this.record('calculateScore', ctx, gameweekId)
    return Promise.resolve()
  }

  settle(ctx: GameEngineContext, gameweekId: number): Promise<void> {
    this.record('settle', ctx, gameweekId)
    return Promise.resolve()
  }

  generateStandings(ctx: GameEngineContext, potId: string): Promise<StandingsRow[]> {
    this.record('generateStandings', ctx, potId)
    return Promise.resolve([])
  }

  determineWinner(ctx: GameEngineContext, potId: string): Promise<string[]> {
    this.record('determineWinner', ctx, potId)
    return Promise.resolve([])
  }

  awardPrize(ctx: GameEngineContext, potId: string): Promise<void> {
    this.record('awardPrize', ctx, potId)
    return Promise.resolve()
  }

  notifyUsers(ctx: GameEngineContext, event: NotificationEvent): Promise<void> {
    this.record('notifyUsers', ctx, event)
    return Promise.resolve()
  }
}
