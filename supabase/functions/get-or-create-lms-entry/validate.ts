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

// ISSUE-32 (docs/current-state.md) / GE-5.2's entry-window rule, decided
// 2026-08-05: a normal LMS pot's window closes forever once its
// start_gameweek's first fixture kicks off — no late entry, ever, after
// that. The one exception is a Game-Engine-created rollover pot
// (rollover_source_pot_id set), whose window is simply "still status =
// 'draft'" — no date arithmetic needed there at all, since the organiser's
// own pre-launch workflow (invite/verify/choose start gameweek) is exactly
// what "the window" means for a rollover pot. Pure and DB-free, same split
// as validateEntryRequest above — index.ts supplies the already-fetched
// pot/gameweek fields.
export interface EntryWindowInput {
  rolloverSourcePotId: string | null
  potStatus: string
  startGameweekId: number | string | null
  startGameweekKickoffUtc: string | null
  now: Date
}

export type EntryWindowResult = { ok: true } | { ok: false; error: string }

export function checkEntryWindow(input: EntryWindowInput): EntryWindowResult {
  if (input.rolloverSourcePotId !== null) {
    if (input.potStatus !== 'draft') {
      return {
        ok: false,
        error: 'This rollover competition has already started — entry is no longer open',
      }
    }
    return { ok: true }
  }

  if (input.startGameweekId === null || input.startGameweekKickoffUtc === null) {
    return { ok: false, error: 'This pot has no start gameweek configured yet' }
  }

  if (input.now.getTime() >= new Date(input.startGameweekKickoffUtc).getTime()) {
    return {
      ok: false,
      error: 'Entry window has closed — Last Man Standing pots can only be joined before the competition starts',
    }
  }

  return { ok: true }
}
