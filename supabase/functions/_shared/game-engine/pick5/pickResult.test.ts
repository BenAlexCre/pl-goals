import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { derivePickResult } from './pickResult.ts'

const r = (goals: number, statuses: string[], threshold = 1) => derivePickResult({ goals, threshold, teamFixtureStatuses: statuses })

Deno.test('ISSUE-85: before kickoff a pick is pending, never lost', () => {
  assertEquals(r(0, ['scheduled']), 'pending')
  assertEquals(r(0, ['tbd']), 'pending') // unconfirmed kickoff
})

Deno.test('ISSUE-85: delayed kickoff stays pending until the provider reports it live (status, not clock)', () => {
  assertEquals(r(0, ['scheduled']), 'pending')
})

Deno.test('ISSUE-85: during the player\'s match -> winning / losing', () => {
  assertEquals(r(1, ['live']), 'winning')
  assertEquals(r(0, ['live']), 'losing')
})

Deno.test('ISSUE-85: after the player\'s match -> won / lost', () => {
  assertEquals(r(2, ['finished']), 'won')
  assertEquals(r(0, ['finished']), 'lost')
})

Deno.test('ISSUE-85: threshold above one goal', () => {
  assertEquals(r(1, ['finished'], 2), 'lost')
  assertEquals(r(2, ['finished'], 2), 'won')
  assertEquals(r(1, ['live'], 2), 'losing')
})

Deno.test('ISSUE-85: postponed or cancelled match -> pending (not played this gameweek)', () => {
  assertEquals(r(0, ['postponed']), 'pending')
  assertEquals(r(0, ['cancelled']), 'pending')
})

Deno.test('ISSUE-85: rescheduled into the same gameweek -> follows the new fixture status', () => {
  assertEquals(r(0, ['scheduled']), 'pending')
  assertEquals(r(1, ['live']), 'winning')
})

Deno.test('ISSUE-85: missing fixture data -> pending; won only if goals were recorded', () => {
  assertEquals(r(0, []), 'pending')
  assertEquals(r(1, []), 'won')
})

Deno.test('ISSUE-85: abandoned/suspended (provider maps to tbd) keeps goals already scored', () => {
  assertEquals(r(1, ['tbd']), 'winning')
  assertEquals(r(0, ['tbd']), 'pending')
})

Deno.test('ISSUE-85: double gameweek — final only when every expected match is finished', () => {
  assertEquals(r(0, ['finished', 'scheduled']), 'losing') // still a match to play
  assertEquals(r(1, ['finished', 'scheduled']), 'winning')
  assertEquals(r(0, ['finished', 'finished']), 'lost')
  assertEquals(r(1, ['finished', 'live']), 'winning')
})

Deno.test('ISSUE-85: a postponed second match does not hold the pick open (matches gameweek completion)', () => {
  assertEquals(r(0, ['finished', 'postponed']), 'lost')
  assertEquals(r(1, ['finished', 'postponed']), 'won')
})
