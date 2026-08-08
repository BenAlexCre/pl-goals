// Pure, side-effect-free request validation — same split as
// get-or-create-pick5-entry/validate.ts and get-or-create-lms-entry/validate.ts.
// No gameweek_id here: Score Predictor entries are season-scoped (GE-5.3 —
// cumulative points across the whole season), matching game_entry_predictor's
// own shape (a single aggregate row per entry, no gameweek dimension,
// existing since Milestone 2) — the same reasoning LMS's season-scoped
// entries already established (GE-4.5), not Pick 5's gameweek-scoped shape.
//
// Deliberately has NO entry-window check, unlike get-or-create-lms-entry's
// checkEntryWindow(). LMS's version exists because LMS pots carry a
// start_gameweek_id/rollover_source_pot_id shape to check against (GE-5.2).
// Score Predictor pots have neither column — whether a season-long,
// cumulative-scoring competition like this one should also close its entry
// window once the season starts is a genuine, unresolved product question
// (see the Milestone 6 architecture review, docs/decisions.md § Score
// Predictor architecture review), not answered here. Building one now would
// mean inventing a rule, not implementing an approved one — flagged, not
// guessed at, the same discipline LMS's own Slice 1 used for its two open
// questions before this exact kind of rule (ISSUE-32) was later decided.

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
