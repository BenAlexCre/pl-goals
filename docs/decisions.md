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

---

## `pot_prizes` row creation is lazy, inside `awardPrize()` — never pre-created

**Decided 2026-08-05**, following a focused design investigation requested ahead of
Milestone 4 Slice 8, before `awardPrize()` was implemented.

**What:** A `pot_prizes` row is created (and its `total_amount` computed) at exactly
one moment: inside a mode's own `awardPrize(ctx, potId)`, at the point that mode's
engine has decided a specific competition instance has concluded (for Pick 5, the
gameweek `settle()`/`generateStandings()`/`determineWinner()` just processed; for a
future season-scoped mode, whenever *its* engine decides the season — or half-cycle,
for Score Predictor — has ended). No row is pre-created at pot creation, gameweek
open, first entry, or first payment verification. `total_amount` is computed at that
same moment as `pots.entry_fee × count(that competition instance's verified-paid,
settled entries)` — read directly from `settle()`'s own already-finalized output, not
tracked or incremented separately.

**Why:** Every earlier-creation option (evaluated in full — pot creation, gameweek
open, first entry, first paid-entry-verified) shares the same fatal flaw: payment
verification can keep happening right up until settlement voids whatever's still
unverified, so any `total_amount` computed before that point is a snapshot that goes
stale the moment one more admin action happens, and would need reconciling against
the authoritative state at settlement anyway — making the early creation pure
overhead, not a head start. Lazy creation instead computes the total exactly once,
from the exact same finalized state `settle()` already produced, with no
reconciliation step and no staleness window. It also requires zero new shared-platform
hooks (no gameweek-open event exists to hang a trigger on; inventing one would blur
GE-3's platform/mode boundary for a mode-specific row), and generalizes cleanly to
LMS's season-long single payout and Score Predictor's variable half-cycle/full-cycle
boundaries — each mode's own `awardPrize()` decides its own "concluded" moment
entirely inside the Game Engine, with no platform code needing to know the difference.

**What it rules out:** Any pre-creation of `pot_prizes` rows anywhere outside
`awardPrize()` — including as a side effect of pot creation, entry creation, or
payment verification. Also rules out (for now — not decided, flagged as open) a
mid-week "live jackpot" display feature backed by a stored, incrementally-updated
`total_amount`; that would need to be served from a read-only on-demand query instead,
not this table, if ever built.

**Confirmed, not assumed: no migration is required.** `pot_prizes`' existing schema
(`004_game_engine_shared_platform.sql`) already has every column this design needs
(`total_amount`, `is_settled`, `settled_at`), and its existing RLS (only a `SELECT`
policy, confirmed live) already matches the pattern — `awardPrize()` writes via the
service-role client, same as every other Game Engine write, no client-insert policy
needed. The only real gap was application code (`awardPrize()` itself), not schema —
see [current-state.md](./current-state.md) / `session-log.md` for the full
investigation.

**Implementation note for Slice 8, recorded now so it isn't rediscovered the hard
way:** `pot_prizes` has the same shape of *partial* unique indexes
(`pot_prizes_gameweek_key ... WHERE scope = 'gameweek'`, `pot_prizes_season_key ...
WHERE scope = 'season'`) that caused a real, live-confirmed bug in Slice 6
(`generateStandings()`'s first attempt against `pot_standings_snapshots`'s identically-shaped
partial indexes — PostgREST's `upsert(onConflict: ...)` cannot target a partial
index). `awardPrize()` must use the same fix already established there
(`upsertStandingsGroup()`'s pattern): look up any existing row by its natural key
first, then write by `id` (the real, non-partial primary key) — never
`upsert(onConflict: 'pot_id,gameweek_id')` directly.

**Still open, deliberately not decided here — out of scope for this investigation:**
the exact `total_amount` formula (`entry_fee × verified-paid-settled-count` is the
default assumption used throughout this analysis, but whether an admin can ever
override or supplement it — e.g. a sponsor top-up, or rolling over an unclaimed
prior week's prize — is a genuine product question, not something to invent). Needs
a decision before `awardPrize()` is implemented, the same way Slice 2's goalkeeper
rule and Slice 6's tie-break rule each needed one.

**Resolved 2026-08-05** — the "`total_amount` formula" question above is now
answered by the entry below: `gross_amount = entry_fee × verified-paid-settled-count`,
with two independent, optional deductions on top.

---

## Prize pool deductions: Admin Fee and Charity Fee

**Decided 2026-08-05**, directly by the repo owner, ahead of Milestone 4 Slice 8.
Migration `010_prize_pool_deductions.sql` designed, reviewed, and **applied**;
`Pick5Engine.awardPrize()` implements this design as of Slice 8.

**What:** Two independent, optional deductions — an Admin Fee and a Charity Fee — may
be configured per pot, each as **None**, a **Fixed Amount**, or a **Percentage of the
gross prize pool**, never both a fixed amount and a percentage at once. Configuration
lives on `pots` (`admin_fee_type`/`admin_fee_amount`/`admin_fee_percentage`,
`charity_fee_type`/`charity_fee_amount`/`charity_fee_percentage`, a shared `fee_type`
enum) — shared platform data, reusable by any mode's `awardPrize()`, per GE-3. The
**calculated outcome** for a specific competition instance —
`pot_prizes.gross_amount` (renamed from `total_amount`), `admin_fee_amount`,
`charity_fee_amount`, and a `net_amount` **generated column**
(`gross_amount − admin_fee_amount − charity_fee_amount`) — lives on `pot_prizes`,
per the pot_prizes lifecycle decision above (lazy creation inside `awardPrize()`).
The calculation order is fixed: gross → admin fee → charity fee → net → determine
winner(s) → split net equally. **The Game Engine distributes only `net_amount`,
never `gross_amount`.**

**Why config lives on `pots`, not `pot_prizes` or a Pick-5-specific table:** the
requirement itself says "these are configuration values on the pot" — but more
importantly, this is the *same* boundary GE-3 already draws for Payments/Payment
Verification (shared, one implementation for every mode). LMS's season-long single
payout and Score Predictor's variable-cycle payouts need the identical gross → fees →
net calculation; putting the config anywhere Pick-5-specific would mean rebuilding it
per mode, which is exactly what GE-3 exists to prevent.

**Why the outcome (not just the config) is recorded on `pot_prizes`, structurally
enforced:** the requirement is explicit — "`pot_prizes` must record the calculated
outcome... not the configuration." A pot's fee configuration can (in principle) be
edited between competition instances (subject to the same immutability-once-entries-exist
rule as `entry_fee`, see below) — recording only the config on `pots` and deriving
fees fresh each time would make historical prize breakdowns silently reinterpret
themselves if the config ever changed later. Recording the actual euro amounts
deducted, per instance, on `pot_prizes` makes every past award permanently
self-explaining regardless of later config changes.

**Why `net_amount` is a generated column, not a fourth independently-written fact:**
identical reasoning to Milestone 2's review removing `game_entries.settled` (GE-13:
"two independently writable columns for one fact is a drift risk") — `net_amount`
is a pure function of the other three columns, so making it independently writable
would only create a way for it to silently disagree with its own inputs.

**Why "never both fixed and percentage" is a CHECK constraint, not just application
logic:** matches this project's own established pattern (GE-13: pot_scope/entry_scope
are explicit columns, "not an inference from nullability alone") — the same
discipline applied here means the invalid state (both fixed and percentage set, or
a type without its matching value) is simply impossible to write, not merely
discouraged by convention.

**Why the new pot columns join `entry_fee` in `prevent_pot_contract_change()`'s
guarded set:** changing a deduction rate mid-competition, after money/picks are
committed, is exactly the fairness problem GE-2 already identified for `entry_fee`
— extended here to cover the two new columns, not a new principle.

**Effects, as requested:**
- **Payment Verification:** none. Payment Verification determines *whether an entry
  counts toward the gross pool at all* (verified-paid + settled); fee deduction
  determines *how much of that gross gets distributed*. The two are orthogonal —
  `entry_payments` is never read by the deduction calculation, only by the
  gross-amount calculation that precedes it.
- **Pick 5:** `Pick5Engine.awardPrize()` (Slice 8, not yet built) computes gross,
  applies both deductions per the pot's config, writes the `pot_prizes` row, and
  splits only `net_amount` across `determineWinner()`'s result.
- **LMS / Score Predictor (future):** no new work needed when either mode is built —
  they read the same shared `pots` columns and reuse the identical gross → net
  formula inside their own `awardPrize()`, exactly like the gross-amount calculation
  itself already generalizes (per the pot_prizes lifecycle entry above).
- **Idempotency:** no new concern beyond what the pot_prizes lifecycle entry above
  already established — fee amounts are derived fresh from `gross_amount` and the
  pot's config each time, not accumulated, so re-running `awardPrize()` against an
  already-`is_settled` row remains a safe no-op.
- **Multiple winners:** split `net_amount` (never `gross_amount`) equally across
  however many `determineWinner()` returns — unchanged in kind from before this
  decision, just operating on `net_amount` instead of a pool with no deductions
  modeled.

**Two edge cases flagged, not silently resolved — matching the "zero eligible
winners: stop and ask" instruction rather than inventing behavior for money.
Both decided by the repo owner 2026-08-05, directly, not inferred:**
1. **A fixed fee (or the sum of both) could exceed a small gross pool.** Decision:
   `awardPrize()` must **fail loudly and not award** — catch the `net_amount >= 0`
   CHECK violation (or pre-check for it) and stop without creating a `pot_prizes`
   row, rather than clamping fees down to fit. An admin must fix the pot's fee
   configuration (or accept there's no prize that instance) before it can be
   re-run.
2. **`net_amount` may not divide evenly** across multiple tied winners. Decision:
   **round down** — each winner receives `floor(net_amount / winner_count)` to the
   nearest cent; any leftover remainder (at most `winner_count - 1` cents) is never
   paid out to anyone. Simple, deterministic, never favors one tied winner over
   another.

## Notifications: domain events, not delivery

**Decided 2026-08-05**, directly by the repo owner, as part of Milestone 4 Slice 9.
`Pick5Engine.notifyUsers()` implements this design; it was already the shape GE-4.8/
GE-8.7 committed to when the framework itself was designed (Milestone 3) — Slice 9
is the first slice to actually build it, not a change of direction.

**What:** `notifyUsers()` is a pure **domain-event emitter**. It inserts exactly one
row into `notifications` (`user_id`, `pot_id`, `type`, `payload` jsonb) and returns —
it never formats a message for a specific channel, never calls an external
provider, and never awaits anything beyond that one insert. Delivering the event
to a user beyond the in-app `notifications` inbox (email, push, SMS) is explicitly
a **future, separate Notification Service**, not part of the Game Engine, that
would read new rows from this table and dispatch them — undesigned and unbuilt
(`roadmap.md` item 19), consistent with GE-4.8's original "delivery beyond in-app
is out of scope" note.

**Why domain events, not direct sending:** the alternative — `notifyUsers()`
calling an email/push/SMS provider directly — would make the Game Engine's
money-critical settlement path (`settle()` → `awardPrize()` → `notifyUsers()`)
depend on the reliability, latency, and credentials of an external delivery
provider that doesn't exist yet for any channel. Emitting a durable database row
instead keeps the Game Engine's own correctness fully independent of delivery —
exactly the "keep notification delivery outside the Game Engine where practical"
requirement — and costs nothing extra today, since `notifications` (schema +
RLS) has existed since Milestone 3 specifically for this purpose.

**Event catalog implemented this slice:** one event, `pick5.prize_awarded` —
fired once per winner from inside `awardPrize()`, immediately after that
winner's `payout_amount` is durably written, carrying `{ gameweekId, amount }`.
`notifications.type` is free text at the schema level (GE-4.8); each mode
documents and owns its own catalog rather than the database enforcing one.

**Other candidate events considered, deliberately deferred, not implemented:**
an entry voided for unverified payment (`settle()`'s existing void path), and a
"results are in" notification for settled non-winners. Both are plausible
future events, but nothing in the codebase yet reads `notifications` (no UI
consumer exists at all), so adding untested event types with no way to verify
their payload shape against a real consumer would be speculative complexity,
not a real requirement — consistent with this project's standing "do not
invent behavior" discipline. Add them when a concrete consumer needs them.

**Where the call site lives, and why:** `awardPrize()` calls `this.notifyUsers()`
itself, inside its own per-winner payout loop — not `settle()`, despite the
Settlement sequence diagram (GE-19) drawing `notifyUsers()` as a sibling
self-call alongside `determineWinner()`/`awardPrize()`. That diagram illustrates
the general multi-mode framework (where "competition concluded" is a real
conditional, e.g. LMS/Predictor's season-long pots); for Pick 5 specifically,
`awardPrize()` already independently calls `determineWinner()` internally
(Slice 8, for the identical reason — it's the one method that already knows
whether this call is the real first-time settlement or an idempotent no-op).
Requiring `settle()` to duplicate that idempotency check just to decide whether
to notify would be redundant bookkeeping the callee has already resolved.

**How notification failures affect settlement — the one deliberate asymmetry
in this method:** every other write in `awardPrize()` throws on error and
aborts (fail loud, per the pot_prizes lifecycle/prize-pool-deductions
decisions above — money must never fail silently). The `notifyUsers()` call is
the single exception: it is wrapped in a local `try/catch` at its call site
inside `awardPrize()`'s payout loop, and a failure is logged (`console.error`)
and swallowed, never re-thrown. Rationale: by the time `notifyUsers()` runs for
a given winner, that winner's `pot_prizes` row and `payout_amount` are already
durably committed — the money is correct regardless of what happens next. A
notification is a lower-severity, best-effort side effect of an already-true
fact, not a precondition for it; letting a `notifications` write failure
unwind or block an already-correct payout, or stop the loop from paying
remaining winners, would make money correctness depend on a table that exists
purely for user convenience. `notifyUsers()` itself still throws on error like
every other GameEngine method (so it behaves predictably for any future direct
caller); the try/catch boundary belongs at this one call site, which is the
only place that knows this specific write is allowed to fail silently.

**Retries:** none implemented, and none needed at this layer. The only
operation `notifyUsers()` performs is a single insert into a table in the same
database every other write in this request already depends on — if that write
is failing, retrying it inline is unlikely to help and would only delay an
already-committed settlement. Real retry/backoff semantics belong to the
future delivery service (retrying actual network calls to an email/push/SMS
provider, the genuinely flaky part of this system), not to this domain-event
write — deferred along with that service itself, not silently dropped.

**Channels:** in-app only, implemented via the existing `notifications` table
+ RLS (`notifications_select_own`/`notifications_update_own`, Milestone 3).
Email, push, and SMS are explicitly future work for the not-yet-built
Notification Service, kept feasible by construction: `type` + `payload` jsonb
carry channel-agnostic domain data, with no channel-specific field baked into
the Game Engine's contract or this event's shape. Building multi-channel
routing, user contact-channel preferences, or provider integrations now — with
no delivery service to consume them and no schema for phone numbers/push
tokens/email opt-in — would be exactly the kind of unbuilt infrastructure this
project has consistently avoided (see "Payment Verification, not payment
processing" above for the same discipline applied to a different subsystem).

**How this extends to LMS and Score Predictor:** no new schema or pattern
needed. Each mode implements its own `notifyUsers()` (already required by the
fixed `GameEngine` contract) writing to the same `notifications` table with its
own `type` catalog — e.g. LMS's `alive`/`eliminated` transitions, Predictor's
per-fixture or per-cycle scoring outcomes. The domain-event/no-delivery split,
the "call from the method that already resolved idempotency," and the
"failure is caught and logged, never allowed to block money" pattern all
generalize identically — none of this slice's implementation is Pick-5-specific
except the one `pick5.prize_awarded` event type itself.

## Failure isolation: one pot's/gameweek's error must never block another's

**Decided 2026-08-05**, during the production hardening sprint audit, after live
evidence that it mattered: `Pick5PrizePoolExceededError` — a real, documented,
intentional failure mode (a misconfigured pot's fees exceed its gross pool) —
previously propagated, uncaught, out of `Pick5Engine.settle()`'s per-pot loop and
`settle-gameweek/index.ts`'s per-gameweek loop alike. One misconfigured pot could
silently halt standings/prize processing for every *other*, unrelated,
correctly-configured pot in the same gameweek, and every *other* gameweek in the
same batch invocation — with no structured error anywhere, since
`settle-gameweek` deliberately writes no `sync_runs` row (GE-19's Settlement
diagram doesn't call for one). This directly undermined the "fail loudly" intent
behind `Pick5PrizePoolExceededError`/`Pick5NoEligibleWinnersError` in the first
place (Milestone 4 Slice 8) — the errors were thrown loudly, into a void nothing
caught.

**What:** both loops now isolate each unit of work (pot, gameweek) in its own
try/catch, so a failure in one never prevents the others from being attempted.
`Pick5Engine.settle()`'s return type is part of the fixed `GameEngine` contract
(GE-6) and can't change to return a per-pot error list, so it collects failures
per pot, finishes attempting every pot regardless, and — only if one or more
failed — throws a single aggregated error identifying which pot(s) and why,
after everything that *could* succeed already has.
`settle-gameweek/index.ts` mirrors the same shape one layer up: each gameweek's
processing is wrapped in its own try/catch, errors are collected into an
`errors: [{ gameweek_id, message }]` array, and the response's `success` field
reflects whether any occurred — replacing an unstructured raw 500 with a
response that names exactly what failed and what didn't.

**Why this is a hardening fix, not a redesign:** neither method's job changed
("finalize this gameweek's outcome," "identify winners and split the pool") —
only what happens when one unit of that job fails changed, from "abort
everything else too" to "isolate and report." No interface changed, no new
behavior was added for the success path (verified: existing test suite
unaffected, 88/88 pass including the new isolation test).

**Verified live**, not just via unit test: two real gameweeks, one hosting a
pot with fees exceeding its gross pool, one hosting a correctly-configured pot,
both settled in a single real `settle-gameweek` invocation. The
correctly-configured gameweek's pot was fully settled (entries settled,
standings written, `net_amount` correct, prize awarded) despite the other
gameweek's pot failing; the response's `errors` array correctly identified the
failing gameweek and pot.

## Same-request write races get a re-check immediately before the write, not a redesign

**Decided 2026-08-05**, same audit. `submit-pick5-picks` read `game_entries.status`
once, at the top of the request, and `Pick5Engine.validateEntry()` checked that
snapshot — leaving a real (if narrow, typically millisecond-scale) window
between that read and the `pick5_picks` write during which `compute-deadlines`
could lock the entry, with nothing re-checking status at write time. Fixed with
a direct re-read of `game_entries.status` immediately before the write, aborting
with the same "not pending" message `validateEntry()` already uses if the status
changed. Not a full re-run of `validateEntry()` (picks/eligibility can't change
mid-request, only entry status can) and not a database-level constraint or
trigger (a more invasive, schema-level fix that would close the window
completely but wasn't judged a "small, low-risk" hardening change) — this
narrows the window as tightly as a single request can, consistent with the
"best-effort, not perfect" mitigation already accepted elsewhere in this
codebase (e.g. `get-or-create-pick5-entry`'s `23505`-conflict fallback for
concurrent entry creation).

## Payment Verification bulk import: no schema change needed

**Decided 2026-08-05.** Before implementing the Payment Verification admin
workflow (`ISSUE-6`), reviewed whether CSV bulk import needs any schema change.
It doesn't — two reasons:

1. **`entry_payments` already has every column this workflow needs**: `pot_id`,
   `user_id`, `gameweek_id`, `is_paid`, `marked_by`, `marked_at`, `notes` — the
   CSV's `Notes` column maps directly to the existing `notes` column, unchanged
   since `001_initial_schema.sql`.
2. **Identifier (email/phone) resolution — the one real capability gap — doesn't
   need a new SQL function or view either.** `profiles` has no email or phone
   column at all (by design — Supabase Auth owns that data), so resolving a CSV
   row's `Identifier` to a `user_id` genuinely can't be done via any client-
   reachable table. But `admin-actions` already uses a service-role client, and
   the service-role client already has access to the **GoTrue Admin API**
   (`adminClient.auth.admin.listUsers()`) — which returns every user's email and
   phone directly, no RLS, no PostgREST schema exposure required (`auth` isn't
   exposed via PostgREST in this project, but the Admin Auth API is a separate
   mechanism entirely, unaffected by that). Paginating through `listUsers()`
   once per bulk request and matching in application code is a few lines, adds
   no new schema surface, and needs no `security definer` function bridging
   `public` to `auth` the way e.g. `redeem_invite()` bridges to `pot_members`.

**What this means for the new `bulk_verify_payments` action**
(`supabase/functions/admin-actions/bulkPayments.ts`): it resolves every distinct
pot name and every distinct identifier referenced in a CSV batch in a small,
fixed number of queries (one `pots` lookup, one paginated `listUsers()` walk, one
`pot_members` lookup, one `entry_payments` lookup — never one query per row),
then classifies each row via a pure function (`classifyBulkPaymentRows()`) that
takes no DB dependency at all, so it's fully unit-testable without a live
database — same split as `validate.ts` in `get-or-create-pick5-entry`/
`submit-pick5-picks`.

**Design decisions made along the way, none required by the CSV format itself,
recorded here rather than left implicit:**

- **Gameweek is selected in the UI, not the CSV.** The fixed
  `Identifier,Pot,Status,Notes` format has no gameweek column (Payment
  Verification is currently Pick-5-only, always gameweek-scoped —
  `entry_payments.scope = 'gameweek'`). Every row in one import applies to a
  single gameweek, chosen in `pages/AdminPayments.jsx` before uploading —
  mirroring how `PotDetail.jsx` already scopes its own gameweek-dependent
  actions. A CSV spanning pots on genuinely different "current" gameweeks needs
  two separate imports; not solved automatically, since the format gives no way
  to express it.
- **Duplicate identifier+pot within one CSV**: the first occurrence is applied,
  every subsequent one is reported `skipped` with an explicit reason — never
  "last one wins" silently, which would make the outcome depend on row order in
  a way nobody reviewing the preview could predict.
- **A row's target user must already be a member of the resolved pot.** Not
  required by the spec, but a resolved (pot, user) pair that isn't a real
  `pot_members` row almost certainly means a typo somewhere (wrong pot, wrong
  person) — reported as a failure rather than silently creating an orphaned
  `entry_payments` row for a non-member.
- **Authorization is per-row, not per-request.** Unlike every other
  `admin-actions` action (single `pot_id` in the body, one authorization check
  up front), a CSV can reference multiple pots. `bulk_verify_payments` bypasses
  the shared single-pot gate and instead resolves, per unique pot in the batch,
  whether the caller is that pot's admin (or an app admin, authorized for every
  resolved pot regardless of membership) — a row for a pot the caller doesn't
  administer fails with "not authorized," not "unknown pot" (deliberately
  distinct reasons, even though both currently render as a failed row).
- **Phone matching strips a leading `+`.** Confirmed live: GoTrue stores phone
  numbers digits-only (a user created with `+353871234567` is stored as
  `353871234567`) — found via this feature's own end-to-end verification, where
  a correctly-formatted E.164 identifier was failing to resolve. Beyond that one
  normalization, phone matching is exact-string only; this codebase has no
  phone-auth UI anywhere (sign-up is email/password only), so no user has
  `auth.users.phone` populated by any normal flow today — a phone-identified CSV
  row will correctly report "unknown user" until a phone number exists some
  other way. Further normalization (spacing, local-format-to-E.164 guessing) is
  deliberately out of scope — not a case this app's current data can exercise.

## LMS: Tie Outcome, rollover, and late entry

**Superseded 2026-08-05, same session, before any of this was applied or
shipped** — see [§ LMS: Wipeout Resolution, automatic rollover, and a fixed
per-competition entry fee](./decisions.md#lms-wipeout-resolution-automatic-rollover-and-a-fixed-per-competition-entry-fee)
below for the revised, authoritative version. Kept here, not deleted, per
this document's own "never delete historical decisions" rule — the
reasoning below was sound given the information available at the time
(the payment-model and rollover-creation product decisions this entry
responds to were themselves later revised by the repo owner, not found to
be a mistake in this entry's own analysis).

**Decided 2026-08-05**, ahead of Milestone 5 Slice 2. The repo owner supplied
five product decisions before Slice 2 could proceed; this records the schema
and Game Engine impact of each, and — per the standing instruction to
determine whether any existing LMS assumption is now invalid — two places
this specification (`game-engine.md`) and the already-shipped Slice 1 code
were wrong.

**1. No tiebreak picks.** `game-engine.md`'s GE-5.2 previously left
`lms_tiebreak_picks` (referenced by the retired prototype, never built) as
"properly designed as part of Milestone 5, not before." That's now settled:
it will not be built at all. Tie resolution at competition end is handled
entirely by a pot-level setting instead (below) — simpler, and it matches
GE-1's own original product-vision line ("last survivor(s) split the pot")
more directly than a player-facing tiebreak mechanic would have.

**2. `pots.tie_outcome`, a required LMS setting.** `split_prize` | `roll_prize`,
new enum `lms_tie_outcome`. Config lives on `pots`, same placement as
`predictor_cycle_mode`/`predictor_scorer_scope` — GE-3's platform/mode
boundary (config on the shared `pots` row, calculated per-instance outcome on
`pot_prizes`) already had a slot for exactly this shape. "Required" is
enforced at pot creation (application/API layer), not by omitting a default —
the column is `not null default 'split_prize'`, matching how
`predictor_cycle_mode` is also mode-specific-but-defaulted rather than
nullable. Immutable once the pot has entries, joining `entry_fee`'s existing
guarded set in `trg_pots_contract_immutable` — changing the tie rule after
money/picks are committed is exactly the fairness problem that trigger
already exists to prevent for every other pot term.

**3/4. Wipeout detection is new Game Engine logic, not just a settings read.**
Both Split Prize and Roll Prize only apply to a **wipeout** — every
currently-`alive` entry eliminated by one gameweek's results, going from N>1
to 0 in a single step. This is a different condition than "0 entries are
alive," which can also be reached the ordinary way (elimination narrows to
exactly 1 survivor, who simply wins — `tie_outcome` never consulted in that
case). `determineWinner()` (Slice 7 territory, not built yet) must therefore
know the alive-count immediately before a gameweek's eliminations were
applied, not just the count after — this needs a real design pass when Slice
7 is reached, flagged here rather than guessed now. Split Prize reuses the
existing multi-winner payout path (`awardPrize()` already knows how to split
`net_amount` across more than one winner, from Pick 5's own standings-tie
case). Roll Prize needs the new `pot_prizes.rollover` flag (GE-4.4) — chosen
as an explicit boolean rather than inferring "rolled over" from "no
`game_entries` row in this pot has `payout_amount > 0`," consistent with
GE-13's standing preference for explicit columns over nullability-based
inference.

**Rollover linkage is deliberately manual, not automatic.** The decision is
explicit: "Do NOT automatically create the new pot." `pots.rollover_source_pot_id`
lets an organiser attach a new pot to a finished, rolled-over one at creation
time; nothing in the Game Engine ever creates a pot or sets this column
itself. Made unconditionally immutable (joins `game_type` in
`prevent_pot_contract_change()`'s always-blocked set, not the
entries-gated one) — a pot's lineage isn't a "term" that could plausibly need
a pre-launch correction the way `entry_fee` might; it's an identity fact
fixed at creation.

**5. Late entry — the "do not infer from nulls or dates" instruction shaped
the whole design.** Two explicit facts were needed and didn't exist:
"when does this competition's fee-charging start" and "is this pot a
rollover." Both are now real columns (`pots.start_gameweek_id`,
`pots.rollover_source_pot_id`) rather than derived from e.g. "the earliest
gameweek this pot has a `game_entries` row for" (fragile — the whole point of
allowing late entry is that the *first* entry isn't necessarily the *earliest*
one anymore) or a creation-timestamp comparison (says nothing about which
gameweek a competition actually starts charging for).

**Billing the backfill reuses Pick 5's payment model exactly — this exposed an
invalid assumption already sitting in this specification.** GE-4.3 stated
`entry_payments` `scope = 'season'` (one whole-pot row) was the intended
shape for LMS. It isn't: a per-gameweek recurring fee, which the backfill
example makes explicit (weekly fee × gameweeks owed), cannot be represented
by one row. LMS payment verification now uses `scope = 'gameweek'`, identical
in shape to Pick 5 — see the correction in
[game-engine.md § GE-4.3](./game-engine.md#ge-43-entry_payments-generalized--payment-verification-not-payment-processing).
This is a genuine win for reuse: `admin-actions`, `AdminPayments.jsx`,
`bulkPayments.ts` need zero changes to support LMS backfill billing once the
entry-side logic exists — they already operate on `(pot_id, user_id,
gameweek_id)` rows.

**A second invalid assumption: Slice 1 shipped with no entry-window gate at
all.** `get-or-create-lms-entry` was built and verified before this session's
late-entry rule existed — at the time, "any pot member can create their LMS
entry, any time" was a reasonable reading of GE-4.5's season-scoped shape.
It no longer is. This is not fixed in this same change — the columns it would
depend on (`start_gameweek_id`, `rollover_source_pot_id`) exist only in a
drafted, not-yet-applied migration, and per this project's standing rule,
migrations get reviewed before they're applied, not applied inline with the
document that first proposes them. Tracked as
[current-state.md ISSUE-32](./current-state.md#issue-32--get-or-create-lms-entry-has-no-entry-window-gate),
to be fixed once `013_lms_tie_outcome_and_rollover.sql` is reviewed and
applied.

**What was deliberately not designed yet, to avoid inventing behavior:** the
exact `determineWinner()` wipeout-detection algorithm (needs to know
"alive-count going into this gameweek," which isn't currently computed
anywhere — a Slice 7 design question) and the entry-window/backfill billing
implementation itself (`get-or-create-lms-entry`'s correction plus whatever
Payment Verification changes are needed to surface an itemized backfill to
an admin) — both real work, neither guessed at here.

## LMS: Wipeout Resolution, automatic rollover, and a fixed per-competition entry fee

**Decided 2026-08-05**, revising [§ LMS: Tie Outcome, rollover, and late
entry](./decisions.md#lms-tie-outcome-rollover-and-late-entry) above in the
same session, before that entry's design was ever applied or shipped. The
repo owner supplied a fuller, more specific set of product decisions and was
explicit that they "replace any previous assumptions or recommendations" and
that nothing should be "preserve[d]... simply because [it] already exists."
Three things changed from the superseded entry, plus one genuinely new rule.

**1. Payment model reversed: LMS is one flat entry fee per competition, not
a recurring weekly charge.** The previous entry inferred a per-gameweek fee
from the late-entry backfill example ("Weekly fee = €5... Total due = €15")
and corrected `game-engine.md`'s original `entry_payments` design (`scope =
'season'`) to `scope = 'gameweek'` on that basis. The repo owner's revised
decision states this plainly: "One entry fee per competition... No weekly
payments... There is NO cumulative billing for missed weeks." The original
`scope = 'season'` design in `game-engine.md` was correct all along — this
session's own intermediate "correction" was the mistake, not the
specification it corrected. Reverted in full: `entry_payments` needs no
schema change for LMS at all, and **Payment Verification needs no code
changes whatsoever** (`admin-actions`/`AdminPayments.jsx`/`bulkPayments.ts`
already handle `scope = 'season'` rows, unmodified, exactly as they do
today). This is a clean example of why the "design it, review it, don't
apply automatically" migration discipline matters — the incorrect
`scope = 'gameweek'` design never reached a live database or shipped code,
so reverting it costs nothing beyond a documentation correction.

**2. Rollover pot creation is automatic, not organiser-initiated.** The
previous entry took "Do NOT automatically create the new pot" as a hard
rule; the revised decision inverts it exactly: "Do NOT ask the organiser to
create the rollover pot manually. The Game Engine should create it
automatically." This is now `awardPrize()`'s (or an equivalent settlement-
adjacent method's) responsibility when a wipeout resolves as `roll_prize` —
not a manual admin workflow. `pots.rollover_source_pot_id` and the new
`carry_over_amount` column are therefore set exactly once, atomically, by
service-role Game Engine code at creation time — never editable afterward by
anyone, which is why both join `game_type` in
`prevent_pot_contract_change()`'s unconditionally-immutable set rather than
the "immutable once entries exist" set most other pot terms use.

**3. The new pot starts in `draft`, with only the organiser as a member —
reusing `pot_status`'s existing, previously-unused `'draft'` value.** No
enum change needed; this is genuine reuse of dormant schema, not new
surface. The organiser's pre-launch workflow (invite, verify payment,
choose `start_gameweek_id` — including deliberately waiting for next season)
happens entirely within this draft window. `is_pot_member()`-gated RLS
already makes a draft pot with one member invisible to everyone else,
without any policy change — another case of the existing shared platform
already being exactly general enough for this.

**4. New rule, not a revision: season-end ties are a separate case from
wipeouts, with their own setting.** Neither product-decision round before
this one mentioned what happens if multiple entries are simply still alive
when the season ends (as opposed to a wipeout, where entries are eliminated
down to zero in one gameweek). `pots.season_end_tie_rule` (`split_prize` |
`final_prediction`) fills that gap. `final_prediction`'s three-tier
resolution (winning team → first goalscorer → closest minute → split) needs
a new pick-type table this decision deliberately does not design yet — it's
only reachable at the very end of a competition, several slices away, and
designing it now risks guessing at a shape that later, closer-to-the-work
context would get right. Flagged in `game-engine.md § GE-5.2` and
`business-rules.md § Last Man Standing` as identified, not built.

**Net effect on the schema draft:** the first draft's proposal
(`013_lms_tie_outcome_and_rollover.sql`) is replaced outright, not layered
on top of — it was never applied, so nothing needed migrating away from it.
The replacement (`013_lms_wipeout_and_rollover.sql`) adds
`wipeout_resolution`, `season_end_tie_rule`, `start_gameweek_id`,
`rollover_source_pot_id`, `carry_over_amount` on `pots`, and `rollover` on
`pot_prizes` — smaller in one sense (no `entry_payments` change at all,
where the superseded draft needed none either but for the wrong reason) and
larger in another (two new required settings instead of one, plus an
explicit carry-over amount column the superseded draft didn't need since it
never modeled automatic pot creation).

**What's still deliberately not designed, same reasoning as before:** the
`determineWinner()` wipeout-detection algorithm, the automatic
rollover-pot-creation code path itself (which Game Engine method triggers
it, and how the compensating-rollback pattern already used in
`get-or-create-lms-entry`/`get-or-create-pick5-entry` extends to a
multi-table pot+pot_members insert), the pot activation action that moves a
draft rollover pot to active, and the `final_prediction` pick table and
scoring logic. All real, all flagged, none guessed at.
