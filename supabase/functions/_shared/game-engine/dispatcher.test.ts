// Tests the dispatcher's own mechanics (registration/resolution) only — no
// game mode exists yet, so there is nothing to test about scoring, locking,
// or settlement here. See docs/game-engine.md § GE-12: Milestones 4-6 will
// each add their own tests alongside their GameEngine implementation.

import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import type { GameEngine } from './contracts.ts'
import {
  _resetRegistryForTests,
  isRegistered,
  registerEngine,
  resolveEngine,
} from './dispatcher.ts'
import { UnknownGameTypeError } from './errors.ts'

const stubEngine: GameEngine = {
  validateEntry: () => Promise.resolve(),
  lockEntries: () => Promise.resolve(0),
  calculateScore: () => Promise.resolve(),
  settle: () => Promise.resolve(),
  generateStandings: () => Promise.resolve([]),
  determineWinner: () => Promise.resolve([]),
  awardPrize: () => Promise.resolve(),
  notifyUsers: () => Promise.resolve(),
}

Deno.test('resolveEngine returns the engine registered for that game type', () => {
  _resetRegistryForTests()
  registerEngine('pick5', stubEngine)

  assertEquals(resolveEngine('pick5'), stubEngine)
})

Deno.test('resolveEngine throws UnknownGameTypeError when nothing is registered', () => {
  _resetRegistryForTests()

  assertThrows(() => resolveEngine('last_man_standing'), UnknownGameTypeError)
})

Deno.test('registerEngine refuses a second registration for the same game type', () => {
  _resetRegistryForTests()
  registerEngine('score_predictor', stubEngine)

  assertThrows(() => registerEngine('score_predictor', stubEngine))
})

Deno.test('isRegistered reflects registry state without throwing', () => {
  _resetRegistryForTests()

  assertEquals(isRegistered('pick5'), false)
  registerEngine('pick5', stubEngine)
  assertEquals(isRegistered('pick5'), true)
})

Deno.test('each game type is independent of the others', () => {
  _resetRegistryForTests()
  registerEngine('pick5', stubEngine)

  assertEquals(isRegistered('last_man_standing'), false)
  assertEquals(isRegistered('score_predictor'), false)
})
