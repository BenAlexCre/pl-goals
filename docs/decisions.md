# Decisions

Last reviewed: 2026-08-03. This project has no prior ADRs, design docs, or commit
history to draw explicit rationale from (see
[current-state.md ISSUE-5](./current-state.md#issue-5--repository-has-no-git-history-secrets-arent-excluded-from-version-control)).
The entries below are **decisions inferred from the code as it exists**, framed as
"what was chosen and what it implies," not verified first-hand accounts of why.

This document is append-only and rarely changes existing entries — it's a historical
record of *why*, not a status tracker. Where a decision has since produced a live,
open problem, the entry links to the relevant `ISSUE-N` in
[current-state.md](./current-state.md) rather than describing the problem's current
status inline, since that status can change (get fixed, get worse) independently of
why the original choice was made.

Going forward, add a new dated entry here whenever a non-obvious architectural choice
is made, per `CLAUDE.md`'s instruction to explain tradeoffs before major refactors.
Format: **what**, **why**, **what it rules out**.

See also: [architecture.md](./architecture.md) (the structure these decisions
produced), [current-state.md](./current-state.md) (live status of anything referenced
below).

---

## RLS-first authorization, not an application backend

**What:** There is no custom backend server. The browser talks to Postgres directly
through PostgREST, and every table has Row Level Security policies that are the sole
authorization mechanism for normal reads/writes. Edge functions exist only for the
subset of operations that need to bypass RLS (admin actions, scheduled jobs, external
API calls) or use a secret that can't be shipped to the browser (api-football key).

**Why (inferred):** This is the standard Supabase application shape — it avoids
running and hosting a separate API server, and pushes authorization as close to the
data as possible so it can't be bypassed by a buggy client. It also means Supabase
Realtime subscriptions (used for live score updates) automatically respect the same
RLS rules as regular queries.

**What it rules out / costs:** Business logic that would normally live in a service
layer (validation, cross-table invariants) has to live either in Postgres (constraints,
triggers, RLS policies — see `recompute_goal_thresholds()`, `create_entry_payment()`
in [database.md](./database.md#functions--triggers)) or be duplicated client-side (see
`useSubmitPicks`'s deadline/eligibility checks, enforced again — necessarily, since a
client-side check alone couldn't be trusted). It also means a policy bug silently
blocks a whole flow with no application-level error handling to fall back on — see
[current-state.md ISSUE-1](./current-state.md#issue-1--pot-creation-likely-violates-its-own-rls-policy)
for a concrete instance.

---

## TanStack Query for server state, Zustand for client state

**What:** `hooks/*.js` wrap Supabase calls in `useQuery`/`useMutation` from
`@tanstack/react-query`; `store/authStore.js` and `store/uiStore.js` use `zustand` for
session/profile and ephemeral UI state (toasts, drawer).

**Why (inferred):** Standard, low-boilerplate pairing for a Supabase + React app —
React Query gives caching/retry/invalidation for server data "for free," Zustand
avoids Context-provider boilerplate for the small amount of genuinely global client
state (auth session, toast queue).

**What it rules out:** This pairing is only followed in roughly two-thirds of the
codebase — see the next entry.

---

## (Apparent drift, not a decision) Two parallel data-fetching patterns

**What actually happened, as best it can be reconstructed from the code:** `Dashboard`,
`PicksPage`, `GameweekPage`, and `AdminDashboard` all go through the `hooks/` +
React Query layer described above. `PotDetail.jsx` (the single largest page component
in the app) and `components/pot/potManager.jsx` instead fetch everything with local
`useState`/`useEffect` and raw `supabase.from(...)` calls, re-implementing logic that
already exists in `hooks/usePots.js` and `hooks/useEntry.js`.

**Most likely explanation:** these two files were probably written before the
`hooks/`/React-Query layer existed (or during a parallel exploration branch — the
World Cup script naming in `frontend/scripts/` suggests this codebase may have
started life targeting a different tournament and been repointed at the Premier
League), and never migrated onto it once it did.

**Recommendation:** treat this as tech debt to resolve, not as an intentional
two-pattern architecture — the divergence has already produced one concrete bug
(goalkeeper-exclusion rule present in one flow, absent in the other). Tracking and fix
plan: [current-state.md ISSUE-10](./current-state.md#issue-10--duplicated-data-fetching-pattern)
/ [roadmap.md § P2](./roadmap.md#p2--cleanup--consolidation).

---

## Provider abstraction was planned but never completed

**What:** `frontend/src/lib/footballDataProvider.js` opens with the comment "Provider
abstraction layer — swap the implementation here without touching any other file,"
suggesting an intent to have one interchangeable module that the rest of the app calls
regardless of which upstream API is in use. In practice, nothing calls
`footballDataProvider.js`; the actually-wired sync path (`supabase/functions/
sync-fixtures`) talks to api-football directly with no abstraction, and three more
standalone scripts each independently implement their own football-data.org fetch
logic — see [current-state.md ISSUE-12](./current-state.md#issue-12--overlapping-unused-football-dataorg-sync-scripts).

**Why this matters going forward:** if a real provider abstraction is still wanted
(e.g. to make it easy to switch from api-football to football-data.org, or to support
both), it should be designed as an edge-function-side abstraction (since that's where
the actual sync logic lives today), not a frontend `lib/` module — the frontend never
talks to these providers directly and shouldn't need to.

---

## Duplicate-pick scoring model (goal thresholds via trigger)

**What:** A user can pick the same player multiple times (up to 5). Rather than
storing a "threshold" the client computes and sends, the `recompute_goal_thresholds()`
trigger derives it authoritatively in Postgres from the count of matching
`(entry_id, player_id)` rows in `user_entry_picks`, every time a pick is inserted or
deleted for that entry. Full mechanism: [database.md § user_entry_picks](./database.md#user_entry_picks).

**Why (inferred):** Prevents a client from lying about or miscalculating the
threshold — it's derived, not submitted. Consistent with the RLS-first philosophy
above: don't trust the client with values that determine scoring outcomes.

**What it rules out:** Picks can only be added one row at a time in a way that keeps
this trigger correct (bulk-replacing all of an entry's picks, as `useSubmitPicks` and
`PotDetail.jsx` both do — delete all, then insert all — works fine since the trigger
fires per-row-affected on both the delete and the insert). A partial update (e.g. "just
change pick #3") would need to go through the same delete/recreate to stay correct
rather than an in-place `update`, since there's no trigger path for `UPDATE` on this
table (only `insert or delete`) — a bare `update` on `user_entry_picks.player_id`
would **not** recompute thresholds for either the old or new player. No current code
path does this kind of partial update, but it's a trap for future code: if you add
one, either recompute thresholds manually for both the old and new `player_id`, or
route it through the trigger by deleting and re-inserting instead.

---

## Unpaid entries are voided automatically at scoring time, not at submission time

**What:** A user can submit picks for a gameweek regardless of payment status —
`entry_payments` starts `is_paid: false` by default and nothing blocks pick
submission on it. Voiding only happens inside `compute-scores`, which checks payment
status per-entry before scoring it (see [api.md § compute-scores](./api.md#post-functionsv1compute-scores)).

**Why (inferred):** Decouples "can play" from "has paid" at submission time, likely so
payment collection (presumably cash/bank-transfer between people in a private pot, not
an in-app payment processor — there's no payment provider integration anywhere in the
repo) can happen on its own schedule without blocking someone from getting their picks
in before the deadline.

**What it rules out / current risk:** this design assumes payment gets marked before
`compute-scores` runs — an assumption that doesn't currently hold, since there is no
UI to mark a payment. Live status: [current-state.md ISSUE-6](./current-state.md#issue-6--payment-verification-has-no-ui-or-bulk-import-compute-scoressettle-will-void-every-entry).
Once payments UI exists, this design still leaves open a real product question worth
deciding deliberately: should the deadline for marking paid be before or after the
pick deadline?

---

## Three-game-mode platform rebuild: shared `game_entries` parent, not per-mode entry tables

**What:** The product is being rebuilt to launch with three first-class game modes
(Pick 5, Last Man Standing, Score Predictor), each pot locked to exactly one
immutable `game_type`. Rather than three independent entry/pick table sets, entries
share one parent table (`game_entries`) with thin, mode-specific extension tables
(`game_entry_pick5`, `game_entry_lms`, `game_entry_predictor`); picks stay fully
separate and typed per mode (`pick5_picks`/`lms_picks`/`predictor_picks`), never a
polymorphic JSON table. Full specification: [game-engine.md](./game-engine.md).

**Why:** three real, simultaneously-launching modes genuinely share the entry
concept (a pot/user pairing with a payout and a settlement lifecycle) — building it
three times would triple the payment-integration, RLS, and dashboard-query surface
for no benefit. Picks stay separate because the three modes reference genuinely
different foreign keys (players, teams, fixtures/scores) that a JSON payload
couldn't be FK-constrained against without giving up real referential integrity.

**What it rules out:** hybrid pots (a pot can never contain more than one game
mode's entries — enforced structurally, not just by policy) and any future
temptation to store a pick as an untyped blob for "flexibility." Also rules out
preserving the previously-undocumented `supabase_admin`-owned LMS/Predictor
prototype objects as the actual implementation — they're treated as a signal of
business intent only; two real bugs were found in them during reverse-engineering
(a referenced-but-never-created `lms_tiebreak_picks` table, and a `'winner'` enum
value used but never added), confirming they were never a working reference to
preserve. See [current-state.md ISSUE-20/ISSUE-21](./current-state.md#issue-20--prototype-tables-have-rls-disabled-and-full-anonymous-write-access)
for the live state of the objects being replaced.

---

## Settlement logic lives in Edge Functions only, never in SQL functions

**What:** All game-mode business logic — validation, scoring, settlement, payouts,
standings — is implemented in TypeScript inside Edge Functions (the "Game Engine,"
[game-engine.md § GE-6](./game-engine.md#ge-6-the-game-engine-contract)), dispatched
by `pots.game_type`. SQL functions are limited to deriving or defaulting a column
value from the row(s) being written (`set_updated_at`, `create_entry_payment`,
`prevent_pot_contract_change`) — never orchestrating a multi-step business process.

**Why:** this is a return to the pattern the original `compute-scores`/`settle-gameweek`
Edge Functions already established, after the retired prototype broke from it. The
prototype's SQL-function approach (`settle_gameweek`, `settle_lms_gameweek`,
`settle_predictor_gameweek`, `settle_predictor_season`, `compute_live_scores`)
produced two confirmed bugs and, for a time, an `anon`-callable `EXECUTE` grant on
money-adjacent functions with no internal authorization check — see
`session-log.md`'s Phase C. TypeScript in Edge Functions is unit-testable in
isolation (Deno's built-in test runner, no new dependency) in a way raw PL/pgSQL
functions in this codebase have not been.

**What it rules out:** any future temptation to "just add a quick SQL function" for
settlement convenience. A greenfield architectural review
([schema-review.md](./schema-review.md)) is the standard this and every future
migration is now held to, specifically to catch this kind of drift before it ships
rather than after.

---

## Payment Verification, not payment processing

**Decided 2026-08-05, explicitly by the repo owner** — unlike every entry above this
one, this is a directly-stated decision, not inferred from code.

**What:** The application will never collect, process, or hold money. Payment
collection happens entirely outside the platform (Revolut, bank transfer, cash, or
any other means two people agree on). The application's only job is to record
**whether an entry has been verified as paid**, by an admin — either one at a time, or
in bulk via a CSV import matching members by email or phone number. This formalizes
and extends what the "[Unpaid entries are voided automatically at scoring time, not
at submission time](#unpaid-entries-are-voided-automatically-at-scoring-time-not-at-submission-time)"
entry above already inferred from the code (no payment provider integration exists
anywhere in the repo) — the difference is that it's now an explicit, permanent design
constraint, not an artifact of what happened to get built, and it comes with two new
required admin capabilities that don't exist yet: single-entry manual verification,
and bulk verification via CSV import (format, validation, and audit requirements in
[business-rules.md § Payment verification rules](./business-rules.md#payment-verification-rules)).

**Why:** Removes an entire category of scope, risk, and compliance burden from the
MVP — no PCI handling, no payment-gateway integration/webhooks/reconciliation, no
liability for holding member funds. Pots are private, trust-based groups where
money already changes hands off-platform in practice (per the original inferred
decision); the app's job is to be a reliable, auditable record of that, not to
intermediate it.

**What it rules out:** Any Stripe, PayPal, Revolut-API, or other payment-gateway
integration, now or later, as part of this application's core design — not merely
"not yet built." `Pick5Engine.settle()` (Milestone 4, Slice 5) already depends only
on `entry_payments.is_paid`, a boolean the application controls entirely — this
decision confirms that dependency is correct and permanent, not a placeholder for a
future payment-gateway webhook. Any future "collect payment in-app" feature would be
a reversal of this decision, not an extension of it, and would need its own ADR
entry here — not a silent addition.

**Status:** documentation updated 2026-08-05 to use "Payment Verification" as the
canonical term throughout ([architecture.md](./architecture.md),
[business-rules.md](./business-rules.md), [roadmap.md](./roadmap.md),
[current-state.md § ISSUE-6](./current-state.md#issue-6--payment-verification-has-no-ui-or-bulk-import-compute-scoressettle-will-void-every-entry)).
Implementation (single-entry admin UI, CSV importer) not yet built — see
`project-board.md` for when it's scheduled.
