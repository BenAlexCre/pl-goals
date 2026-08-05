import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { classifyBulkPaymentRows, type ResolvedLookups } from './bulkPayments.ts'

function baseLookups(overrides: Partial<ResolvedLookups> = {}): ResolvedLookups {
  return {
    usersByEmail: new Map([['ben@example.com', 'user-ben'], ['adam@example.com', 'user-adam']]),
    usersByPhone: new Map([['0871234567', 'user-phone']]),
    potsByName: new Map([['Premier League Pool', ['pot-1']]]),
    authorizedPotIds: new Set(['pot-1']),
    potMemberships: new Set(['pot-1:user-ben', 'pot-1:user-adam', 'pot-1:user-phone']),
    existingPayments: new Map(),
    ...overrides,
  }
}

Deno.test('marks a new row as updated and queues the write', () => {
  const { results, toWrite, summary } = classifyBulkPaymentRows(
    [{ identifier: 'ben@example.com', pot: 'Premier League Pool', status: 'Paid', notes: 'Revolut' }],
    baseLookups()
  )
  assertEquals(results, [{ row: 1, identifier: 'ben@example.com', pot: 'Premier League Pool', status: 'Paid', outcome: 'updated' }])
  assertEquals(toWrite, [{ pot_id: 'pot-1', user_id: 'user-ben', is_paid: true, notes: 'Revolut' }])
  assertEquals(summary, { processed: 1, updated: 1, skipped: 0, failed: 0 })
})

Deno.test('blank notes become null, not an empty string', () => {
  const { toWrite } = classifyBulkPaymentRows(
    [{ identifier: 'ben@example.com', pot: 'Premier League Pool', status: 'Paid', notes: '   ' }],
    baseLookups()
  )
  assertEquals(toWrite[0].notes, null)
})

Deno.test('status is case-insensitive', () => {
  const { toWrite } = classifyBulkPaymentRows(
    [{ identifier: 'ben@example.com', pot: 'Premier League Pool', status: 'PAID' }],
    baseLookups()
  )
  assertEquals(toWrite[0].is_paid, true)
})

Deno.test('email identifier is matched case-insensitively', () => {
  const { toWrite } = classifyBulkPaymentRows(
    [{ identifier: 'BEN@EXAMPLE.COM', pot: 'Premier League Pool', status: 'Paid' }],
    baseLookups()
  )
  assertEquals(toWrite[0].user_id, 'user-ben')
})

Deno.test('phone identifier (no @) is matched exactly', () => {
  const { toWrite } = classifyBulkPaymentRows(
    [{ identifier: '0871234567', pot: 'Premier League Pool', status: 'Unpaid', notes: 'Chargeback' }],
    baseLookups()
  )
  assertEquals(toWrite[0], { pot_id: 'pot-1', user_id: 'user-phone', is_paid: false, notes: 'Chargeback' })
})

Deno.test('phone identifier with a leading "+" still matches — GoTrue stores phone digits-only', () => {
  // Confirmed live: a user created with phone "+353871234567" is stored by
  // GoTrue as auth.users.phone = "353871234567" (no '+'). usersByPhone's
  // keys reflect that real storage format; a CSV identifier typed in the
  // standard E.164 display form (with '+') must still resolve.
  const { toWrite } = classifyBulkPaymentRows(
    [{ identifier: '+353871234567', pot: 'Premier League Pool', status: 'Paid' }],
    baseLookups({
      usersByPhone: new Map([['353871234567', 'user-e164']]),
      potMemberships: new Set(['pot-1:user-ben', 'pot-1:user-adam', 'pot-1:user-phone', 'pot-1:user-e164']),
    })
  )
  assertEquals(toWrite[0]?.user_id, 'user-e164')
})

Deno.test('skips a row already in the target state', () => {
  const { results, toWrite, summary } = classifyBulkPaymentRows(
    [{ identifier: 'ben@example.com', pot: 'Premier League Pool', status: 'Paid' }],
    baseLookups({ existingPayments: new Map([['pot-1:user-ben', true]]) })
  )
  assertEquals(results[0].outcome, 'skipped')
  assertEquals(results[0].reason, 'Already marked Paid — no change needed')
  assertEquals(toWrite, [])
  assertEquals(summary, { processed: 1, updated: 0, skipped: 1, failed: 0 })
})

Deno.test('does write when the existing state differs from the target', () => {
  const { toWrite } = classifyBulkPaymentRows(
    [{ identifier: 'ben@example.com', pot: 'Premier League Pool', status: 'Paid' }],
    baseLookups({ existingPayments: new Map([['pot-1:user-ben', false]]) })
  )
  assertEquals(toWrite.length, 1)
})

Deno.test('duplicate identifier+pot in the same batch: keeps the first, skips the rest', () => {
  const { results, toWrite, summary } = classifyBulkPaymentRows(
    [
      { identifier: 'ben@example.com', pot: 'Premier League Pool', status: 'Paid' },
      { identifier: 'ben@example.com', pot: 'Premier League Pool', status: 'Unpaid' },
    ],
    baseLookups()
  )
  assertEquals(results[0].outcome, 'updated')
  assertEquals(results[1].outcome, 'skipped')
  assertEquals(results[1].reason, 'Duplicate identifier+pot in this import — the first occurrence was already processed')
  assertEquals(toWrite.length, 1, 'only the first occurrence is written')
  assertEquals(toWrite[0].is_paid, true, 'the first row\'s value wins, not the last')
  assertEquals(summary, { processed: 2, updated: 1, skipped: 1, failed: 0 })
})

Deno.test('fails a row with a missing identifier', () => {
  const { results } = classifyBulkPaymentRows([{ pot: 'Premier League Pool', status: 'Paid' }], baseLookups())
  assertEquals(results[0].outcome, 'failed')
  assertEquals(results[0].reason, 'Missing identifier')
})

Deno.test('fails a row with a missing pot', () => {
  const { results } = classifyBulkPaymentRows([{ identifier: 'ben@example.com', status: 'Paid' }], baseLookups())
  assertEquals(results[0].outcome, 'failed')
  assertEquals(results[0].reason, 'Missing pot')
})

Deno.test('fails a row with an invalid status', () => {
  const { results } = classifyBulkPaymentRows(
    [{ identifier: 'ben@example.com', pot: 'Premier League Pool', status: 'Pending' }],
    baseLookups()
  )
  assertEquals(results[0].outcome, 'failed')
  assertEquals(results[0].reason, 'Invalid status "Pending" — must be "Paid" or "Unpaid"')
})

Deno.test('fails a row with an unknown pot', () => {
  const { results } = classifyBulkPaymentRows(
    [{ identifier: 'ben@example.com', pot: 'Nonexistent Pool', status: 'Paid' }],
    baseLookups()
  )
  assertEquals(results[0].outcome, 'failed')
  assertEquals(results[0].reason, 'Unknown pot "Nonexistent Pool"')
})

Deno.test('fails a row with an ambiguous pot name', () => {
  const { results } = classifyBulkPaymentRows(
    [{ identifier: 'ben@example.com', pot: 'Premier League Pool', status: 'Paid' }],
    baseLookups({ potsByName: new Map([['Premier League Pool', ['pot-1', 'pot-2']]]) })
  )
  assertEquals(results[0].outcome, 'failed')
  assertEquals(results[0].reason, 'Ambiguous pot name "Premier League Pool" — 2 pots share this exact name')
})

Deno.test('fails a row for an unknown user', () => {
  const { results } = classifyBulkPaymentRows(
    [{ identifier: 'nobody@example.com', pot: 'Premier League Pool', status: 'Paid' }],
    baseLookups()
  )
  assertEquals(results[0].outcome, 'failed')
  assertEquals(results[0].reason, 'Unknown user for identifier "nobody@example.com"')
})

Deno.test('fails a row when the caller is not authorized for the resolved pot', () => {
  const { results } = classifyBulkPaymentRows(
    [{ identifier: 'ben@example.com', pot: 'Premier League Pool', status: 'Paid' }],
    baseLookups({ authorizedPotIds: new Set() })
  )
  assertEquals(results[0].outcome, 'failed')
  assertEquals(results[0].reason, 'Not authorized to verify payments for "Premier League Pool"')
})

Deno.test('fails a row when the resolved user is not a member of the resolved pot', () => {
  const { results } = classifyBulkPaymentRows(
    [{ identifier: 'ben@example.com', pot: 'Premier League Pool', status: 'Paid' }],
    baseLookups({ potMemberships: new Set() })
  )
  assertEquals(results[0].outcome, 'failed')
  assertEquals(results[0].reason, 'User is not a member of "Premier League Pool"')
})

Deno.test('a mixed batch produces a summary that adds up to processed', () => {
  const { summary } = classifyBulkPaymentRows(
    [
      { identifier: 'ben@example.com', pot: 'Premier League Pool', status: 'Paid' }, // updated
      { identifier: 'adam@example.com', pot: 'Premier League Pool', status: 'Paid' }, // skipped (already paid)
      { identifier: 'nobody@example.com', pot: 'Premier League Pool', status: 'Paid' }, // failed
      { identifier: '0871234567', pot: 'Premier League Pool', status: 'Unpaid' }, // updated
    ],
    baseLookups({ existingPayments: new Map([['pot-1:user-adam', true]]) })
  )
  assertEquals(summary, { processed: 4, updated: 2, skipped: 1, failed: 1 })
  assertEquals(summary.updated + summary.skipped + summary.failed, summary.processed)
})
