// Pure row-classification logic for bulk CSV payment verification — split
// out from index.ts so it's unit-testable without a live database, same
// pattern as validate.ts in the other new Edge Functions (get-or-create-
// pick5-entry, submit-pick5-picks). Every DB read (users, pots, pot
// memberships, existing entry_payments state) happens in index.ts and is
// handed in here as pre-resolved lookup maps — this function only decides,
// per row, what the outcome is and what (if anything) should be written.

export interface BulkPaymentRow {
  identifier?: string
  pot?: string
  status?: string
  notes?: string
}

export type RowOutcome = 'updated' | 'skipped' | 'failed'

export interface RowResult {
  row: number // 1-based, matches the row's position in the submitted CSV
  identifier: string
  pot: string
  status: string
  outcome: RowOutcome
  reason?: string
}

export interface BulkPaymentSummary {
  processed: number
  updated: number
  skipped: number
  failed: number
}

export interface ResolvedLookups {
  // Identifier resolution — email lookup is case-insensitive (keys are
  // lowercased), phone lookup is exact-match only (see index.ts's comment
  // on why phone normalization is deliberately out of scope).
  usersByEmail: Map<string, string>
  usersByPhone: Map<string, string>
  // Pot name -> every pot_id with that exact name. Length 0 = unknown pot,
  // length > 1 = ambiguous (pots.name has no unique constraint).
  potsByName: Map<string, string[]>
  // pot_ids the caller is authorized to verify payments for (pot-admin of,
  // or every resolved pot if the caller is an app admin).
  authorizedPotIds: Set<string>
  // `${potId}:${userId}` pairs that are real pot_members rows.
  potMemberships: Set<string>
  // `${potId}:${userId}` -> current entry_payments.is_paid, if a row
  // already exists for this gameweek.
  existingPayments: Map<string, boolean>
}

export interface WriteRow {
  pot_id: string
  user_id: string
  is_paid: boolean
  notes: string | null
}

function fail(rowNum: number, row: BulkPaymentRow, reason: string): RowResult {
  return {
    row: rowNum,
    identifier: (row.identifier ?? '').trim(),
    pot: (row.pot ?? '').trim(),
    status: (row.status ?? '').trim(),
    outcome: 'failed',
    reason,
  }
}

export function classifyBulkPaymentRows(
  rows: BulkPaymentRow[],
  lookups: ResolvedLookups
): { results: RowResult[]; toWrite: WriteRow[]; summary: BulkPaymentSummary } {
  const results: RowResult[] = []
  const toWrite: WriteRow[] = []
  // Duplicate handling: within one CSV, the same (pot, user) pair appearing
  // more than once keeps the first occurrence and skips the rest — never
  // silently lets the last row win, which would make the outcome depend on
  // row order in a way nobody reviewing the preview could predict.
  const seenInBatch = new Set<string>()

  rows.forEach((row, index) => {
    const rowNum = index + 1
    const identifier = (row.identifier ?? '').trim()
    const potName = (row.pot ?? '').trim()
    const statusRaw = (row.status ?? '').trim()

    if (!identifier) {
      results.push(fail(rowNum, row, 'Missing identifier'))
      return
    }
    if (!potName) {
      results.push(fail(rowNum, row, 'Missing pot'))
      return
    }

    // Case-insensitive on purpose — real-world CSVs (exported from a
    // spreadsheet, typed by hand) won't reliably match "Paid"/"Unpaid"
    // exactly. Still only ever "Paid" or "Unpaid", per the fixed format.
    const statusNormalized = statusRaw.toLowerCase()
    if (statusNormalized !== 'paid' && statusNormalized !== 'unpaid') {
      results.push(fail(rowNum, row, `Invalid status "${statusRaw}" — must be "Paid" or "Unpaid"`))
      return
    }
    const isPaid = statusNormalized === 'paid'

    const potIds = lookups.potsByName.get(potName) ?? []
    if (potIds.length === 0) {
      results.push(fail(rowNum, row, `Unknown pot "${potName}"`))
      return
    }
    if (potIds.length > 1) {
      results.push(fail(rowNum, row, `Ambiguous pot name "${potName}" — ${potIds.length} pots share this exact name`))
      return
    }
    const potId = potIds[0]

    if (!lookups.authorizedPotIds.has(potId)) {
      results.push(fail(rowNum, row, `Not authorized to verify payments for "${potName}"`))
      return
    }

    // Identifier may be email or phone (business-rules.md § Payment
    // verification rules) — email is any identifier containing '@',
    // matched case-insensitively; anything else is treated as a phone
    // number. Confirmed live against this project's GoTrue instance:
    // auth.users.phone is stored WITHOUT a leading '+' even when the user
    // was created with one (E.164 in, digits-only out) — a leading '+' is
    // stripped here so a CSV using the standard E.164 display convention
    // ("+353871234567") still matches. Otherwise exact-match only — no
    // further normalization (spacing, leading zeros, country-code
    // guessing) is attempted; see index.ts for why that's deliberately
    // out of scope.
    const isEmail = identifier.includes('@')
    const userId = isEmail
      ? lookups.usersByEmail.get(identifier.toLowerCase())
      : lookups.usersByPhone.get(identifier.replace(/^\+/, ''))
    if (!userId) {
      results.push(fail(rowNum, row, `Unknown user for identifier "${identifier}"`))
      return
    }

    const memberKey = `${potId}:${userId}`
    if (!lookups.potMemberships.has(memberKey)) {
      results.push(fail(rowNum, row, `User is not a member of "${potName}"`))
      return
    }

    if (seenInBatch.has(memberKey)) {
      results.push({
        row: rowNum,
        identifier,
        pot: potName,
        status: statusRaw,
        outcome: 'skipped',
        reason: 'Duplicate identifier+pot in this import — the first occurrence was already processed',
      })
      return
    }
    seenInBatch.add(memberKey)

    const existing = lookups.existingPayments.get(memberKey)
    if (existing === isPaid) {
      results.push({
        row: rowNum,
        identifier,
        pot: potName,
        status: statusRaw,
        outcome: 'skipped',
        reason: `Already marked ${isPaid ? 'Paid' : 'Unpaid'} — no change needed`,
      })
      return
    }

    toWrite.push({ pot_id: potId, user_id: userId, is_paid: isPaid, notes: row.notes?.trim() || null })
    results.push({ row: rowNum, identifier, pot: potName, status: statusRaw, outcome: 'updated' })
  })

  const summary: BulkPaymentSummary = {
    processed: rows.length,
    updated: results.filter((r) => r.outcome === 'updated').length,
    skipped: results.filter((r) => r.outcome === 'skipped').length,
    failed: results.filter((r) => r.outcome === 'failed').length,
  }

  return { results, toWrite, summary }
}
