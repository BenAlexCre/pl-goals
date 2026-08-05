// Pure, side-effect-free request validation — same split as
// get-or-create-pick5-entry/validate.ts. No gameweek_id here: LMS entries
// are season-scoped (GE-4.5 — one entry per (pot, user) for the pot's whole
// life), unlike Pick 5's gameweek-scoped entries, so there's no per-request
// gameweek to validate.

export interface EntryRequestBody {
  pot_id?: unknown
}

export type ValidationResult =
  | { ok: true; potId: string }
  | { ok: false; error: string }

export function validateEntryRequest(body: EntryRequestBody): ValidationResult {
  if (typeof body.pot_id !== 'string' || body.pot_id.length === 0) {
    return { ok: false, error: 'pot_id is required' }
  }
  return { ok: true, potId: body.pot_id }
}
