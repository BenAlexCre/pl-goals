// GE-7: one registry, keyed by pots.game_type. Edge Functions never branch on
// game_type directly — they call resolveEngine(gameType) and invoke the
// lifecycle method by name. Registration happens in each mode's own module
// (Milestones 4-6); this file has zero import-time knowledge of Pick 5, LMS,
// or Predictor, in either direction — see docs/game-engine.md § GE-18.

import type { GameType } from './types.ts'
import type { GameEngine } from './contracts.ts'
import { UnknownGameTypeError } from './errors.ts'

const registry = new Map<GameType, GameEngine>()

export function registerEngine(gameType: GameType, engine: GameEngine): void {
  if (registry.has(gameType)) {
    throw new Error(`A Game Engine is already registered for "${gameType}"`)
  }
  registry.set(gameType, engine)
}

export function resolveEngine(gameType: GameType): GameEngine {
  const engine = registry.get(gameType)
  if (!engine) {
    throw new UnknownGameTypeError(gameType)
  }
  return engine
}

export function isRegistered(gameType: GameType): boolean {
  return registry.has(gameType)
}

// Test-only — lets a unit test start from a clean registry between cases
// instead of depending on module load order.
export function _resetRegistryForTests(): void {
  registry.clear()
}
