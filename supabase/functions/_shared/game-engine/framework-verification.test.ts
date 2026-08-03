// Phase 1 framework verification (see session-log.md for the request this
// answers). Proves the architecture described in docs/game-engine.md
// actually behaves as specified, using the TestGameEngine fixture in
// __fixtures__/test-game-engine.ts.
//
// Complements dispatcher.test.ts, which covers the dispatcher's registry
// mechanics in isolation with a bare-bones inline stub. This suite exercises
// the same mechanics through a more realistic engine and adds the one thing
// dispatcher.test.ts doesn't cover: proving dependency injection actually
// flows end to end, not just that the types line up.
//
// This file and its fixture are framework verification only — neither is a
// reference implementation for Pick 5 or any other mode.

import {
  assertEquals,
  assertStrictEquals,
  assertThrows,
} from 'https://deno.land/std@0.224.0/assert/mod.ts'
import type { GameEngineContext } from './contracts.ts'
import { _resetRegistryForTests, registerEngine, resolveEngine } from './dispatcher.ts'
import { UnknownGameTypeError } from './errors.ts'
import { TestGameEngine } from './__fixtures__/test-game-engine.ts'

function fakeContext(fixedNow: Date) {
  const supabaseMarker = Symbol('fake-supabase-client')
  // The framework itself never calls anything on ctx.supabase — only a real
  // implementation would. A fake object carrying an identifiable marker is
  // enough to prove the exact same reference survives the trip through the
  // dispatcher and into the engine, without needing a real DB connection.
  const fakeSupabase = { __marker: supabaseMarker } as unknown as GameEngineContext['supabase']
  const ctx: GameEngineContext = { supabase: fakeSupabase, now: () => fixedNow }
  return { ctx, supabaseMarker }
}

// 1. Engine registration works.
Deno.test('framework verification: registration works', () => {
  _resetRegistryForTests()
  const engine = new TestGameEngine()

  registerEngine('pick5', engine)

  assertStrictEquals(resolveEngine('pick5'), engine)
})

// 2. Engine resolution works.
Deno.test('framework verification: resolution returns the exact registered instance', () => {
  _resetRegistryForTests()
  const engine = new TestGameEngine()
  registerEngine('last_man_standing', engine)

  assertStrictEquals(resolveEngine('last_man_standing'), engine)
})

// 3. Unknown engines throw the expected error.
Deno.test('framework verification: unknown engine throws UnknownGameTypeError', () => {
  _resetRegistryForTests()

  const error = assertThrows(() => resolveEngine('score_predictor'), UnknownGameTypeError)
  assertEquals(error.message, 'No Game Engine registered for game_type "score_predictor"')
})

// 4. Duplicate registration is handled correctly.
Deno.test('framework verification: duplicate registration throws and does not replace the original', () => {
  _resetRegistryForTests()
  const first = new TestGameEngine()
  const second = new TestGameEngine()
  registerEngine('pick5', first)

  assertThrows(() => registerEngine('pick5', second))
  assertStrictEquals(resolveEngine('pick5'), first, 'original registration must be untouched')
})

// 5. Dependency injection via GameEngineContext works correctly — part one:
// the same supabase client reference flows through unmodified.
Deno.test('framework verification: DI — same supabase reference flows through unmodified', async () => {
  _resetRegistryForTests()
  const engine = new TestGameEngine()
  registerEngine('pick5', engine)
  const { ctx, supabaseMarker } = fakeContext(new Date('2026-08-03T12:00:00Z'))

  await resolveEngine('pick5').lockEntries(ctx, 42)

  assertEquals(engine.calls.length, 1)
  const call = engine.calls[0]
  assertEquals(call.method, 'lockEntries')
  assertEquals(call.args, [42])
  assertStrictEquals(
    (call.ctx.supabase as unknown as { __marker: symbol }).__marker,
    supabaseMarker,
  )
})

// 5. Dependency injection — part two: the injected clock is actually
// invoked by the implementation, not merely present on the context object.
Deno.test('framework verification: DI — injected clock is invoked, not just passed', async () => {
  _resetRegistryForTests()
  const engine = new TestGameEngine()
  registerEngine('pick5', engine)
  const fixedNow = new Date('2026-08-03T12:00:00Z')
  const { ctx } = fakeContext(fixedNow)

  await resolveEngine('pick5').settle(ctx, 7)

  assertEquals(engine.calls[0].nowAtCallTime.toISOString(), fixedNow.toISOString())
})

// Bonus: proves isolation between modes, which the whole entry architecture
// (GE-4.5) depends on — calling one mode's engine must never touch another's.
Deno.test('framework verification: different game types resolve to independent engines', async () => {
  _resetRegistryForTests()
  const pick5Engine = new TestGameEngine()
  const lmsEngine = new TestGameEngine()
  registerEngine('pick5', pick5Engine)
  registerEngine('last_man_standing', lmsEngine)
  const { ctx } = fakeContext(new Date())

  await resolveEngine('pick5').calculateScore(ctx, 1)

  assertEquals(pick5Engine.calls.length, 1)
  assertEquals(lmsEngine.calls.length, 0)
})
