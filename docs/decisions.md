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

**Confirmed 2026-08-05, one more round, ahead of the same Slice 2.** The
repo owner supplied a final, more precise version of this same decision set,
explicitly superseding it. Comparing point by point: the payment model,
Wipeout Resolution naming and scope, Split/Roll Prize behavior, automatic
rollover creation, the draft lifecycle, and Season End Resolution
(`split_prize`/`final_prediction`) all matched what's recorded above
exactly — **no schema change resulted**, `013_lms_wipeout_and_rollover.sql`
stands as drafted. Two genuinely new details, both additive, neither
requiring a schema change:
- **The carry-over amount belongs to the new pot only, explicitly stated as
  a constraint on the design, not just an implementation detail** — already
  true of the drafted schema (`pots.carry_over_amount` on the new pot,
  `pot_prizes.rollover` a bare flag on the old one, no amount stored there)
  but now recorded as a deliberate rule so it can't drift later: the old pot
  is an **immutable historical record** from the moment it settles, full
  stop.
- **The organiser may rename the auto-created pot before activation, and
  the Game Engine should generate a sensible default name** (e.g. "Premier
  League LMS (Rollover)") when creating it. `pots.name` was never in
  `prevent_pot_contract_change()`'s guarded set, at any point in this
  design's history — this "just works" already, and default-name generation
  is pure Game Engine string logic, not a schema concern.

**Migration reviewed against the four dimensions explicitly requested**
(correctness, replay safety, rollback, shared-platform consistency) —
findings recorded directly in `013_lms_wipeout_and_rollover.sql`'s own
header comment so they travel with the file. Summary: correct as drafted;
replay-safe (every touched object predates it in migration order); no
rollback script exists anywhere in this project by convention, so a manual
rollback procedure was documented in the migration's header instead of
added as a second file; fully consistent with GE-3 (config on shared
tables, same placement as `predictor_cycle_mode`, zero impact on Pick 5 or
Score Predictor code paths). No changes to the migration's actual DDL
resulted from this review — it was already correct.

## LMS: multi-generation rollover review (found a real gap, added `rollover_generation`)

**Decided 2026-08-05**, ahead of applying migration 013. The repo owner
asked for an explicit review of unlimited rollover chains (A → B → C → ...,
eventually won) before approving the migration, plus a new required field,
`rollover_generation`. Findings:

**Lineage, immutability, and cycle-safety all confirmed sound as designed —
no redesign needed.** `rollover_source_pot_id` forms a correct linked list
(each pot points only to its immediate predecessor); `carry_over_amount`
already belonged to the new pot alone, never the source; historical pots
were already immutable by construction (unconditional + entries-gated
guards cover every relevant column). **A cycle is structurally
impossible**, not just discouraged: `rollover_source_pot_id` can only ever
reference a row that already existed at INSERT time (FK requirement) and is
never editable afterward (unconditional immutability) — a pot cannot be
made to point backward at a pot created after it, so no sequence of inserts
can ever close a loop. This didn't need a recursive CHECK or trigger to
enforce; it falls out of the existing design.

**One real gap found: nothing stopped a client from fabricating a rollover
lineage.** `pots_insert_authenticated`'s RLS (`002_rls_policies.sql`) only
checks `created_by = auth.uid()` — it has never been column-restrictive,
because nothing insertable before this migration needed it to be. Once
`rollover_source_pot_id`/`carry_over_amount` exist, any authenticated user's
own normal pot-creation request could set them to arbitrary values —
pointing at a real pot they don't administer, inventing any carry-over
figure — and that fabricated amount would later be paid out as real prize
money by `awardPrize()`. Row-level RLS can't express "this column may never
be set"; column-level privilege can, and this codebase already has the
precedent (`game_entries`/`notifications` UPDATE narrowing,
`005_game_engine_shared_platform_rls.sql`). Fixed the same way: `revoke
insert on public.pots from authenticated`, then an explicit `grant insert
(...)` naming every column a legitimate client insert needs, excluding the
three Game-Engine-only fields. Confirmed live post-apply via
`information_schema.column_privileges` that `authenticated` can no longer
insert `rollover_source_pot_id`/`carry_over_amount`/`rollover_generation`
(GE-9 lists the exact resulting column set). Worth noting: pot creation
isn't wired into any frontend or Edge Function code yet (`ISSUE-8`'s
territory) — so nothing in the live app could have exploited this today —
but a raw PostgREST call with a valid anon-derived session already could
have, independent of what the UI happens to call, which is the same
reasoning `ISSUE-30`/`ISSUE-31` were fixed under during the hardening
sprint. This is a proactive fix, not a response to a live incident.

**`rollover_generation`, added as requested.** `pots.rollover_generation
int not null default 0`, with a consistency CHECK tying it to
`rollover_source_pot_id` (`generation = 0` iff no source; `generation > 0`
iff a source exists) — same explicit-not-inferred approach as every other
LMS addition. Set automatically by the Game Engine as
`source.rollover_generation + 1` at automatic-creation time, same trust
boundary (and same INSERT-privilege exclusion) as
`rollover_source_pot_id`/`carry_over_amount`. A platform fact, not a display
string — the auto-generated pot name ("Rollover #2") is derived from this
value, never the reverse.

**Net effect: one migration revision, applied.** `013_lms_wipeout_and_rollover.sql`
gained `rollover_generation` + its consistency check, and the `pots` INSERT
column-privilege narrowing — both additive, no prior column or constraint
changed shape. Reviewed a second time against the original four dimensions
(correctness, replay safety, rollback, shared-platform consistency) plus
three more the repo owner asked for this round (trigger compatibility, RLS
compatibility, Pick 5/Predictor compatibility) — all pass; findings live in
the migration's own header. Applied via `supabase migration up --local`;
confirmed live via direct schema inspection (`\d public.pots`, `pg_constraint`,
`information_schema.column_privileges`).

## LMS: no cycles (`current_cycle` removed), Slice 2 implemented

**Decided 2026-08-05.** Before Slice 2, the repo owner removed the LMS
"cycle" concept entirely: an LMS competition is one continuous sequence
from its opening gameweek to its end; a team may never be picked twice
within that competition — no resets, no half-season cycles, no
configurable cycle mode. A rollover is a new competition (a new pot, per
the automatic-rollover design above), so every entrant's available-team
pool resets naturally as a side effect of being a different pot with
different entries, never because a cycle mechanism reset mid-competition.
This resolved the exact question blocking Slice 2 in the prior session
entry — not by answering "what is a cycle," but by removing the need for
an answer.

**Removed, not left dormant, per explicit instruction:**
`game_entry_lms.current_cycle` (`004_game_engine_shared_platform.sql`) —
confirmed by grep, before drafting the removal, that nothing anywhere in
the codebase read or wrote it. It was planned-but-never-implemented
scaffolding for a cycle mode this product never actually got. Dropped via
a **new** migration (`014_lms_remove_cycle.sql`) rather than editing `004`
directly — `004` is already applied/historical, and this project's own
rule is "never rewrite migrations after deployment." Dropping the column
also dropped its own CHECK constraint automatically; no separate statement
needed. `predictor_cycle_mode` is untouched — that's a real, still-planned
Score Predictor concept (`two_halves`/`single_cycle`), unrelated to LMS
despite the similar name, and GE-3's mode boundary means this LMS-only
decision has zero business touching it.

**Slice 2 implemented once the blocker was gone**: `submit-lms-pick` +
`LmsEngine.validateEntry()` (`_shared/game-engine/lms/`) + `lms_team_picks`
(`015_lms_picks.sql`). `validateEntry()` checks, in order: the entry is
`pending`; the entry's `game_entry_lms.competitive_status` is `alive` (a
new check Pick 5 has no equivalent of — LMS entries can be eliminated
mid-competition, Pick 5 entries can't); the picked team actually has a
fixture in the target gameweek (a real join against `fixtures`, not a
trusted client-supplied fact); and the team has never been picked before by
this entry, in *any* gameweek other than the one being resubmitted (a plain
`neq('gameweek_id', ...)` — the same upsert-on-conflict shape
`submit-pick5-picks` already established makes "changing this gameweek's
pick" and "reusing an old gameweek's team" trivially distinguishable). The
no-repeat rule is also a real `unique (game_entry_id, team_id)` constraint
on `lms_team_picks` itself — enforced twice, deliberately, same
"constraint not just convention" standard the rest of this schema holds to.

**A second, unrelated prototype-name collision was found and worked
around, the same category as `pots_insert_authenticated`'s gap but purely
a naming issue, not a security one.** The obvious table name, `lms_picks`,
already exists — owned by `supabase_admin`, part of the retired
prototype's deliberately-untouched object set (`ISSUE-20`). Confirmed live
the moment `015_lms_picks.sql` was first run (`relation "lms_picks"
already exists`), not found by inspection first. Renamed to
`lms_team_picks` before re-running. Flagged in `game-engine.md § GE-15` for
Milestone 6: `predictor_picks` will hit the identical collision, and should
be named around it before that migration is drafted, not after failing the
same way again.

**Verified live**: 17 new unit tests (9 `LmsEngine.validateEntry()` cases
via a fake Supabase client, 8 `submit-lms-pick` request-shape cases; 133/133
total pass). Live, through the real Edge Function: a valid pick; changing
that same gameweek's pick to a different team (upsert, not flagged as
reuse — confirmed exactly one row exists afterward, not two); the changed-
away team correctly rejected when picked again in a later gameweek; a team
with no fixture in the target gameweek rejected; an eliminated entry
rejected. All test data (picks, `game_entry_lms`, `game_entries`,
`pot_members`, the pot, one auth user) removed by exact ID, in dependency
order, and re-verified as zero rows afterward — the ordering lesson from
the `ISSUE-32` verification session was applied here from the start, not
re-learned.

## LMS locking

**Decided 2026-08-06**, ahead of Milestone 5 Slice 3, per the repo owner's
explicit "review Pick 5's locking first, reuse what's reusable, identify
only the LMS-specific differences" instruction.

**What's fully reusable, unchanged:** the `GameEngine.lockEntries(ctx,
gameweekId): Promise<number>` contract signature; deadline computation
itself (`gameweeks.earliest_kickoff_utc`/`deadline_utc`, `compute-deadlines`
§ GE-8.2); the dispatcher pattern.

**What genuinely differs, and why — found by reasoning through the schema
before writing code, not by a live failure:**

1. **"Locking the entry" doesn't make sense for LMS.** Pick5Engine's
   `lockEntries()` flips `game_entries.status` from `pending` to `locked`.
   That's correct for Pick 5 because a gameweek-scoped entry has no life
   beyond that one gameweek. LMS's `game_entries` is season-scoped
   (GE-4.5) — one row for the whole competition — so locking it at gameweek
   13's deadline would make it impossible to ever submit a pick for
   gameweek 14. What actually needs to become immutable at a deadline is
   the individual gameweek's *pick*, not the entry. `LmsEngine.lockEntries()`
   instead sets a new column, `lms_team_picks.locked_at`
   (`016_lms_team_picks_locked_at.sql`) — this is also simpler than
   Pick5Engine's version: no pot-id/game-type filter is needed, because
   `lms_team_picks` is written only by `submit-lms-pick`, itself gated to
   `last_man_standing` pots, so every row already belongs to LMS
   unambiguously.
2. **`validateEntry()` needs a live deadline check LMS-side, unlike Pick 5's
   stored-status check.** Pick 5 can gate a submission on
   `entry.status !== 'pending'` because `lockEntries()` is the one thing
   that ever changes that field. LMS has no equivalent single flag to check
   — `game_entries.status` stays `pending` all competition, and a pick
   might not exist yet for the gameweek being submitted (so there's no
   `locked_at` to check either, for a brand-new pick). `LmsEngine.validateEntry()`
   therefore queries `gameweeks.deadline_utc` directly and compares against
   `ctx.now()`. `lms_team_picks.locked_at` still gets set by
   `lockEntries()` regardless — genuinely useful as an explicit, queryable
   "this pick is final" signal for `calculateScore()`/`settle()` (Slice
   4/5), just not the mechanism `validateEntry()` itself checks.
3. **A real, load-bearing bug found in the *shared* `compute-deadlines`
   function, not LMS-specific duplication to fix.** Its discovery step
   (find which game types have entries needing locking for a gameweek)
   queried `game_entries.gameweek_id = <this gameweek>` — which can never
   match an LMS row, since `game_entries.gameweek_id` is always `null` for
   LMS (GE-4.5). This function's own comment, written during Milestone 4
   Slice 3, explicitly assumed this would "work unchanged once LMS/Predictor
   register... since only Pick 5 has any [gameweek-scoped entries] today" —
   an assumption that turned out to be wrong the moment a season-scoped
   mode needed locking. Found by reading the existing code before writing
   any LMS locking logic, not by a live failure. Fixed by replacing the
   pre-filter entirely: `compute-deadlines` now calls every `isRegistered()`
   mode's `lockEntries()` unconditionally on every due gameweek, trusting
   each mode's own implementation to no-op cheaply when there's nothing to
   lock (both `Pick5Engine`'s and `LmsEngine`'s already do). This is a
   genuine shared-platform fix, not LMS-specific code living in a shared
   file — `compute-deadlines` still has zero mode-specific branches.

**What's still not decided, flagged rather than guessed:** what happens to
an entry that never submitted a pick for a gameweek that has now locked.
"No pick = eliminated" is a plausible reading of "Last Man Standing," but
it is not stated anywhere in the product decisions this session has
received, and inventing it would violate the standing "never invent
undocumented business rules" instruction. `lockEntries()` simply has
nothing to lock for such an entry (no `lms_team_picks` row exists) and
does nothing further — no elimination, no notification. This needs an
explicit product decision before `calculateScore()`/`settle()` can be
designed, since those methods will need to know what a "no pick" outcome
means for standings and elimination.

**Verified live**, through the real Edge Functions, not just unit tests: a
pick submitted before its gameweek's deadline; the real `compute-deadlines`
function (not a direct engine call) locking that pick once its gameweek's
fixture — and therefore computed deadline — moved into the past; a further
submission attempt for that now-locked gameweek correctly rejected. Test
gameweeks/fixtures were used instead of real ones specifically to avoid
disturbing live Premier League fixture data, and incidentally re-confirmed
`ISSUE-24`'s undocumented trigger live again (recomputing a fresh test
gameweek's `earliest_kickoff_utc` to `null` because it briefly had no
fixtures of its own) — worked around by giving that gameweek a fixture too,
not by touching the trigger, since fixing `ISSUE-24` is out of scope here.

## LMS scoring and elimination

**Decided 2026-08-06**, ahead of Milestone 5 Slice 4. The repo owner
supplied the product rule Slice 3's report had flagged as blocking: a
missed pick eliminates identically to a losing pick, no grace period, no
automatic pick, no admin intervention — applying equally when every
remaining entry misses the same gameweek at once (still a wipeout,
`wipeout_resolution` unchanged). Reviewed Pick5Engine's `calculateScore()`
first, per the repo owner's explicit instruction, before writing anything.

**Reusable, unchanged:** the `calculateScore(ctx, gameweekId): Promise<void>`
contract signature; the live/finished interim-vs-final labeling pattern
(`'winning'`/`'losing'` while a fixture is live, non-consequential; final
once finished); the general "resolve picks against real fixture data" shape.

**Genuinely different, and why:**

1. **Elimination happens inside `calculateScore()` itself, not deferred to
   a later `settle()`-equivalent slice.** Pick 5's `calculateScore()` never
   takes a consequential action — every status change waits for `settle()`,
   which itself waits for the *whole gameweek's* fixtures to finish
   (GE-8.4). LMS doesn't need that wait: an entry's fate depends on exactly
   one fixture (its own pick's), and the repo owner's own wording —
   "immediately eliminated... no grace period" — points at acting the
   moment that one fixture resolves, not waiting on unrelated fixtures
   elsewhere in the same gameweek. Still correctly deferred until that
   *specific* fixture is `finished`, not `live` — a live scoreline can
   still change, so no elimination (or final result label) happens before
   then, mirroring Pick 5's own live/finished distinction exactly.
2. **`pick_result` has no `'drew'` value — reused `'lost'` for both an
   actual loss and a draw.** Both eliminate identically per the rule ("a
   loss or draw eliminates you," GE-1's original vision line), so the only
   distinction the schema needs to preserve is "won" vs. "did not win" —
   adding a fourth enum value to draw a linguistic distinction the game
   logic itself never checks would be exactly the unnecessary-abstraction
   CLAUDE.md warns against.
3. **A missed pick eliminates via a *second*, independent pass — never a
   fabricated pick row.** For entries with an existing pick, elimination
   falls out of resolving that pick against its fixture (point 1). For
   entries with no pick row at all for the gameweek, there's nothing to
   resolve — `calculateScore()` separately finds every still-`alive` entry
   in an *eligible* LMS pot (`start_gameweek_id <= this gameweek` — a pot
   whose competition hasn't reached this gameweek yet, e.g. a still-draft
   rollover pot, must never be touched) with no `lms_team_picks` row for
   this `gameweek_id`, and eliminates them directly. No placeholder pick is
   ever inserted, per the explicit "no automatic pick" instruction.
4. **A second instance of the same `compute-scores`/`compute-deadlines`
   discovery bug, found by reading the code first, not by a live
   failure.** `compute-scores` had the identical `game_entries.gameweek_id`
   pre-filter Slice 3 already fixed in `compute-deadlines` — same root
   cause (LMS's `game_entries.gameweek_id` is always null, GE-4.5), same
   fix (call every `isRegistered()` mode's `calculateScore()`
   unconditionally, trusting each mode's own no-op efficiency).

**No schema change.** Every column this slice needed already existed:
`game_entry_lms.competitive_status`/`eliminated_gameweek_id` (Milestone 2),
`lms_team_picks.result` (Slice 2, reusing `pick_result`), `pots.start_gameweek_id`
(Slice 1's architecture round). A clean example of the shared/prior schema
already being general enough — nothing needed inventing.

**A real bug caught before it shipped, not live.** The first draft of the
pick-result upsert only included `{id, result}` — `pick5_picks`'s own
`calculateScore()` (and its own comment explaining why) already documents
that `upsert(..., {onConflict: 'id'})` requires every NOT NULL, no-default
column in each row, not just the one actually changing, because Postgres
validates the candidate row before it knows the ON CONFLICT branch will
fire. Caught by re-reading that exact comment before running anything, not
by a failed test.

**Verified live**, through the real `compute-scores` function (not a direct
engine call), with four entries in one pot: a pick whose team won (stayed
alive, result `'won'`); a pick whose team lost (eliminated, result
`'lost'`); a pick whose team drew (eliminated, result `'lost'` — same
value, same consequence); an entry that submitted no pick at all
(eliminated, confirmed no pick row was ever created). Dedicated test
gameweeks/fixtures/users used throughout, all removed by exact ID
afterward and re-verified as zero rows.

## LMS settlement

**Decided 2026-08-06**, ahead of Milestone 5 Slice 5. The repo owner's
instruction was explicit and narrower than the previous two slices: LMS
entries are already eliminated during `calculateScore()`; settlement should
only perform work that genuinely belongs in settlement; don't duplicate
`calculateScore()`'s work. Reviewed Pick5Engine's `settle()` first, per the
same "review before writing code" discipline as Slices 3/4.

**What's reusable, unchanged:** the `settle(ctx, gameweekId): Promise<void>`
contract signature; the payment-void business rule itself (an unpaid entry
by settlement time is voided, its picks marked `void`, excluded from the
leaderboard); the general pattern of reading `entry_payments`, splitting
entries into paid/unpaid sets, and writing accordingly.

**What's deliberately NOT reused — the two things Pick5Engine's `settle()`
does that LMS's must not:**

1. **Never transitions `game_entries.status` to `'settled'`.** Pick 5's
   `settle()` does this because a gameweek-scoped entry's life ends with
   that gameweek. LMS's `game_entries` is season-scoped (GE-4.5) and must
   stay `'pending'` across the *whole* competition — exactly the same
   constraint that shaped `lockEntries()`'s design in Slice 3. `'settled'`
   only becomes meaningful once the competition itself concludes, not on
   any ordinary gameweek's `settle()` call.
2. **Never calls `generateStandings()`/`determineWinner()`/`awardPrize()`.**
   Pick 5 calls these every gameweek because a new payable instance
   concludes weekly (a fresh jackpot, GE-8.4). LMS's competition doesn't
   conclude weekly — it concludes exactly once, at a wipeout or down to one
   survivor. Calling award-adjacent methods on every ordinary gameweek
   would be structurally wrong, not merely early: there's no "instance" to
   award yet on most gameweeks. Detecting "has this competition just
   concluded" is wipeout detection (`determineWinner()`), already flagged
   as real, unstarted design work since the Milestone 5 architecture round
   — still not designed here either, correctly, since this slice's own
   scope is narrower than that.

**The one genuine LMS-specific difference in the reused logic:**
`entry_payments.scope = 'season'`, not `'gameweek'` — LMS charges one flat
fee for the whole competition (decided 2026-08-05, § LMS: Wipeout
Resolution, automatic rollover, and a fixed per-competition entry fee), so
the payment check reads one row per `(pot_id, user_id)`, not per gameweek.
Voiding an unpaid entry therefore voids **every** `lms_team_picks` row that
entry has, across every gameweek it's played, not just the gameweek
`settle()` was called for — the entry's whole-competition participation is
what's unpaid, not one week of it.

**No schema change.** `entry_payments`, `game_entries.status`, and
`lms_team_picks.result` all already supported everything this slice needed.

**Verified live**, through the real `settle-gameweek` function (not a
direct engine call), with two entries in one pot: one with a verified
`scope='season'` payment (stayed `pending`, pick untouched), one with no
`entry_payments` row at all (voided, its pick marked `void`) — confirming
settle() correctly treats a missing row as unpaid, same as the unit tests.
Also confirmed `settle-gameweek`'s own shared logic (marking the gameweek
`'completed'`) still runs correctly for an LMS-only gameweek. All test data
removed by exact ID, re-verified as zero rows.

## LMS standings

**Decided 2026-08-06**, ahead of Milestone 5 Slice 6. The repo owner's
instruction was explicit and specific: review Pick 5's standings, but do
not assume that model is correct for LMS — design standings for LMS from
first principles, addressing alive players, eliminated players, elimination
gameweek, ordering, and ties specifically.

**Why Pick 5's model doesn't transfer.** Pick5Engine.generateStandings()
ranks by `score` (accumulated `picks_won`, a real points total) and writes
*two* kinds of row per user: a fresh per-gameweek snapshot (that week's
score alone) and a cumulative overall one. Neither half of that shape fits
LMS:
- **There is no score.** LMS is binary — alive or eliminated — not a
  points accumulation. Ranking by "score descending" has nothing to sort.
- **There is no meaningful per-gameweek snapshot.** Pick 5's weekly row
  exists because a Pick 5 entry's performance genuinely resets each
  gameweek (a fresh 5 picks, a fresh score). An LMS entry's standing
  doesn't reset — it's one continuously-updated fact (alive, or eliminated
  since gameweek N) that a UI would want to see the *current* state of, not
  a series of independent weekly snapshots.

**The design, reasoned from the shape rather than assumed:**
- **Alive players**: all tie for rank 1. No signal exists to distinguish
  one currently-alive entrant from another (no "closer calls" metric, no
  partial credit) — inventing one would be exactly the "invent an
  undocumented business rule" this project's standing discipline forbids.
- **Eliminated players**: rank below every alive entrant, ordered by
  **elimination recency** — `eliminated_gameweek_id` descending. Outlasting
  another eliminated entrant is a genuine, meaningful accomplishment, so it
  gets rewarded in the ranking, unlike the alive tier where nothing
  distinguishes members.
- **Elimination gameweek**: stored in `meta`
  (`{ competitiveStatus, eliminatedGameweekId }`), not folded into `score`
  or `rank` themselves — `meta`'s whole purpose (GE-4.6/GE-20) is exactly
  this kind of display-only detail, and it was already anticipated as an
  example ("elimination gameweek") since Milestone 2, never actually used
  until this slice.
- **Ordering**: standard competition ranking (ties share a rank; the next
  distinct rank skips ahead by however many were tied), same "1224" shape
  `Pick5Engine`'s own `rankWithTies()` already established — but continuing
  from wherever the alive tier's count left off, not restarting at 1 for
  the eliminated tier.
- **Ties**: handled identically in both tiers — every alive entrant ties at
  1; every entrant eliminated in the *same* gameweek ties with each other
  (this includes a wipeout — every entrant a wipeout eliminates shares a
  rank, exactly as the ordinary same-gameweek-elimination case already
  does, with no special-casing needed).
- **`score`**: a plain `1` (alive) / `0` (eliminated) — the only numeric
  value that's actually true for a mode with no points. Not the
  elimination gameweek itself (that would conflate a display fact with a
  summary number, and risk someone reading `score: 12` as "12 points").
- **Only the overall row is written** (`gameweek_id = null`) — no
  per-gameweek row at all, per the "no meaningful weekly reset" reasoning
  above.

**Wiring — a small, explicit revision to Slice 5's own reasoning.** Slice
5 grouped `generateStandings()` with `determineWinner()`/`awardPrize()` as
"never called from `settle()`, since those conclude a competition, not a
gameweek." On reflection, that was imprecise for `generateStandings()`
specifically — a standings snapshot is a harmless, idempotent report, not
a competition-concluding action (Pick5Engine.settle() already treats it
this way, regenerating every gameweek even for a pot with no changes this
week). Slice 5 genuinely couldn't wire it in at the time
(`generateStandings()` only threw `GameEngineNotImplementedError`); Slice 6
does, once per eligible pot after the payment-void step, with the same
per-pot failure isolation `Pick5Engine.settle()` already established (the
production hardening sprint precedent) — one pot's standings failure must
never block another's, or the payment-void work already durably written
for unrelated pots.

**No schema change.** `pot_standings_snapshots.meta` already existed,
unused by any mode until this slice — the Milestone 2 design was already
general enough.

**A small, acknowledged duplication, not new LMS-specific logic.** The
partial-unique-index upsert workaround (`pot_standings_snapshots` has two
partial unique indexes PostgREST's `upsert(onConflict:...)` can't target —
GE-4.6) is reimplemented privately in `LmsEngine`, not imported from
`Pick5Engine` — GE-18 forbids cross-mode imports (`pick5/` must never
import from `lms/`, or vice versa). This mechanic is genuinely
shared-platform-table behavior, unrelated to either mode's own scoring
logic; a future extraction into a shared `_shared/game-engine/` helper
(used by Pick 5, LMS, and eventually Predictor) would be a legitimate,
low-risk cleanup — not attempted here, since it would mean touching
already-shipped, committed `Pick5Engine` code for a refactor outside this
slice's actual scope.

**Verified live**, through the real `settle-gameweek` function across two
gameweeks in one dedicated test pot, with five entries: two who stayed
alive throughout (rank 1 both times); one eliminated in the second test
gameweek (ranked *better* than the pair below once eliminated, since it
outlasted them); two eliminated together in the first test gameweek (tied
with each other both times, correctly pushed one rank further down once a
third entrant was eliminated more recently). Confirmed `meta.eliminatedGameweekId`
carries the right value and `score` is `1`/`0` as designed. All test data
removed by exact ID, re-verified as zero rows.

## LMS winner determination

**Decided 2026-08-06**, ahead of Milestone 5 Slice 7. The repo owner's
instruction was explicit: review Pick 5's `determineWinner()`, but do not
assume its logic is reusable — design LMS's around the approved rules
(single survivor, wipeout, Wipeout Resolution vs. Season End Resolution
kept separate, no prize awarding or rollover creation yet), correctly
distinguishing one survivor, multiple survivors, a wipeout, and a
competition still in progress.

**Why Pick 5's model doesn't transfer, confirmed by reading it first.**
`Pick5Engine.determineWinner()` is a single query: rank 1 of the most
recently settled gameweek's standings. That's *correct* for Pick 5 only
because every settled gameweek genuinely is a concluded, payable instance
(GE-8.4) — there is no "still in progress" state for that method to
express. LMS's competition concludes exactly once; most calls to
`determineWinner()` over its lifetime should genuinely report "not yet."
Pick 5's version has no equivalent of that at all, so nothing about its
actual logic — only its `Promise<string[]>` contract shape — carries over.

**Four outcomes, derived from the same `game_entry_lms` state
`calculateScore()`/`generateStandings()` already maintain — no new schema,
no new tracking mechanism:**
1. **Exactly one `alive` entry** → that entry wins, `[userId]`.
2. **Zero `alive` entries** → a wipeout. The returned group is every entry
   whose `eliminated_gameweek_id` equals the `max` among all eliminated
   entries — "all remaining players eliminated in the same gameweek,"
   computed directly, not inferred from a separate flag.
3. **More than one `alive` entry, and the season has concluded** → a
   season-end tie, returning every `alive` entry. "Has the season
   concluded" reuses `pots.end_gameweek_id` (existing since Milestone 2,
   previously unused by any mode) compared against that gameweek's
   `deadline_utc` via a live check — the same `ctx.now()`-against-
   `deadline_utc` pattern `validateEntry()`/`calculateScore()` already
   established, rather than inventing a new "season status" flag.
4. **More than one `alive` entry, season not concluded (or
   `end_gameweek_id` unset)** → still in progress, `[]`.

**Wipeout Resolution and Season End Resolution are deliberately never read
here, per the explicit instruction not to mix them into this method.**
`determineWinner()` returns *who's involved* in whichever outcome
occurred; it never reads `pots.wipeout_resolution` or
`pots.season_end_tie_rule`, and never decides split vs. roll or split vs.
Final Prediction. A caller can tell a wipeout group apart from a
season-end group without this method returning two different shapes for
GE-6's fixed `string[]` contract — by checking `competitive_status` on the
returned ids (`'eliminated'` for a wipeout, `'alive'` for a season-end
tie). Prize awarding and automatic rollover-pot creation remain entirely
unbuilt — `awardPrize()` still throws `GameEngineNotImplementedError`, and
nothing calls this method from anywhere yet, mirroring exactly when
`Pick5Engine.determineWinner()` first existed (its own Slice 7, standalone
until Slice 8 wired it into `awardPrize()`).

**A real, unresolved sequencing gap, found while designing this method,
not fixed here.** Nothing today stops `calculateScore()` from continuing
to process a lone remaining survivor's pick in a later gameweek — it has
no pot-wide awareness of "is this entry already the sole survivor," so a
technically-possible (if currently unlikely in practice) sequence exists
where the sole survivor is scored again after having effectively already
won, and could even be eliminated afterward if their next pick loses. This
means `determineWinner()`'s "zero alive, wipeout" branch could theoretically
receive an eliminated group of size one — a case its own logic still
handles consistently (identifies the most-recent-elimination group either
way), but which shouldn't be reachable under the intended rules. Whichever
future slice wires `determineWinner()` into `settle()` (mirroring Pick 5's
own Slice 8) needs to close this gap — most likely by having `settle()`
check `determineWinner()`'s result and stop calling `calculateScore()` for
a pot once it's concluded. Flagged, not guessed at.

**Verified live**, through the real module (not a mocked test, and not an
HTTP endpoint — none exists yet for this method, same as Pick 5's own
Slice 7) against the real local Postgres: single survivor, wipeout,
still-in-progress (no `end_gameweek_id`), season-end tie (`end_gameweek_id`
set, deadline passed), and not-yet-concluded (`end_gameweek_id` set,
deadline still future) — all five scenarios correct. Hit and root-caused a
real, non-obvious local-dev pitfall along the way: `auth.admin.createUser()`
failed with a generic `AuthRetryableFetchError` that looked like a
transient/rate-limit issue, but `docker logs supabase_auth_pl-goals`
showed the real cause — `handle_new_user()`'s trigger deriving
`profiles.display_name` from the new user's email tripped
`profiles_display_name_check` (max 60 characters) because a test label was
too descriptive. Fixed by shortening the label, not by retrying blindly.
All test data removed by exact ID, re-verified as zero rows.

## LMS prize awarding

**Decided 2026-08-06**, Milestone 5 Slice 8. The repo owner's instruction
was explicit and specific per outcome: review Pick 5's `awardPrize()`
first, don't assume it's reusable unchanged; single survivor gets the net
prize; a wipeout respects `wipeout_resolution` (Split Prize pays the group
equally, Roll Prize marks the pot rolled over and *automatically* creates
the new rollover pot — config copied, `rollover_generation` incremented,
`rollover_source_pot_id`/`carry_over_amount` set, a sensible default name,
the organiser as sole member, left in Draft, never activated); a season-end
tie is documented but Final Prediction is explicitly not built this slice
unless genuinely required; and the Slice 7 sequencing gap must be closed —
once a competition has concluded, `calculateScore()` must never process it
again.

**What actually carried over from Pick 5's `awardPrize()`, and what
didn't.** Read in full before writing anything. What's genuinely shared
platform mechanics, reused (reimplemented privately per
[GE-18](./game-engine.md#ge-18-dependency-boundaries), not imported — the
`pick5/`/`lms/` boundary is never crossed): the money math
(`roundToCents`/`floorToCents`/fee calculation — identical rounding rules,
identical reasoning for flooring a multi-way split so no tied recipient is
ever favored) and the `pot_prizes` partial-unique-index get-or-create-by-id
workaround (same shape [GE-4.6](./game-engine.md#ge-46-pot_standings_snapshots)'s
`pot_standings_snapshots` upsert needed). What's genuinely different: Pick
5's version calls `determineWinner()` and treats an empty result as
`Pick5NoEligibleWinnersError` — a real anomaly, since every Pick 5
`awardPrize()` call is expected to find a winner. For LMS, "not concluded
yet" is normal and common (see below), so the equivalent case is a silent
no-op, not an error. Everything about wipeout/season-end/rollover has no
Pick 5 equivalent whatsoever — designed from the approved outcome model,
not adapted from anything.

**`classifyOutcome()` — a deliberate, behavior-preserving refactor of
already-shipped Slice 7 code, done as part of this slice, not scope
creep.** `determineWinner()`'s `Promise<string[]>` return can't distinguish
a genuine single survivor from a wipeout group that happens to have exactly
one member (a real, if unintended, possibility given Slice 7's own
identified sequencing gap — see below and
[decisions.md § LMS winner determination](#lms-winner-determination)).
`awardPrize()` needs to tell these apart to award correctly. Rather than
have `awardPrize()` re-derive a richer classification from the flattened
array (fragile — it would have to re-read `competitive_status` on every
returned id and reconstruct the same logic `determineWinner()` already
computed), the classification itself was extracted into a private
`classifyOutcome()` returning a typed union
(`LmsOutcome = in_progress | single_survivor | wipeout | season_end`), with
`determineWinner()` rewritten as a thin wrapper that flattens it for GE-6's
fixed contract shape. `determineWinner()`'s own tests were re-run
unchanged after the refactor (48/48 passing before this slice's new tests
were added) to confirm the extraction changed nothing observable.

**Per outcome, exactly as instructed:**
- **Single survivor** — the entire net prize (`gross_amount` minus admin
  and charity fees, same calculation Pick 5 uses) goes to that one entry.
- **Wipeout, `split_prize`** — every entry eliminated in the wipeout
  gameweek is a joint winner, splitting `net_amount` equally via the
  existing multi-winner path.
- **Wipeout, `roll_prize`** — nobody is paid. This pot's `pot_prizes` row
  is written with `rollover = true` and its `net_amount` is never
  distributed to anyone here — it becomes the new pot's
  `carry_over_amount` instead, via `createRolloverPot()`. That method:
  copies the LMS-relevant config (`entry_fee`, `wipeout_resolution`,
  `season_end_tie_rule`, `end_gameweek_id`, all four fee columns) as the
  new pot's starting values; sets `rollover_source_pot_id` to the source
  pot; sets `rollover_generation = source.rollover_generation + 1`; strips
  any existing `"(Rollover #N)"` suffix from the source name via regex
  before appending the new generation's own, so a rollover-of-a-rollover
  reads "Base Name (Rollover #3)," never a stacked
  "Base Name (Rollover #2) (Rollover #3)"; sets `status = 'draft'` (never
  activated automatically — that remains a separate, not-yet-designed
  organiser action); and inserts exactly one `pot_members` row, the source
  pot's organiser as admin. `start_gameweek_id` is deliberately left null —
  the organiser picks it during the draft pot's own pre-launch workflow,
  not at automatic-creation time. A compensating rollback (delete the new
  pot) runs if the `pot_members` insert fails, since supabase-js has no
  cross-table transaction — the same pattern already established by
  `get-or-create-pick5-entry`/`get-or-create-lms-entry`.
- **Season-end tie, `split_prize`** — identical split logic to a Split
  Prize wipeout, just sourced from every still-`alive` entry rather than an
  eliminated group.
- **Season-end tie, `final_prediction`** — genuinely not implemented this
  slice, per the explicit instruction. Rather than silently doing nothing
  (which would be indistinguishable from a normal "not concluded yet"
  no-op and could leave real money unaccounted for) or guessing at a
  resolution, `awardPrize()` throws a new, specific
  `LmsFinalPredictionNotImplementedError` — same "fail loudly, don't
  invent a default" standard `Pick5NoEligibleWinnersError` already set.
  This path needs its own pick table and scoring logic
  (`lms_final_predictions`-shaped, not yet designed) — real work for a
  later slice, only reachable by a pot explicitly configured this way that
  actually reaches a season-end tie, which most competitions never will.
- **In progress** — a silent no-op. Not an error, unlike Pick 5's
  `Pick5NoEligibleWinnersError`: `awardPrize()` is now called
  unconditionally every gameweek from `settle()` (mirroring
  `generateStandings()`'s own Slice 6 wiring), so "nothing to do yet" is
  the normal, most common outcome of most calls, not an anomaly.

**Idempotency, and every entry transitioning to `settled`.** An existing,
settled `pot_prizes` row (`scope = 'season'`) short-circuits the whole
method before any classification or writes happen, identical in shape to
Pick 5's own idempotency check. Every non-void entry in the pot — not just
the winner(s) — transitions to `status = 'settled'` once a real outcome is
reached, which is exactly the point Slice 5's "`'settled'` only makes sense
once the competition has actually concluded" reasoning was always deferring
to; a wipeout's losing members and a Roll Prize wipeout's unpaid members are
just as settled as an outright winner, they simply have `payout_amount = 0`.

**The Slice 7 sequencing gap, closed.** Slice 7 identified but explicitly
did not fix: nothing stopped `calculateScore()`/`settle()` from continuing
to process a pot after its competition had effectively concluded, since
neither method had any awareness of "has `awardPrize()` already run for
this pot." Rather than invent a second "is this pot done" flag, the private
`getEligibleLmsPotIds()` helper (already shared by `calculateScore()` and
`settle()`) now excludes any pot with an existing, settled `pot_prizes` row
(`scope = 'season'`) — the exact same signal `awardPrize()`'s own
idempotency check already relies on. One source of truth for "has this
competition concluded," read by all three methods. This also retroactively
resolves the theoretical "wipeout group of size one" ambiguity Slice 7
flagged: a concluded pot's entries can no longer be reprocessed at all, so
a lone survivor can never be re-scored into an accidental one-member
wipeout after having already won.

**No schema change.** Every column `awardPrize()`/`createRolloverPot()`
writes to (`pot_prizes.rollover`, `pots.rollover_source_pot_id`/
`carry_over_amount`/`rollover_generation`) already existed from
`013_lms_wipeout_and_rollover.sql`, applied ahead of Slice 2.

**Verified:** 13 new unit tests (61/61 in `lms/engine.test.ts`, 133/133
across the whole `game-engine/` tree) via a purpose-built fake modeling
`pots`/`game_entries`/`game_entry_lms`/`pot_prizes`/`pot_members`. Live,
through the real module against the real local Postgres (no HTTP endpoint
calls `awardPrize()` directly yet outside `settle-gameweek`, and
orchestrating real gameweek-deadline timing through HTTP for five distinct
scenarios was unnecessary given the engine's injectable `now()`): single
survivor (plus idempotency and the sequencing-gap check via a second
`settle()` call), wipeout + Split Prize, wipeout + Roll Prize (confirming
the new pot's `rollover_source_pot_id`/`carry_over_amount`/
`rollover_generation`/name/`status = 'draft'`/sole organiser membership),
season-end tie + Split Prize (both concluded and not-yet-concluded
variants), and still-in-progress — 27 checks, all passing. All test data
(6 pots including the auto-created rollover pot, 12 users) removed by
exact ID, re-verified as zero rows.

## LMS prize awarding: transactionality correction

**Decided and fixed 2026-08-06**, before any Slice 9 code was written, in
response to the repo owner's explicit question: "when `awardPrize()`
creates a rollover competition, is the entire sequence — `pot_prizes`
update, new pot creation, organiser membership creation — fully
transactional? If not, make the smallest architectural correction
necessary."

**Verified: no, it was not.** supabase-js has no cross-table transaction —
every multi-step write in this codebase already lives with that
constraint (the compensating-rollback pattern `get-or-create-pick5-entry`/
`get-or-create-lms-entry` established, reused by `createRolloverPot()`
itself). The specific problem wasn't the absence of a transaction in
general — it was *where* the one write that matters most was placed
within the sequence. `awardPrize()` wrote its `pot_prizes` row **first**,
before settling entries, before paying out, before `createRolloverPot()`
ran — and that row's `is_settled = true` is the exact flag this method's
own idempotency check (and, since Slice 8, `getEligibleLmsPotIds()`'s
sequencing-gap check) trusts as "this competition has concluded, never
touch it again."

**The failure mode this created, concretely.** Any error after that first
write — settling entries failing, a payout write failing, or
`createRolloverPot()` failing at any point (the `pots` insert itself, not
just the `pot_members` insert the existing compensating rollback already
protected) — left the pot permanently marked settled and, for a
`roll_prize` wipeout, `rollover = true`, with the rest of the work
(entries never settled, or a rollover pot that was supposed to exist but
doesn't) simply undone. Because `is_settled` was already `true`, every
future call to `awardPrize()` for that pot would short-circuit at its own
idempotency check before reaching any of the unfinished work — the
operation could never complete, and (worst case, a `roll_prize` wipeout)
real money would be marked as rolled over with no rollover pot ever
successfully created and no way to fix it except manual database
intervention.

**The correction: reorder so `pot_prizes` is written last, and make the
one non-idempotent step in between safe to repeat.** Moving the write to
the very end of the method, after entry settlement, payout, and
`createRolloverPot()` have already succeeded, means `is_settled` only ever
becomes `true` once everything else has genuinely finished — a failure
anywhere above it leaves the pot retryable from scratch on the next call,
exactly the property that matters given supabase-js's constraint (true
row-level atomicity isn't available; safe retryability is the substitute).
This is sufficient on its own for the entry-settlement and payout writes,
which are plain `UPDATE`s — re-applying the same value twice is harmless.
It is **not** sufficient on its own for `createRolloverPot()`, which
`INSERT`s a new row: without a further guard, a retry after
`createRolloverPot()` had already succeeded (but a later step — the
now-later `pot_prizes` write — then failed) would create a **second**
rollover pot for the same wipeout. So `createRolloverPot()` gained its own
idempotency check: before inserting, it looks up whether a pot already
exists with `rollover_source_pot_id` equal to the source pot; if one does,
it's reused (the method returns without creating anything), on the
reasoning that a source pot can only ever wipe out and roll over once
(it's settled and immutable from that point on), so a 1:1
source-to-rollover relationship is always correct — a prior attempt having
already finished this step is the only reason a matching pot would exist.

**Why this is the smallest correction, not a redesign.** No new table, no
new flag, no distributed-transaction library, no outbox pattern — just
moving one write to the end of an existing method and adding one `SELECT`
before an existing `INSERT`. The general question of whether every outcome
branch (not just the rollover one the repo owner specifically asked
about) benefits from this reordering was considered: yes, uniformly — the
same `is_settled`-gates-everything risk applies identically to a plain
single-survivor payout failing partway through, so reordering the one
shared write fixes all outcome branches at once rather than needing a
per-branch fix. This mirrors a pre-existing, structurally identical risk
in `Pick5Engine.awardPrize()` (which also writes `pot_prizes` before its
payout loop) — out of scope for this correction, since the repo owner's
question was specifically about the LMS rollover sequence, but worth
flagging as the same class of issue elsewhere; not touched here without
being asked.

**Verified:** 2 new unit tests via failure injection in the existing
`awardPrize()`/`createRolloverPot()` fake — one simulating the trailing
`pot_prizes` write itself failing (confirms entries are still
settled/paid, `pot_prizes` stays unwritten, and a subsequent retry
completes cleanly with no double-payment), one simulating a retry against
a pot where a prior, since-failed attempt had already created the
rollover pot and its membership row (confirms no duplicate pot or
membership is created, and the retry still finishes by writing
`pot_prizes`). 63/63 in `lms/engine.test.ts` after adding these (no
regressions). Live, against the real database: seeded a source pot in
exactly the "prior attempt got this far, then would have failed" state
(rollover pot and organiser membership already existing, no `pot_prizes`
row) and called `awardPrize()` against it directly — confirmed no
duplicate rollover pot, no duplicate membership row, and that the call
correctly finished sealing `pot_prizes`. 5 checks, all passing; all test
data removed by exact ID, re-verified as zero rows.

## LMS notifications

**Decided 2026-08-06**, Milestone 5 Slice 9 — the last of LMS's eight
`GameEngine` contract methods. The repo owner's instruction: review
`Pick5Engine.notifyUsers()` first, reuse the existing notification
architecture, don't duplicate infrastructure unless LMS genuinely needs
different behavior.

**What's genuinely shared, and reused as a one-for-one copy, not a
redesign.** `notifyUsers()` itself — the `notifications` table shape
(`user_id`, `pot_id`, `type`, `payload`) is [GE-4.8](./game-engine.md#ge-48-notifications)'s
shared platform mechanic, identical for every mode; LMS's implementation
is byte-for-byte the same insert-one-row-and-return method Pick 5's is,
kept as a separate copy only because
[GE-18](./game-engine.md#ge-18-dependency-boundaries) forbids `lms/`
importing from `pick5/`. One event type was defined,
`LmsNotificationType = 'lms.prize_awarded'`, mirroring Pick 5's own single
`pick5.prize_awarded` — same reasoning Pick 5's own comment already
documents: define the type actually needed now, don't invent a
speculative catalog.

**What genuinely differs: where and how often it's called, following
directly from Slice 8's own outcome model.** Pick 5's `awardPrize()`
writes `pot_prizes` first, then loops winners, calling `notifyUsers()`
once per winner from inside that loop — safe because `pot_prizes` already
exists by the time the loop runs. LMS's `awardPrize()`, after the
transactionality correction above, writes `pot_prizes` **last** — so
calling `notifyUsers()` from inside the payout loop would fire it before
that row exists. Rather than reintroduce the ordering problem the
correction above just fixed, or leave the reasoning inconsistent with what
the code actually does, the notification loop was placed **after** the
trailing `pot_prizes` write instead — a separate, short loop over
`recipients`, run once everything else has already succeeded. This is
arguably a strictly cleaner invariant than Pick 5's own: a notification
never fires until both the money (`payout_amount`) and the record that the
competition is settled (`pot_prizes.is_settled`) are already durably
written, not just the money. `recipients` is empty for a `roll_prize`
wipeout, so the loop simply runs zero times — no notification for anyone
in that case, correctly, since nobody was actually paid.

**A rollover-specific notification — e.g., telling the organiser their
competition rolled over into a new draft pot — was considered and
deliberately not built.** It has no Pick 5 equivalent to model (Pick 5 has
no concept of a competition automatically spawning a successor), and
nothing in the instruction asked for it. The organiser already becomes the
new pot's sole member programmatically (Slice 8), so they're not
locked out of anything without it — but they'd have no proactive signal
that it happened without checking the app. Flagged as a genuine, likely
future addition — same "flag, don't guess" discipline this milestone has
applied throughout (Final Prediction, rollover-pot activation) — not
built ahead of being explicitly asked for.

**Same best-effort failure handling as Pick 5's call site, and for the
identical reason.** Wrapped in try/catch; a notification write failing is
logged (`console.error`) and swallowed, never propagated, never unwinds or
blocks a payout that's already durably written. `notifyUsers()` itself
still throws on error, like every other `GameEngine` method — the
try/catch boundary belongs at the one call site that knows this specific
write is allowed to fail silently, not inside `notifyUsers()` itself,
exactly mirroring Pick 5's own comment on this point.

**All eight `GameEngine` contract methods are now implemented for LMS.**
Milestone 5's core implementation work is complete; what remains
(Final Prediction, activating a draft rollover pot, extracting the
`pot_prizes`/`pot_standings_snapshots` upsert workaround into a shared
helper, a rollover notification) are all flagged, scoped, deliberately
deferred items, not unknowns.

**Verified:** 7 new unit tests (`notifyUsers()` writes correctly and
throws on failure; `awardPrize()` fires one notification for a sole
survivor, one per member on a wipeout split, none for a roll_prize
wipeout, none twice on an idempotent second call, and never blocks the
payout if the notification write itself fails) — 70/70 in
`lms/engine.test.ts`, 142/142 across the whole `game-engine/` tree. Live,
against the real database: `notifyUsers()` called directly (payload
round-trips through Postgres jsonb correctly); `awardPrize()` for a single
survivor writes exactly one notification, for the winner, with the
correct payout amount in its payload; `awardPrize()` for a `roll_prize`
wipeout writes none. 7 checks, all passing; all test data removed by
exact ID, re-verified as zero rows.

## Score Predictor architecture review

**Decided 2026-08-06**, Milestone 6 kickoff, before any `PredictorEngine` code
was written. Per the repo owner's explicit instruction: review the existing
product rules, compare Score Predictor against Pick 5 and LMS method-by-method,
review the schema, draft a migration only if genuinely needed, flag genuine
product questions rather than inventing behaviour, and do not force Score
Predictor into either existing mode's shape.

**Sources reviewed.** GE-1's one-line product vision ("Predict one fixture per
gameweek — exact score, winner, goalscorer; cumulative points across the
season; top scorer(s) split the pot at season end"); GE-5.3 (three sentences —
the thinnest of the three mode sections, confirming Predictor genuinely has
less approved design behind it than LMS did going into Milestone 5); the
already-applied `pots.predictor_cycle_mode`/`predictor_scorer_scope` columns
and their comments (`004_game_engine_shared_platform.sql`); the already-applied
`game_entry_predictor` table; the `pot_prizes` lazy-creation ADR's forward
note about "LMS's season-long single payout and **Score Predictor's variable
half-cycle/full-cycle boundaries**"; and the retired prototype's
`predictor_picks` table shape (`supabase_admin`-owned, 0 rows, ISSUE-20 — read
as evidence of prior design intent only, never as something to reuse or
depend on, same stance this whole rebuild has taken toward every retired
prototype object). `business-rules.md` has **no Score Predictor section at
all** — unlike LMS, which had an extensive one drafted and revised three
times before its own Slice 1 shipped. This is the clearest single signal that
Predictor needs more product decisions made than LMS did, not fewer.

**What's well-evidenced enough to proceed on (not invented — derived from
already-applied schema and the one-line product vision):**
- **Entry lifecycle is season-scoped**, like LMS, not gameweek-scoped like
  Pick 5. `game_entry_predictor` (existing since Milestone 2) has no gameweek
  dimension at all — a single aggregate row per entry
  (`total_points`/`exact_score_count`/`correct_scorer_count`) — the same
  shape `game_entry_lms` has, for the same reason: "cumulative points across
  the season" (GE-1) cannot be represented as a per-gameweek row the way
  Pick 5's `game_entry_pick5.picks_won` is.
- **One fixture predicted per gameweek** — GE-5.3 states this directly, and
  the retired prototype's `predictor_picks_entry_id_gameweek_id_key` unique
  constraint independently confirms it.
- **Scoring has two mutually exclusive point sources plus a bonus** — exact
  score (5 pts) OR correct winner (3 pts), never both for the same
  prediction, plus a scorer bonus whose *scope* (does the predicted scorer
  need to have scored in the predicted fixture specifically, or anywhere in
  that gameweek) is the already-decided, already-applied
  `predictor_scorer_scope` setting.
- **No elimination concept** — every entry stays in until the season ends;
  ranking is by cumulative `total_points`, not a survive/eliminate mechanic.
  This is the one point where Predictor is unambiguously closer to Pick 5's
  shape (a persistent, cumulative score) than LMS's (entries can drop out).

**Genuine product questions found, flagged, not invented — these block
later slices, not Slice 1:**
1. **How is a draw predicted?** The retired prototype's
   `predicted_winner_team_id` column is `NOT NULL` — no visible mechanism for
   predicting "no winner." Either the prototype never actually supported
   draws (a real gap, not a design to copy) or used a convention this
   codebase has no record of. Blocks designing the picks table and the
   scoring rule for "correct winner."
2. **Is the goalscorer prediction mandatory?** The prototype's
   `goalscorer_player_id` is `NOT NULL`, but GE-5.3 doesn't say whether
   guessing a scorer is required to submit a valid pick at all, or optional
   (with no scorer bonus available if skipped).
3. **What is the scorer bonus actually worth, in points?** GE-5.3 says
   "plus a scorer bonus" and never states a value. `game_entry_predictor`
   doesn't even track it as its own counter (only `exact_score_count` and
   `correct_scorer_count` exist — no `correct_winner_count`), so the
   points-vs-counters relationship itself isn't fully specified either.
4. **What does `predictor_cycle_mode = 'two_halves'` actually mean for
   payouts?** This is the most consequential open question, because two
   different pieces of existing evidence point in different directions and
   neither is a settled decision:
   - The `pot_prizes` lazy-creation ADR's forward note explicitly says
     "Score Predictor's **variable half-cycle/full-cycle boundaries**,"
     grouped alongside LMS's "season-long single payout" as parallel
     examples of "whenever *its* engine decides the season... has ended" —
     read plainly, this implies a `two_halves` pot might conclude (and pay
     out) **twice**: once at the halfway point, once at the true season end.
   - The retired prototype's own settlement functions were
     `settle_predictor_gameweek` and `settle_predictor_season` — **no**
     `settle_predictor_half` function ever existed, suggesting the
     prototype's own design only ever paid out once, at the true season
     end, and `two_halves` only affected the pick-reuse-restriction reset
     (the prototype's `half_cycle` column scopes its unique constraints,
     e.g. "may not predict the same team to win twice in the same half"),
     never payout timing at all.
   These two sources conflict. Guessing either way risks building the wrong
   payout model for a real-money feature — exactly the kind of decision this
   project's whole discipline (LMS's Wipeout Resolution, Season-End Tie
   Rule, Final Prediction) has consistently insisted on getting an explicit
   answer for before writing scoring/payout code. Blocks `awardPrize()`
   design specifically; does not block Slice 1 or `validateEntry()`.
5. **Does Score Predictor need an entry-window rule at all?** LMS's
   `checkEntryWindow()` exists because a late joiner into a survive-or-die
   competition has an obvious fairness problem RLS/UX can't paper over.
   Predictor's cumulative-points model has a real, if softer, version of the
   same problem — a mid-season joiner starts at 0 points, permanently behind
   anyone who's been predicting since gameweek 1. Whether the product wants
   to allow this (accepting the asymmetry, same as Pick 5's own "always open"
   model, which has no such problem since every gameweek restarts the
   comparison) or block it (LMS's model) is genuinely undecided — and
   Predictor's `pots` row has neither a `start_gameweek_id` nor a
   `rollover_source_pot_id` column to hang a check on, unlike LMS's. Not
   invented here; **Slice 1 ships without an entry-window check**, exactly
   mirroring LMS's own history — Slice 1 shipped without one too, and the
   rule (`ISSUE-32`) was decided and added only afterward, once someone
   asked. If Predictor needs one, it'll need its own new `pots` column(s)
   first, added in whichever future migration actually decides this.

**Method-by-method comparison against Pick 5 / LMS (GE-6's eight-method
contract) — what's reusable, what must differ, and whether each is required
unchanged, adapted, or replaced. Deliberately not answered beyond what's
needed to plan Slice 1 and the schema — each method's actual design is real
work for its own future slice, same discipline as every prior mode:**

| Method | Pick 5 shape | LMS shape | Score Predictor — expected shape |
|---|---|---|---|
| `validateEntry()` | Exactly 5 non-goalkeeper picks, gameweek-scoped | One team, never repeated across the competition, season-scoped entry + per-gameweek pick | **Adapted, closer to LMS's structure** (season-scoped entry, one pick row written per gameweek) but with genuinely different validation content (fixture/winner/scorer shape, not a team choice) — blocked on open questions 1–2 above |
| `lockEntries()` | Locks `game_entries.status` per gameweek | Locks the individual pick's own `locked_at`, never the season-long entry (GE-5.2's own reasoning) | **Reuses LMS's reasoning directly, not its code** — season-scoped entry means the entry itself can never lock either; almost certainly a `predictor_picks.locked_at`-shaped column, same reasoning as `lms_team_picks.locked_at` |
| `calculateScore()` | Resolves each gameweek's picks against goals scored | Resolves each gameweek's pick against the team's result, eliminates on loss/draw | **Adapted** — resolves each gameweek's prediction against the real fixture result (score, winner, scorer), no elimination consequence at all (no analog to LMS's elimination branch) |
| `settle()` | Payment-void (gameweek-scoped `entry_payments`), then `generateStandings()`+`awardPrize()` per pot | Payment-void (season-scoped `entry_payments`), then `generateStandings()`+`awardPrize()` per pot | **Reuses LMS's shape** (season-scoped payment-void, same `paidKeys` idiom) — genuinely different only in which scope of `entry_payments` it reads, once the payment-model question is settled |
| `generateStandings()` | Rank by cumulative `picks_won`, ties share a rank, per-gameweek AND overall rows | Alive-tied-at-1 then eliminated-by-recency, overall row only | **Closer to Pick 5's shape than LMS's** — a real cumulative score (`total_points`) exists to rank by, standard "1224" ranking, most likely both per-gameweek and overall rows (a gameweek's individual result is meaningful to show, unlike LMS where there's nothing per-gameweek left to display once eliminated) |
| `determineWinner()` | Rank-1 of the most recently settled gameweek (repeats every gameweek) | Four-way outcome classification, evaluated once (or, pending question 4, possibly twice) | **Closer to LMS's shape** — a season (or half-cycle) conclusion check, not a per-gameweek jackpot; genuinely blocked on open question 4 |
| `awardPrize()` | Splits a per-gameweek pool every settled gameweek | Splits or rolls a single season-long pool, once | **Blocked on open question 4** — cannot be designed correctly until "does `two_halves` pay out twice" is answered; building this now would mean guessing at real money logic |
| `notifyUsers()` | One event type, called after the trailing `pot_prizes` write | Same shape, same placement, reused near-verbatim from Pick 5 | **Fully reusable pattern** — same `notifications` insert shape; only the event type name and payload content would differ, once `awardPrize()` exists |

**Schema review.**
- **Reusable, already applied, no changes needed:** `pots.game_type = 'score_predictor'`
  (enum value existing since Milestone 2), `pots.predictor_cycle_mode`/
  `predictor_scorer_scope`, `game_entries` (season scope, same as LMS),
  `game_entry_predictor`, `entry_payments` (scope-generic), `pot_prizes`,
  `pot_standings_snapshots`, `notifications` — every genuinely shared
  platform table GE-3 already established.
- **Missing:** a picks table (deliberately not named or designed this slice
  — see below), and a `locked_at`-equivalent column on it once it exists.
- **Obsolete prototype table explaining the naming collision:**
  `predictor_picks` (`supabase_admin`-owned, 0 rows, ISSUE-20) — isolated,
  not reused, not deleted. Milestone 6's real picks table will need a
  different name for the same reason `lms_team_picks` dodged the prototype's
  own `lms_picks` (`015_lms_picks.sql`'s own comment already flagged this
  collision as "worth remembering then, not solved here since that table
  doesn't exist yet" — now it does).
- **Minimum schema addition required, and why it's not drafted yet:** the
  picks table itself. Deliberately **not** designed or migrated this slice —
  its correct shape depends directly on open questions 1–3 above (can a pick
  represent a draw; is the scorer mandatory; what does a "correct winner"
  actually mean without a resolved draw representation). Migration 013's own
  history is the cautionary example here: it was drafted, then had to be
  substantially revised once a payment-model assumption was overturned
  (see [decisions.md § LMS: multi-generation rollover review](#lms-multi-generation-rollover-review-found-a-real-gap-added-rollover_generation)).
  Drafting the picks table now, before questions 1–3 are answered, risks the
  identical rework — or worse, silently encoding an invented answer to a
  real product question into schema. **No migration accompanies this
  review.**

**Slice 1 (entry creation) needs none of the above, and ships anyway.**
Exactly like Pick 5's and LMS's own Slice 1: `get-or-create-predictor-entry`
only touches `game_entries`/`game_entry_predictor`, both already applied,
mirrors `get-or-create-lms-entry`'s season-scoped shape, and deliberately
omits an entry-window check per open question 5. No `PredictorEngine` class
yet — same as both prior modes, where the Game Engine class first appeared
at Slice 2 alongside `validateEntry()`.

**Verified:** 4 new unit tests (`validate.test.ts`, mirroring
`get-or-create-lms-entry`'s own minus the entry-window cases) — 204/204
across the whole `supabase/functions/` tree. Live, through the real Edge
Function over HTTP (required a full `supabase stop`/`start` cycle, not just
a container restart, for the new function directory to be served — the
identical local-dev mechanic LMS's own Slice 1 first documented): missing
`pot_id` rejected, missing auth rejected, a `pick5`-typed pot rejected with
a specific message, a non-member rejected, first creation succeeds with
`entry_scope='season'`/`gameweek_id=null`/a zeroed `game_entry_predictor`
row, a second call is idempotent (same entry id, exactly one `game_entries`
row exists after both calls) — 9 checks, all passing. All test data (2 pots,
2 users) removed by exact ID, re-verified as zero rows.

## Score Predictor pick submission (Slice 2)

**Decided 2026-08-06**, Milestone 6 Slice 2. Before any schema or code, the
five open product questions from the Slice 1 review were re-examined
against GE-5.3's exact text (not memory) — one new fact changed the
analysis: "`predictor_cycle_mode` already lets a pot choose `two_halves` vs.
`single_cycle` **reuse restriction**" confirms a reuse restriction is a real,
approved concept, not purely inferred from the unreliable retired
prototype, though GE-5.3 still doesn't say which predictions it restricts
or how "half" is computed.

**Two questions resolved as design, not invented:**
- **How is a draw predicted?** Not by a separate column. GE-5.3's own
  scoring rule — "5 points exact score, **or** 3 for correct winner
  (mutually exclusive)" — only makes logical sense if both are evaluated
  against one scoreline prediction; if they were independent picks,
  mutual exclusivity wouldn't be a meaningful constraint (a player could
  win on both mechanisms independently). So `predictor_fixture_picks`
  stores only `predicted_home_score`/`predicted_away_score`; "correct
  winner" is derived at scoring time from the sign of the predicted score
  difference. A draw is simply the case where both predicted scores are
  equal. This also avoids repeating what looks like a real prototype bug:
  its `predicted_winner_team_id` was `NOT NULL`, with no way to represent
  "no winner" (a draw) at all.
- **Is the goalscorer prediction mandatory or optional?** Genuinely a
  product decision — asked the repo owner directly rather than guessing;
  a nullable column doesn't inherently favor either answer, and the two
  options have real, different UX/fairness implications. **Decided:
  optional.** `goalscorer_player_id` is nullable; `PredictorEngine.validateEntry()`
  accepts a pick with no scorer guess — the entry is simply not eligible
  for that gameweek's scorer bonus.

**One question confirmed not to block this slice:** the scorer bonus's
point value is only ever consumed by `calculateScore()` (a future slice) —
this table only needs to *store* a prediction, not score it.

**One question partially resolved, partially deferred:** `predictor_cycle_mode`'s
reuse restriction is real (per GE-5.3) but underspecified (which
predictions? what counts as "half"?). Rather than guess at either detail —
the same mistake `013_lms_wipeout_and_rollover.sql`'s own predecessor draft
made, later requiring a full revision once its payment-model assumption was
overturned (see [decisions.md § LMS: multi-generation rollover review](#lms-multi-generation-rollover-review-found-a-real-gap-added-rollover_generation))
— this slice ships without enforcing any reuse restriction at all. No
`half_cycle` column, no reuse-scoped unique constraint.
`PredictorEngine.validateEntry()` currently allows the same scoreline or
the same goalscorer to be predicted any number of times across a season.
**Flagged as a known, real gap for a future slice, not a silent omission**
— see `project-board.md`'s Ready section.

**The last open question (entry-window rule) doesn't apply here** — it
concerns entry *creation* (Slice 1), not pick *submission* (this slice),
which operates on entries that already exist regardless of how they were
created.

**Schema: `017_predictor_picks.sql`, `predictor_fixture_picks` table.**
Named to avoid colliding with the retired prototype's own
`supabase_admin`-owned `predictor_picks` (confirmed live before writing the
migration, not assumed) — the identical collision `lms_team_picks` was
named to dodge, which `015_lms_picks.sql`'s own comment predicted would
repeat here. Mirrors `pick5_picks`/`lms_team_picks` wherever the shape is
genuinely shared (service-role-only writes, no client-insert RLS policy,
`on delete cascade` from `game_entries`, `updated_at` trigger, one SELECT
policy scoped to pot membership) and diverges where Score Predictor's own
rules genuinely differ:
- `fixture_id` (not present in `pick5_picks`/`lms_team_picks`) — a
  gameweek has multiple fixtures; the user picks exactly one to predict,
  per GE-5.3's "one fixture predicted per gameweek."
- `predicted_home_score`/`predicted_away_score` replace the prototype's
  `predicted_winner_team_id` (see the draw-representation reasoning
  above).
- `goalscorer_player_id` is nullable, unlike the prototype's `NOT NULL`
  version — reflects the repo owner's actual decision, not a guess.
- **No `result pick_result` column**, unlike `pick5_picks`/`lms_team_picks`.
  Deliberate: `pick_result`'s won/lost vocabulary fits a binary outcome;
  Score Predictor's outcome is a point value (0, 3, or 5, plus a bonus)
  with no natural won/lost label. `points_awarded` being null vs.
  populated already distinguishes unresolved from resolved — the one fact
  `pick_result`'s `'pending'` state exists to capture for the other two
  modes — without a second, partially-redundant column that would need an
  invented mapping to populate.
- **No `half_cycle` column and no reuse-restricting unique constraint** —
  see the deferred reuse-restriction reasoning above.
- **No `locked_at` column yet** — mirrors `lms_team_picks`'s own history
  exactly: added in a later migration (`016`) once `lockEntries()` (Slice
  3) actually needed it, not upfront in the picks-table migration.

**`PredictorEngine.validateEntry()` implemented** (`_shared/game-engine/predictor/`,
new directory — `PredictorEngine`, `PredictorValidationError`, registered
with the dispatcher exactly like `Pick5Engine`/`LmsEngine`). Checks, in
order: `entry.status === 'pending'` (season-scoped entry, same reasoning
as LMS — no per-gameweek entry status to check); the target gameweek's
`deadline_utc`, live, same pattern every mode's `validateEntry()` uses;
the requested fixture exists **and** belongs to the requested gameweek (a
genuinely new check — neither Pick 5 nor LMS needs it, since neither mode
lets the picker choose *which* fixture within a gameweek); if a goalscorer
is provided, that they're an active player on one of the fixture's two
teams (a data-integrity check confirming the prediction is coherent, not
an invented business rule — same spirit as `Pick5Engine`'s own "is this
player eligible for this gameweek" check, narrowed to "eligible for this
specific fixture"). **No elimination/competitive-status check at all** —
`game_entry_predictor` has no such column; nobody is ever eliminated,
confirmed by the schema itself, not assumed.

**Comparison against Pick 5/LMS's own `validateEntry()`, confirming Score
Predictor is a genuine hybrid, not forceable into either shape** (per the
explicit instruction not to assume either): season-scoped entry and a live
per-gameweek deadline check, like LMS; no competitive-status/elimination
check at all, unlike LMS; a genuinely new fixture-selection check neither
prior mode needs, since both Pick 5 and LMS's picks are unambiguous about
which fixture(s) are in play.

**Verified:** 13 new `PredictorEngine.validateEntry()` unit tests plus 12
new `validateSubmitPredictorPickRequest()` unit tests (229/229 across the
whole `supabase/functions/` tree, no regressions). Live, through the real
Edge Function over HTTP (required a full `supabase stop`/`start` cycle for
the new function directory): missing auth, malformed JSON (built in from
the start this time, not retrofitted — `submit-predictor-picks` never had
the bare-500 bug the Production Hardening Sprint found elsewhere), missing
fields, non-owner, wrong-pot-type, fixture/gameweek mismatch, and
ineligible goalscorer all correctly rejected; a valid submission predicting
a draw (2-2) succeeds and stores the scoreline exactly, with
`goalscorer_player_id` correctly null when omitted; resubmitting for the
same gameweek with a different scoreline and an eligible goalscorer updates
the same row in place (confirmed by id and by row count — exactly one
`predictor_fixture_picks` row after both calls); a gameweek whose deadline
has already passed is correctly rejected — 16 checks, all passing. All test
data (2 pots, 2 users) removed by exact ID, re-verified as zero rows.

## Score Predictor locking

**Decided 2026-08-08**, Milestone 6 Slice 3, per the repo owner's explicit
"review Pick 5's and LMS's `lockEntries()` first, justify every similarity
and every difference against the architecture, don't assume either" —
same review discipline LMS's own Slice 3 used, applied fresh rather than
just re-applying LMS's answer.

**Lock the prediction, not the entry, not both — same conclusion as LMS,
independently derived from the same structural fact, not copied.**
`game_entries` for Score Predictor is season-scoped (GE-4.5), confirmed by
Slices 1–2, not an assumption carried over from LMS: one row for the whole
competition. Locking that row at gameweek 13's deadline would make it
impossible to ever submit gameweek 14's prediction — the identical problem
LMS's own architecture review found, because it's the identical shape.
"Lock both" was considered and rejected: there is no concept, at
`lockEntries()`'s level, of the entry itself needing to become
non-submittable — that's `settle()`'s/voiding's job (a future slice,
explicitly out of scope here), and conflating the two would duplicate a
concern already owned elsewhere. `PredictorEngine.lockEntries()` sets a new
column, `predictor_fixture_picks.locked_at` (`018_predictor_fixture_picks_locked_at.sql`),
mirroring `lms_team_picks.locked_at`'s exact mechanism — nullable, set once
per gameweek, checked nowhere else yet.

**No pot-id/game-type filter needed, same reasoning as `LmsEngine.lockEntries()`.**
`predictor_fixture_picks` is written only by `submit-predictor-picks`,
itself gated to `score_predictor` pots (confirmed in that function's own
code, not assumed) — every row in this table is already unambiguously
Score Predictor's, so a direct, unfiltered `UPDATE ... WHERE gameweek_id =
$1 AND locked_at IS NULL` is correct and sufficient, same as LMS, unlike
Pick 5's version which genuinely needs `getPick5PotIds()` because
`game_entries` is shared across every mode.

**`validateEntry()` needed no changes this slice — confirmed, not
assumed.** Considered whether it should also check
`predictor_fixture_picks.locked_at` once the column existed. It shouldn't,
same reasoning as `LmsEngine.validateEntry()`: the live gameweek-deadline
comparison already already gates submission, and it is strictly at least
as current as `locked_at` can ever be (`locked_at` is only set by the next
`lockEntries()` cron tick, which by definition runs *after* the deadline
has passed, never before it) — checking both would be redundant, not
additionally protective. `locked_at` exists as an explicit, queryable "is
this final" signal for `calculateScore()`/`settle()` (future slices), not
as a second submission gate.

**No shared-scheduler discovery bug, unlike the one Milestone 5 Slice 3
found and fixed for LMS.** Verified, not assumed: `compute-deadlines`'s
dispatch loop (`ALL_GAME_TYPES` + `isRegistered()` + unconditional
`lockEntries()` call per registered mode) was already fully generic —
Milestone 5 Slice 3 had already replaced the old
`game_entries.gameweek_id`-based pre-filter that couldn't have discovered
a season-scoped mode. The only gap found was narrower and different in
kind: `compute-deadlines`'s own module never imported
`_shared/game-engine/predictor/index.ts`, so `registerEngine('score_predictor', ...)`'s
side effect never ran within that Edge Function's own process, and
`isRegistered('score_predictor')` was therefore `false` there regardless of
what the dispatch loop itself did. Not a query silently excluding a whole
mode (the LMS bug's shape) — a missing registration import, exactly what
`compute-deadlines`'s own comment (written during Milestone 5 Slice 3)
already anticipated needing: "Predictor's import lands in Milestone 6...
with no further changes here." One line added; the dispatch loop itself
is untouched, still has zero mode-specific branching.

**Verified:** 4 new `lockEntries()` unit tests (233/233 across the whole
`supabase/functions/` tree, no regressions). Live, through the real
`compute-deadlines` Edge Function (not a bypass script, matching LMS's own
Slice 3 standard) against two real, already-existing gameweeks — one whose
deadline has already passed (gameweek 9), one that isn't due yet (gameweek
28), no fabricated dates needed: both seeded picks start unlocked; after
one real `compute-deadlines` call, the past-deadline gameweek's pick is
locked and the not-yet-due gameweek's pick remains unlocked; a second real
call leaves the already-locked pick's `locked_at` value unchanged
(idempotent, not re-locked) — 7 checks, all passing. All test data (1 pot,
1 user) removed by exact ID, re-verified as zero rows across every table
touched, independently of the script's own cleanup report.

## Score Predictor scoring

**Decided 2026-08-08**, Milestone 6 Slice 4, per the repo owner's explicit
"review `Pick5Engine.calculateScore()` and `LmsEngine.calculateScore()`
first, don't copy either, justify every similarity and difference" —
five product questions were posed up front, plus a sixth surfaced during
review and resolved directly by the repo owner.

**Decision:** `PredictorEngine.calculateScore()` resolves each
`predictor_fixture_picks` row against its own `fixture_id`'s status and
score once that fixture is `finished`, awarding points from the owning
pot's own configured values, and writes a full-recompute aggregate onto
`game_entry_predictor`. Postponed/cancelled fixtures are left unresolved.

**Context — the five questions asked before coding, and their answers:**

1. **How should a draw prediction be represented?** No new representation
   needed — a draw is simply `predicted_home_score = predicted_away_score`,
   the same shape Slice 2 already established for the actual scoreline
   (`decisions.md § Score Predictor pick submission`). "Correct result"
   for a draw prediction is scored the same way as any other correct
   result: the predicted and actual outcomes (home win / away win / draw)
   match, independent of whether either is an exact scoreline.
2. **What prediction states exist before a fixture finishes?** Exactly
   one: unresolved, signalled by `points_awarded IS NULL` (Slice 2's
   original design, unchanged). Unlike Pick 5/LMS, there is no interim
   "live"/"winning"/"losing" label — Predictor's `points_awarded` is a
   point value, not a `pick_result` enum, and a partial scoreline has no
   honest partial-point interpretation while the match is still in
   progress. This is a considered omission, not a gap.
3. **Does a missing optional goalscorer prediction affect scoring?** No.
   `goalscorer_player_id IS NULL` can never match a real player, so the
   bonus is silently never awarded — no penalty, no special-case branch
   needed. Confirmed by unit test rather than left implicit.
4. **How should postponed/cancelled fixtures behave?** Identically to
   scheduled/live/tbd — left unresolved, same as any not-yet-finished
   fixture. Justified by, not copied from, `LmsEngine.calculateScore()`'s
   own "nothing has happened yet, leave as-is" stance for a not-yet-decided
   fixture — both engines reach the same conclusion independently, from
   the same shared platform fact (`fixture_status`), not by one engine
   importing the other's logic (GE-18 forbids that regardless).
5. **Can `calculateScore()` safely rerun indefinitely?** Yes, by
   construction. Per-pick resolution recomputes from source data
   (`fixtures`, `player_fixture_goals`) every call — a finished fixture's
   score never changes, so re-resolving an already-resolved pick produces
   the same values. `game_entry_predictor`'s cumulative stats are written
   as a full `SUM`/`COUNT` recompute across every one of an entry's
   resolved picks (all gameweeks), never an increment — the same
   discipline `LmsEngine.generateStandings()` established for a
   season-scoped aggregate, reused here for the same structural reason
   (GE-4.5: the entry itself never resets weekly, unlike Pick 5's). Proven
   by a unit test calling `calculateScore()` three times and asserting an
   unchanged result, and live by two consecutive calls to the real
   `compute-scores` Edge Function.

**The sixth question, raised mid-review, not on the original list: what
exact point value should the scorer bonus be?** GE-5.3 stated 5/3/2 as
fixed constants but never justified the bonus's own value, flagged as an
open gap since Milestone 6 Slice 1. Offered the repo owner a fixed-value
choice (1, 2, or 3 points) via `AskUserQuestion` — **rejected**, with an
explicit instruction to ask open-endedly what they wanted clarified rather
than re-offer a different fixed set. Their actual answer was structurally
different from any option offered: **"let people set their own point for
each option. default 5-3-2."** All three point values — not just the
bonus — are now per-pot configuration
(`predictor_exact_score_points`/`predictor_correct_result_points`/
`predictor_scorer_bonus_points`, `019_predictor_scoring_config.sql`),
defaulting to GE-5.3's original 5/3/2, immutable once the pot has entries
(same rule as `predictor_cycle_mode`/`predictor_scorer_scope`). Lesson for
future review cycles: a rejected multiple-choice framing is a signal to
ask what the user wants clarified, not to re-offer a different fixed set —
the user may have a structurally different answer in mind, as happened
here (configurability, not a specific value).

**Reason:** Configurable scoring is a real, not hypothetical, organiser
need — a fixed platform constant for money-adjacent scoring math would
have been a genuine design mistake to ship, caught only because the repo
owner rejected the narrower framing before implementation started.

**Alternatives considered:**
- **Fixed 5/3/2 platform constants** (GE-5.3's original text) — rejected
  directly by the repo owner.
- **Configurable bonus only, fixed exact-score/correct-result** — narrower
  than what was asked; the repo owner's phrasing ("each option") covers
  all three, not just the one originally in question.
- **A single ordering constraint between the three values** (e.g.
  exact ≥ result ≥ bonus) — considered and rejected; no existing pot-config
  column in this schema constrains one setting's value relative to
  another's, and inventing one here would be a new, unasked-for rule.

**Consequences:**
- `points_awarded` alone is no longer sufficient to determine which
  scoring category a pick fell into, once point values are configurable
  (a correct-result-plus-bonus total could equal an exact-score total
  under some pot's own configuration) — resolved by two new boolean
  columns, `predictor_fixture_picks.is_exact_score`/`scorer_bonus_awarded`,
  the unambiguous source of truth `game_entry_predictor`'s counts aggregate
  from, independent of the point values themselves.
- `PredictorEngine.calculateScore()` is the first `calculateScore()` among
  the three modes that reads `pots` directly — a genuinely new dependency,
  since scoring math is now per-pot configurable; Pick 5 and LMS's own
  `calculateScore()` implementations have no equivalent need and are
  unaffected.
- Any future organiser-facing pot-creation UI must expose these three
  settings (with the 5/3/2 defaults pre-filled) — not built this slice,
  tracked as follow-up UI work.

**Verified:** 15 new unit tests (248/248 across `supabase/functions/`, no
regressions). Live, through the real `compute-scores` Edge Function (not a
bypass script): a real, already-finished fixture (gameweek 2, a genuine
4-1 result) with a real goal event seeded into `fixture_events` and
`player_fixture_goals` refreshed, three real entries predicting it (exact
score + correct goalscorer, correct result only, wrong result entirely)
— 10 checks, all passing, including the goalscorer bonus and idempotency
across two real calls. All test data (1 pot, 3 users, 1 seeded
`fixture_events` row) removed by exact ID, re-verified as zero rows across
every table touched, independently of the script's own cleanup report.

## Score Predictor settlement

**Decided 2026-08-08**, Milestone 6 Slice 5, per the repo owner's explicit
"review `Pick5Engine.settle()` and `LmsEngine.settle()` first, don't copy
either, justify every similarity and difference" — five product questions
were posed up front and answered by review, not invention, before any code
was written.

**Decision:** `PredictorEngine.settle()` implements the Payment
Verification payment-void rule only — the same "deliberately small" shape
`LmsEngine.settle()`'s own Slice 5 had, for the same underlying reason
(`generateStandings()`/`determineWinner()`/`awardPrize()` either aren't
implemented yet or genuinely don't make sense on an ordinary gameweek).
Every `score_predictor` pot's `status = 'pending'` entries are re-checked
against `entry_payments` (`scope = 'season'`) on every call; an entry with
no verified payment flips to `game_entries.status = 'void'`; a paid entry
is left untouched, still `'pending'` (the competition hasn't concluded —
`'settled'` only makes sense once it has, `determineWinner()`/
`awardPrize()` territory, out of scope here).

**Context — the five questions asked before coding, and their answers:**

1. **What constitutes a settled scoring period?** Not a season/cycle
   concept at all, for this method's actual scope. "Settled" here means
   only "this gameweek's payment-void check has run" — gated by the same
   caller-side "are this gameweek's fixtures all finished" check
   `settle-gameweek/index.ts` already applies uniformly to every mode, same
   as Pick 5/LMS. No independent period or cycle boundary is computed by
   this method.
2. **Does settlement happen once per cycle or once per season?** Neither —
   once per gameweek, same cadence as every other mode's `settle()`,
   because Payment Verification (the only thing this method actually does)
   is a flat, one-time, whole-competition fee (`entry_payments.scope =
   'season'`) whose paid/unpaid status has no cycle-dependent timing.
   Re-checking it redundantly every gameweek is safe (idempotent) and
   needs no boundary concept — confirmed the same conclusion
   `LmsEngine.settle()` already reached independently, for the identical
   payment shape (GE-4.5: both modes' `game_entries` are season-scoped).
3. **How does `predictor_cycle_mode` influence settlement?** Not at all —
   confirmed by review, not guessed. Its two real, documented uses (a
   not-yet-enforced pick-reuse restriction; a not-yet-decided
   `determineWinner()`/`awardPrize()` payout-timing question — does a
   `two_halves` pot pay out once or twice?) are both explicitly out of
   this slice's scope, and neither touches a flat one-time fee's voiding
   logic. `predictor_cycle_mode` is read nowhere in `settle()`.
4. **How are unpaid entries treated after scores already exist?** The
   entry's `game_entries.status` flips to `'void'` (shared `entry_status`
   enum, same value Pick 5/LMS use); already-computed
   `predictor_fixture_picks.points_awarded`/`game_entry_predictor` totals
   are left untouched, matching Pick 5/LMS's own `settle()` — neither
   zeroes the mode's own scoring columns; actual exclusion from a ranked
   result is `generateStandings()`'s job (a future slice), by only
   ranking `'settled'` entries. **Deliberately not mirrored**: Pick 5/LMS
   also flip their own picks table's per-row result to `'void'`
   (`pick5_picks.result`/`lms_team_picks.result`) — `predictor_fixture_picks`
   has no equivalent column, and never had one before this slice either;
   adding one now would be new schema surface with no reader, since
   `calculateScore()` isn't touched this slice and nothing else would ever
   consult it. Flagged as a real, known gap for whichever future slice
   builds a Predictor results UI or `generateStandings()`, not added
   speculatively.

   **A more consequential gap found during this review, also flagged
   rather than fixed:** `game_entries` is season-wide for Predictor
   (GE-4.5), but `calculateScore()` only ever resolves the one gameweek
   it's called for and has no `game_entries.status` awareness at all. An
   entry voided at gameweek 5's `settle()` could still have a
   not-yet-finished gameweek 8 pick resolved and folded into
   `game_entry_predictor`'s totals once gameweek 8 finishes —
   `settle()` never revisits or corrects that. `LmsEngine` has a
   narrower version of the same shape (its own `calculateScore()` checks
   `game_entry_lms.competitive_status`, which its `settle()`'s void path
   never syncs either) that has never been fixed or even previously
   flagged in this document. Not addressed here — this slice implements
   `settle()` only, per explicit instruction — but recorded so it isn't
   lost the way its LMS analog was.
5. **Can settlement safely rerun indefinitely?** Yes. The unpaid-entry set
   is re-derived fresh from `entry_payments` on every call; voiding is a
   plain status update that naturally excludes that entry from the next
   call's `.eq('status', 'pending')` selection — a retry that finds
   nothing new to void simply does nothing. Only one write happens in this
   method (the entries update), unlike Pick 5/LMS's two-step "void picks,
   then void entries" sequence — there is no picks-level write here to
   order relative to it (per Q4 above), so there is no partial-failure/
   retry-ordering hazard to guard against in the first place, not an
   omitted safeguard.

**Reason:** Payment Verification is shared-platform, mode-agnostic logic
(GE-3/GE-4.3) — Predictor's own payment model was left "still undecided"
in GE-4.3's own text pending a mode that actually needed it confirmed.
This slice confirms it: structurally forced by `entry_scope = 'season'`
(GE-4.5, same as LMS) and `pot_scope`'s only two values, `scope = 'season'`
is the only shape that fits, resolving GE-4.3's hedge rather than leaving
it open indefinitely.

**Alternatives considered:**
- **Wiring `generateStandings()`/`determineWinner()`/`awardPrize()` in
  now, mirroring Pick 5/LMS's own `settle()` structure** — rejected
  directly by the repo owner's explicit scope list ("Do not implement:
  standings, determineWinner(), awardPrize(), notifications").
- **Adding a `void`/`result` column to `predictor_fixture_picks` to mirror
  Pick 5/LMS's picks-level voiding** — considered, rejected for this
  slice: no existing reader, so it would be speculative schema surface: see
  Q4 above.
- **Gating settlement on a computed `predictor_cycle_mode` boundary**
  (half-season vs. season) — rejected: the boundary computation itself is
  a separately unresolved question (`docs/game-engine.md` § GE-15,
  "half_cycle boundary computation... needs resolving before Milestone
  6"), and Q2/Q3's review found no place in the payment-void logic where
  it would even apply. Inventing one here would answer an unasked, still-
  open question through the back door of an unrelated method.

**Consequences:**
- `PredictorEngine.settle()` is now implemented, but two real gaps are
  formally on record rather than silently absent: no pick-level void
  marker (Q4), and no protection against a later gameweek's
  `calculateScore()` re-scoring an already-voided entry's future picks
  (Q4, the more consequential one). Both need addressing before Predictor
  is genuinely launch-ready — likely together, in whichever future slice
  revisits `calculateScore()`/`generateStandings()`.
- `settle-gameweek/index.ts` needed the same one-line registration-import
  fix already applied to `compute-deadlines` (Slice 3) and `compute-scores`
  (Slice 4) — its dispatch loop already listed `score_predictor`
  unconditionally.
- `PredictorEngine.settle()`'s own `getPredictorPotIds()` helper is
  simpler than `LmsEngine.getEligibleLmsPotIds()`: no `start_gameweek_id`
  filter exists for Predictor pots (the entry-window rule remains
  genuinely undecided), and no "already concluded" filter is possible yet
  either, since `awardPrize()` doesn't write `pot_prizes` for this mode
  yet — every `score_predictor` pot is unconditionally eligible for now,
  the same kind of sequencing gap `LmsEngine`'s own Slice 7→8 later closed,
  flagged here rather than pre-solved for a method that doesn't exist yet.

**Verified:** 10 new unit tests (258/258 across `supabase/functions/`, no
regressions). Live, through the real `settle-gameweek` Edge Function (not a
bypass script): gameweek 9's real, single fixture (id 104, no other
gameweek in this dev database had every fixture already finished) was
temporarily flipped to `'finished'` — `settle()` itself never reads
fixture data, only the caller's own "is this gameweek ready" gate needed
it — two real entries (one with a verified `entry_payments` row, one with
none at all) were created in a real `score_predictor` pot; one real
`settle-gameweek` call correctly left the paid entry `'pending'` and
voided the unpaid one, and flipped gameweek 9 to `'completed'` as its own
documented side effect; the gameweek was then reopened and a second real
call confirmed the already-void entry was left alone, not reprocessed or
errored — 10 checks, all passing. All test data (1 pot, 3 users) removed
by exact ID; fixture 104 and gameweek 9 were reverted to their exact
original status (`'scheduled'`/`'upcoming'`) as part of cleanup; an
independent residue check (separate from the script's own report)
confirmed zero rows remain and both reverted statuses hold.

## calculateScore() must not mutate a voided entry

**Investigated and fixed 2026-08-08**, ahead of Milestone 6 Slice 6, per
the repo owner's explicit instruction to investigate the interaction
between `calculateScore()`, settlement, and voided entries for both LMS
and Score Predictor before continuing, and to implement the smallest
shared correction necessary if scoring could still mutate a voided entry.

**Finding: confirmed, for both modes, not hypothetical.** `settle()`
(Slice 5 for Predictor; Milestone 5 Slice 5 for LMS) voids an unpaid
entry by writing `game_entries.status = 'void'` — but neither mode's
`calculateScore()` reads that column at all:

- **LMS**: `calculateScore()` selects the entries to process via
  `game_entry_lms.competitive_status = 'alive'`, a column `settle()`'s
  void step never touches. A voided entry therefore stays `'alive'`
  there indefinitely. On the very next gameweek where it has no pick
  (the common case, since a voided entry is presumably no longer an
  engaged player, and `validateEntry()` already rejects any *new*
  submission once `entry.status !== 'pending'`), the "missing pick
  eliminates" branch fires and flips it to `'eliminated'` — a real
  mutation to state `settle()` had already finalized, reachable with no
  unusual precondition at all. If the entry *does* still have an
  already-submitted, not-yet-resolved pick for a later gameweek (equally
  possible — nothing stops picking several open gameweeks ahead of time),
  that pick's `result` gets freshly overwritten from whatever `settle()`
  itself hadn't touched (its void step voids picks for every gameweek at
  the moment of voiding, but only picks that already existed then).
- **Score Predictor**: `calculateScore()` has no `game_entries.status`
  awareness of any kind — flagged as a real, deferred gap during Slice
  5's own review, now confirmed and closed. A voided entry's
  not-yet-finished pick for a future gameweek would be freshly resolved
  and its points folded into `game_entry_predictor`'s cumulative totals
  by a later `calculateScore()` call, exactly as flagged.

**Pick 5 is unaffected** — its own `calculateScore()` already filters
`game_entries.status = 'locked'`, so a voided entry (which can never be
`'locked'` again) is naturally excluded. No change needed there; confirmed
by re-reading it, not assumed.

**Decision — the smallest shared correction:** both `LmsEngine.calculateScore()`
and `PredictorEngine.calculateScore()` now additionally filter their
`game_entries` lookup to `status = 'pending'`. Both modes' entries only
ever sit in `'pending'` or `'void'` at this stage (LMS/Predictor entries
never reach `'locked'`/`'settled'`, per GE-4.5/GE-5.2/GE-5.3), so
`status = 'pending'` is exactly equivalent to "not voided" — a one-line
change in each engine (LMS: added to the existing `game_entries` select
that builds `entryIds`; Predictor: added `status` to the existing
`game_entries` select and skip a pick in the main loop when its entry
isn't in the resulting pending set). No schema change, no change to
`settle()` itself in either mode, no change to Pick 5.

**Alternatives considered:**
- **Have `settle()` also sync `game_entry_lms.competitive_status`** (e.g.
  to a value meaning "voided") — rejected as larger than necessary: it
  would need a new status value (the enum is `alive`/`eliminated` only,
  GE-5.2's own deliberate two-value design) or overload `eliminated`
  incorrectly, and wouldn't help Predictor at all (no competitive-status
  concept exists there). The one-line `game_entries.status` filter fixes
  both modes with the same shape and no schema change.
- **Add a pick-level void marker to `predictor_fixture_picks`** (closing
  Slice 5's other flagged gap at the same time) — rejected as out of
  scope for "the smallest shared correction necessary": that gap is about
  a voided entry's *display* state, not about scoring *mutating* a voided
  entry, which is what was actually asked to be investigated and fixed.
  Still open, still tracked in `project-board.md`.

**Consequences:**
- `pot_standings_snapshots`/`generateStandings()` still has a related,
  narrower, previously-**unflagged** issue found during this same
  investigation: `LmsEngine.generateStandings()` ranks entries purely by
  `game_entry_lms.competitive_status`, with no `game_entries.status`
  filter at all — a voided entry with a stale `'alive'` status would
  still render in the "alive" tier of a standings snapshot. This is a
  *read*-side bug, not `calculateScore()` mutating anything, so it's
  outside this fix's actual scope ("if scoring can still mutate a voided
  entry") — flagged here for the record, not fixed, since generating
  standings isn't part of what was asked to be investigated.
- Both engines' existing test fakes needed their `game_entries` default
  fixture updated to include `status: 'pending'`, since the new filter
  means a fake row with no `status` field at all would previously have
  been silently excluded by the added `.eq()`/set-membership check —
  this surfaced as 11 failing Predictor tests on the first run (LMS's own
  fake already defaulted to `status: 'pending'`), fixed by updating the
  fake, not the production code.

**Verified:** 4 new unit tests (2 per mode — reproducing the exact
stale-`'alive'`-with-no-pick scenario for LMS, and the
unresolved-pick-on-a-voided-entry scenario for Predictor), 262/262 across
`supabase/functions/`, no regressions once the test fakes were corrected.
Live, through the real `compute-scores` Edge Function (not a bypass
script): a real voided LMS entry with a stale-`'alive'` extension row and
no pick for gameweek 9, and a real voided Predictor entry with one
unresolved pick against gameweek 2's real, already-finished fixture 26 —
one real call confirmed neither was touched (LMS entry still `'alive'`,
not eliminated; Predictor pick still unresolved, `points_awarded` still
null) — 3 checks, all passing. All test data removed by exact ID,
independently re-verified as zero residue rows.

## Late Payment Override

**Decided 2026-08-08**, a prerequisite correction ahead of Milestone 6
Slice 6, per the repo owner's explicit "review the payment lifecycle
across all three modes, re-read game-engine.md/business-rules.md/
decisions.md/current-state.md, review Pick5Engine.settle()/
LmsEngine.settle()/PredictorEngine.settle()/admin-actions/
generateStandings() — do not assume the implementation, first determine
the cleanest architecture" instruction.

**New business rule:** an organiser/admin may explicitly accept a late
payment and reinstate an entry that settlement already voided for
non-payment. This must never happen automatically — accepting the
payment (`mark_paid`) and reinstating the entry are two separate,
independently-explicit admin actions.

**Investigation, in the order the task asked for it:**

1. **Should reinstatement simply set `game_entries.status = 'pending'`,
   or does it need a dedicated flow?** A dedicated flow — a bare status
   flip is necessary but not sufficient. Reason: once a gameweek's
   `settle-gameweek` run flips `gameweeks.status` to `'completed'`
   (which happens in the same invocation that first voids the entry),
   `compute-scores` permanently stops calling `calculateScore()` for
   that gameweek (`compute-scores` only ever queries gameweeks with
   `status in ('upcoming','live')`). A voided entry's picks for every
   gameweek that occurred during the void window were never resolved
   (the cross-slice correction above deliberately excludes non-`'pending'`
   entries from `calculateScore()`), so nothing in the normal cron
   pipeline will ever catch them up on its own, regardless of the status
   flip. Reinstatement must explicitly trigger the catch-up itself.
2. **What happens to previously-voided picks / LMS `competitive_status` /
   Predictor cumulative scores / standings / winner determination?**
   - **Previously-voided picks (Pick 5/LMS)** self-correct for free once
     `calculateScore()` is re-invoked with the entry back in scope —
     that method already overwrites whatever's currently stored
     (including `'void'`) with a freshly computed result whenever they
     differ; no explicit "un-void" step is needed.
   - **LMS `competitive_status`** is untouched by voiding in the first
     place (confirmed by the cross-slice correction above) — reinstatement
     doesn't need to touch it either; `calculateScore()`'s own
     `aliveEntryIds` filter does the right thing once the entry is back
     in `status = 'pending'` scope, including correctly eliminating it
     for any gameweek during the void window it genuinely has no pick
     for (the existing "a missed pick eliminates" rule, replayed
     honestly, not bypassed).
   - **Predictor cumulative scores** stay frozen (as designed in Slice 5)
     until `calculateScore()` re-resolves the skipped gameweeks, at which
     point `game_entry_predictor`'s existing full-recompute design
     (Slice 4) picks them up automatically — no reinstatement-specific
     aggregation logic needed.
   - **Standings** are refreshed by re-running the normal `settle()`
     pipeline, below (which already calls `generateStandings()`).
   - **Winner determination** is not specially triggered — it's a normal
     consequence of re-running `settle()` (below), gated by the same
     "already concluded" guard that prevents reopening a real payout.
3. **Does reinstatement require recalculation? Which `GameEngine`
   methods, without duplicating logic?** Yes (per point 1). Exactly two,
   both already implemented, called directly rather than reimplemented:
   `calculateScore()` for every gameweek that may have been skipped, then
   `settle()` once, reusing 100% existing, already-tested logic. For
   Pick 5 (gameweek-scoped entry, GE-4.5) that's exactly one gameweek. For
   LMS/Predictor (season-scoped entry) that's every gameweek in the pot's
   own season, in ascending order — replaying the same sequence they'd
   have originally occurred in, required for LMS's elimination logic to
   reach the same conclusion it would have reached had the entry never
   been voided. `calculateScore()` cheaply no-ops for a gameweek that
   hasn't started or is already correctly resolved, so looping over the
   whole season (not attempting to compute a narrower "affected" range)
   is simple and safe, not wasteful in any way that matters for a rare,
   admin-triggered action.

   **Does re-running `settle()` risk automatically re-triggering
   `awardPrize()`/`determineWinner()` — the exact thing "must never
   happen automatically" forbids?** No, because of the guard in point 5
   below: reinstatement first refuses to proceed at all if the relevant
   competition instance has already concluded (a settled `pot_prizes`
   row already exists). Once past that guard, letting the pot's own
   normal, already-idempotent `settle()` pipeline run its natural course
   on now-correct data is the *intended*, not an incidental, outcome —
   it's exactly what would have happened on the next ordinary cron tick
   had the entry never been wrongly voided, just triggered immediately by
   the explicit reinstatement action instead of waiting for one. The rule
   the repo owner stated is about the *entry's reinstatement* being a
   deliberate, explicit act — not about suppressing every normal,
   already-established downstream consequence of correctly-scored data.
   Live-verified this is genuinely reachable, not just theorized: a
   single-entry LMS pot's reinstatement correctly ran all the way through
   to a real, paid conclusion in one call.
4. **Should Payment Verification gain `reinstate_entry`, or should
   `mark_paid` optionally reinstate?** A new, dedicated `reinstate_entry`
   admin action — folding it into `mark_paid` would make reinstatement an
   automatic side effect of marking paid, directly violating "this must
   never happen automatically." Lives in `admin-actions` (a new file,
   `reinstate.ts`, mirroring `bulkPayments.ts`'s existing split of a pure,
   unit-tested decision function from DB-orchestration code), not as a
   9th `GameEngine` contract method — this is cross-mode, shared
   Payment-Verification-adjacent admin tooling (GE-16's "Admin Service"
   category), the same category `mark_paid`/`mark_unpaid`/
   `bulk_verify_payments` already occupy, not mode-specific game logic.
   Gets the existing single-`pot_id` `isPotAdmin || isAppAdmin`
   authorization gate for free, same as `mark_paid`/`mark_unpaid`/
   `add_member`/`remove_member` — no special-casing needed, unlike
   `bulk_verify_payments`'s own multi-pot authorization.
5. **Should Pick 5 also support late payment overrides?** Yes — the repo
   owner explicitly warned not to assume otherwise, and the review
   confirmed the underlying problem is symmetric: any mode's `settle()`
   can void an entry for non-payment, so any mode's admin should be able
   to reverse that after a late payment, for the same reason. Pick 5's
   narrower, gameweek-scoped entry actually makes its "already concluded"
   guard trigger *more* often in practice, not less — `Pick5Engine.settle()`
   calls `awardPrize()` unconditionally every gameweek (a new payable
   instance concludes weekly for Pick 5), so by the time an admin gets
   around to accepting a late payment, that gameweek's prize has very
   often already been paid out. This isn't a Pick-5-specific special
   case: it's the *same* shared guard (a settled `pot_prizes` row for the
   relevant instance — `scope='gameweek'`+`gameweek_id` for Pick 5,
   `scope='season'` for LMS/Predictor) simply triggering at a different
   natural rate because Pick 5's competition instances conclude weekly
   instead of at season end.

**The "already concluded" guard, precisely:** before writing anything,
`reinstate_entry` looks up `pot_prizes` for the entry's own competition
instance (Pick 5: `pot_id`+`gameweek_id`+`scope='gameweek'`; LMS/Predictor:
`pot_id`+`scope='season'`) and refuses outright if `is_settled = true` —
real money has already been distributed for that instance, and
reinstating past that point would mean either clawing back an award or
creating a second, conflicting outcome. Not merely undesirable to allow
silently — refused with a clear, explicit rejection reason, matching the
same "the organiser must explicitly decide" spirit for the one case this
correction won't let them override at all (the money's already gone out
the door).

**Investigation into `admin-actions` surfaced a real, blocking, unrelated
bug, fixed as part of this correction because `reinstate_entry` cannot be
exercised for LMS/Predictor without it:** `mark_paid`/`mark_unpaid` both
upserted `entry_payments` with `onConflict: 'pot_id,user_id,gameweek_id'`
unconditionally. That target matches the full 3-column unique constraint
— correct for Pick 5's `scope='gameweek'` rows — but a season-scoped row
(LMS/Predictor, `gameweek_id` null) is actually deduplicated by a
*different*, partial unique index (`entry_payments_pot_user_season_key`,
unique on `(pot_id, user_id)` `WHERE gameweek_id IS NULL`), which
PostgREST's `onConflict` cannot target this way — the same class of gap
GE-4.6 already documents for `pot_standings_snapshots`/`pot_prizes`.
Confirmed live, not theoretical: a second write to the same season-scoped
key hard-failed with `duplicate key value violates unique constraint
"entry_payments_pot_user_season_key"`. This means marking a season-scoped
entry paid or unpaid more than once — routine, and exactly the
mark-paid-then-reinstate sequence this feature itself depends on — was
completely broken for LMS/Predictor. This **corrects** GE-4.3's own prior
claim ("No Payment Verification code changes of any kind are needed for
LMS") — that claim asserted the shape was correct without ever exercising
a second write against it. Fixed with the same get-or-create-by-id
workaround already established for the other partial-unique-index tables:
look up the existing row by its natural key first, then `UPDATE` by `id`
if found or `INSERT` if not. `bulk_verify_payments` is unaffected —
`gameweek_id` is a required, non-null parameter there, so it never
reaches the partial index.

**Schema change — `020_reinstatement_audit.sql`:** two new nullable
`game_entries` columns, `reinstated_at timestamptz` / `reinstated_by uuid
references profiles(id)`. Justified individually:
- `reinstated_at` — the durable audit timestamp "preserve auditability"
  requires, mirroring `entry_payments.marked_by`/`marked_at`'s own
  precedent for the *payment* decision; this records the *reinstatement*
  decision specifically, a genuinely distinct fact (an entry can be
  marked paid at any time independent of whether an admin has since also
  chosen to reinstate a voided row) that can't be folded into
  `entry_payments` without conflating two different decisions. A single
  nullable timestamp also doubles as the retry-safety signal
  `reinstate.ts` needs to distinguish "never voided" from "reinstatement
  in progress/retried" (see below) — not a second, redundant boolean
  alongside it, the exact "settled boolean alongside status" mistake this
  schema already removed once (GE-4.5).
- `reinstated_by` — accountability, directly mirroring
  `entry_payments.marked_by`.

No client grant on either column (verified live, not assumed): `anon`
inherited the same broad-but-RLS-blocked grants every other
`game_entries` column already had (harmless — `game_entries` has RLS
enabled with zero `anon`-role policies, confirmed live); `authenticated`'s
existing `UPDATE` grant is already narrowed to `updated_at` only via an
explicit column-level `GRANT` (GE-11), which does not automatically
extend to new columns, so no `REVOKE` was needed to keep these two out of
an ordinary user's reach — confirmed empirically after applying the
migration, not assumed. `service_role`'s own table-level access covers
the new columns automatically, also confirmed live, no explicit grant
needed.

**Retry-safety design, satisfying "remain fully idempotent"/"remain
retry-safe":** `decideReinstatement()` (a pure function, `reinstate.ts`,
unit-tested in isolation — the same split `bulkPayments.ts`'s
`classifyBulkPaymentRows()` already established) distinguishes four
non-write outcomes (`no_entry`, `not_void`, `payment_not_verified`,
`already_concluded`) from the one write outcome (`reinstate`). Critically,
`reinstate` itself carries a `writeStatus` flag: `true` for a fresh
void→reinstate transition, `false` when the entry is already non-`'void'`
but `reinstated_at` is already set — a retry of a previously-started
reinstatement whose status write landed but whose recompute pass may not
have finished. Both cases fall through to the *same* recompute step
unconditionally (re-running `calculateScore()`/`settle()` is itself
already idempotent, so simply always doing it again on a retry is
correct, not wasteful in a way that matters). This is why `reinstated_at`
being non-null-but-status-non-void is treated as "retry the recompute,"
not "nothing to do" — the alternative (treating any non-`'void'` status
as a no-op) would silently strand an incomplete recompute forever after
any partial failure.

**Verified:** 12 new unit tests for `decideReinstatement()` (every branch:
no entry, not-void-never-reinstated, unpaid, already-concluded, priority
between the last two, reinstate for each of the three game types with the
correct target status, retry for both LMS-shaped and Pick5-shaped
entries, an unpaid retry still rejected, an already-settled entry never
falsely reinstated) — 274/274 across `supabase/functions/`, no
regressions. Live, through the real `admin-actions` Edge Function (not a
bypass script): a non-admin pot member correctly forbidden (403);
reinstate-before-payment-verified rejected; the season-scope `mark_paid`
upsert fix exercised directly (a second real write, which previously
500'd, now succeeds); a manually-seeded settled `pot_prizes` row
correctly blocks reinstatement; a real LMS reinstatement correctly
re-resolved a previously-void pick to its true result and ran the
competition through to a genuine, paid conclusion (a single-entry pot in
a fully-historical season inevitably reaches one, which is the correct,
intended outcome, not a test artifact); a further reinstate call on that
now-genuinely-concluded pot was correctly blocked, without needing a
manually-seeded guard row this time; a normal, never-voided entry
produced a harmless no-op; a real Score Predictor reinstatement correctly
re-resolved a previously-unresolved pick and updated `game_entry_predictor`'s
totals — 18 checks, all passing. All test data (4 pots' worth of
users/entries/picks/payments) removed by exact ID, independently
re-verified as zero residue rows across pots, users, and entries.

## LMS standings must exclude voided entries

**Investigated and fixed 2026-08-08**, a prerequisite correction ahead of
Milestone 6 Slice 6, per the repo owner's explicit instruction to
investigate the previously-documented `LmsEngine.generateStandings()`
read-side issue before implementing Score Predictor's own standings.

**Question asked: can a reinstated or voided entry appear incorrectly in
standings because `generateStandings()` doesn't filter
`game_entries.status`?** Confirmed, for the voided case; not reachable for
the reinstated case.

- **Voided entries: confirmed, real, one-directional.**
  `LmsEngine.generateStandings()`'s own `game_entries` query had no
  `status` filter at all, and ranks purely by
  `game_entry_lms.competitive_status` — a column `settle()`'s void step
  never touches (established by the earlier `calculateScore()` mutation
  fix the same day). A voided (unpaid) entry, still carrying whatever
  `competitive_status` it had at the moment it was voided, would
  therefore still render — most often in the "alive" tier, directly
  contradicting the shared Payment Verification rule every mode is
  supposed to follow (business-rules.md § Payment verification rules:
  "excluded from the leaderboard entirely, regardless of how well its
  picks would have scored").
- **Reinstated entries: not incorrectly excluded.** There is no OTHER
  filter in this method that could wrongly hide a properly-reinstated
  entry — the bug is the *absence* of a filter, which means everything
  currently shows regardless of status. Once a reinstatement's own
  recompute pass (docs/decisions.md § Late Payment Override) correctly
  updates `competitive_status`, that entry displays correctly, with or
  without this fix. The fix's benefit is specific to the voided case.

**Fix — the smallest correction required:** `.neq('status', 'void')` added
to the existing `game_entries` query. Not `.eq('status', 'pending')` —
LMS entries can also reach `'settled'` once `awardPrize()` concludes the
competition, and a settled entry must still show (the competition having
concluded doesn't erase its final standing); excluding only `'void'` is
the minimal, correct filter. Not `.eq('status', 'settled')` either
(Pick5Engine's own filter) — that would hide every currently-in-progress
LMS entry until the whole competition concludes, wrong for a mode whose
standings are meant to reflect *current*, ongoing standing every
gameweek.

**Why this belongs here, not deferred:** two reasons, both explicit. It
was already flagged as a known, confirmed-adjacent gap during the
cross-slice `calculateScore()` correction earlier the same day (not a new
discovery). And Score Predictor's own `generateStandings()` (this slice's
actual objective) needs the identical consideration — reviewing and
fixing LMS's version first establishes the correct, verified precedent
Predictor's implementation follows, matching this whole project's
"review the existing modes before implementing the new one" discipline
applied to a bug fix instead of a fresh feature.

**Idempotency:** unaffected — `generateStandings()` was already a full
recompute + upsert-by-natural-key every call; adding a `WHERE` clause to
the initial read doesn't change that property. No new state, no schema
change.

**Not done, explicitly out of scope:** no redesign of LMS standings'
ranking, tie-break, or `meta` shape — only the missing filter was added.

**Verified:** 2 new unit tests (one reproducing the exact stale-`'alive'`
voided-entry bug, one confirming a `'settled'` entry still appears
alongside a `'pending'` one) — 276/276 across `supabase/functions/` at
the time this fix landed, no regressions (the generic `settle()` test
fake needed a `.neq()` method added to stay in sync with the new query
shape, itself a fake-only change, not a behavior change). No standalone
live check for this fix alone — it's exercised live as part of Slice 6's
own verification, below, whose scenario deliberately reuses the identical
`.neq('status', 'void')` shape for `PredictorEngine.generateStandings()`.

## Score Predictor standings

**Decided 2026-08-08**, Milestone 6 Slice 6, per the repo owner's explicit
"review Pick5Engine.generateStandings() and LmsEngine.generateStandings()
first, do not assume Predictor should follow either, justify every
similarity and difference" instruction — following directly from the
prerequisite investigation above.

**Decision:** `PredictorEngine.generateStandings()` ranks every non-void
entry in a pot by `game_entry_predictor.total_points`, using standard
competition ranking (ties share a rank), and writes only the overall
(`gameweek_id = null`) snapshot row per entry. Wired into `settle()`
(revised the same way Pick5's/LMS's own `settle()` needed revising when
each of their own Slice 6 shipped generateStandings() for the first
time), called unconditionally per eligible pot regardless of whether any
voiding happened that tick.

**Architecture review, the eight questions, in order:**

1/2. **How does Predictor differ from Pick 5, and from LMS?** Genuinely
   split down the middle, not modeled on either wholesale:
   - **Ranking — matches Pick 5, diverges from LMS.**
     `game_entry_predictor.total_points` is a real, directly comparable
     cumulative score, exactly like Pick 5's `picks_won` — so ranking
     reuses Pick 5's exact `rankWithTies()` algorithm (the same
     `ISSUE-17` resolution, confirmed with the repo owner once,
     platform-wide, not re-derived per mode). LMS has no real score at
     all (a synthetic 1/0 alive/eliminated indicator, ranked by
     elimination recency) — copying *that* shape here would have been
     assuming the wrong precedent for a mode that genuinely has points.
   - **Row shape — matches LMS, diverges from Pick 5.** Season-scoped
     entry (GE-4.5), so only the overall row is written, never a
     per-gameweek one — same reason LMS has none: Pick 5 writes a
     per-gameweek snapshot specifically because a new payable instance (a
     weekly jackpot) concludes every gameweek; no such per-gameweek
     payout concept exists for Predictor (GE-5.3: the pot splits once, at
     season end) or for LMS. Writing a per-gameweek row here would be
     schema nobody reads — the same "no unused abstraction" discipline
     already applied elsewhere in this codebase.
   - **Upsert workaround — shared mechanics, all three.** Same
     get-or-create-by-id workaround for `pot_standings_snapshots`'s
     partial unique indexes (GE-4.6) as Pick5Engine's and LmsEngine's own
     private copies — duplicated per GE-18, not imported (see
     Consequences, below).
3. **Generated every gameweek, only after settled gameweeks, or only
   after finished fixtures?** Every time `settle()` runs, gated only by
   the same caller-side "this gameweek's fixtures are all finished" check
   `settle-gameweek/index.ts` already applies uniformly — no separate
   internal fixture-status check inside `generateStandings()` itself.
   This method trusts `game_entry_predictor.total_points` as already
   correct, exactly like Pick5Engine's/LmsEngine's own
   `generateStandings()` trust their own source tables;
   `calculateScore()`'s own full-recompute design (Slice 4) is what
   actually enforces "only finished fixtures contribute," and trusting it
   here is safe because that guarantee was already established, not
   assumed fresh.
4. **How should tied cumulative scores be ranked?** Standard competition
   ranking, ties sharing a rank — see the Pick 5 comparison above. No
   Predictor-specific secondary tiebreak invented (e.g. "most exact
   scores wins a tie") — nothing in GE-5.3 or business-rules.md states
   one, and inventing one would repeat the exact mistake `ISSUE-17`
   already taught this codebase to avoid when real money is involved.
5. **What belongs in `meta`?** `{ exactScoreCount, correctScorerCount }`
   — the same "interesting fact behind the number" purpose LMS's own
   `meta` established (elimination gameweek), sourced directly from
   `game_entry_predictor`'s existing columns, zero extra queries,
   display-only (GE-20).
6. **Should void entries appear?** No — same shared Payment Verification
   rule every mode follows, enforced with the exact filter just corrected
   on `LmsEngine.generateStandings()` moments earlier the same session
   (above): `.neq('status', 'void')`, not `.eq('status', 'pending')` —
   Predictor entries can also reach `'settled'` once a future
   `awardPrize()` slice ships, and a settled entry must still show.
7. **Should reinstated entries automatically return once rescored?** Yes,
   with zero special-case code — this method has no memory of any
   previous snapshot, reads `game_entries.status` and
   `game_entry_predictor` fresh every call, and a successful
   reinstatement (§ Late Payment Override, above) already leaves both
   correctly updated by the time this runs again.
8. **Should standings ever contain partially-scored gameweeks?** Yes,
   naturally, no special handling needed — an unresolved pick simply
   hasn't added to `total_points` yet (`calculateScore()`'s own design),
   so the cumulative score read here is always an honest "as of right
   now" total, never a fabricated complete one.

**`settle()` needed a real restructure, not just an appended call.** Its
existing control flow had three early returns (no eligible pots; no
pending entries; nobody unpaid), the last of which — the overwhelmingly
common case, where nobody needs voiding — would have skipped standings
entirely if a `generateStandings()` call were merely appended at the
function's end. Restructured so the payment-void logic sits inside an
`if (entries?.length)` block instead of its own early return, and the
per-pot `generateStandings()` loop runs unconditionally afterward — the
same shape Pick5Engine's/LmsEngine's own `settle()` already needed when
*their* Slice 6 shipped generateStandings() for the first time.
`determineWinner()`/`awardPrize()`/`notifyUsers()` are deliberately not
called, per explicit instruction — same per-pot try/catch failure
isolation as Pick5/LMS, just for one method instead of two.

**Consequences:**
- `rankWithTies()` is now duplicated a second time (Pick 5, now also
  Predictor) — per GE-18, a cross-mode import isn't possible. The
  already-existing, deferred "extract the shared
  upsert/get-or-create-by-id workaround into a helper" `project-board.md`
  item now also covers this third private copy of that workaround
  (Pick 5, LMS, Predictor) plus a second copy of `rankWithTies()` — the
  case for that already-deferred, low-risk cleanup is stronger, not
  changed in kind.
- Predictor's `settle()` now performs meaningfully more work per call
  (a full standings recompute for the whole pot, every tick) than its
  Slice 5 self did — matches Pick5/LMS's own established cost, not a new
  category of cost.

**Verified:** 13 new unit tests (287/287 across `supabase/functions/`, no
regressions) — multiple cumulative scores ranked correctly, a tie sharing
a rank with the next rank skipping ahead, void exclusion, a settled entry
still included, a malformed (no extension row) entry excluded, `meta`
correctness, overall-only row shape, upsert-by-id idempotency across
repeated calls with a changed score, a reinstated entry reappearing with
no special-case code, and `settle()` writing standings even when nobody
needs voiding. Live, through the real `compute-scores` and `admin-actions`
Edge Functions (not a bypass script): five real entries in one pot — an
exact-score prediction, two tied correct-result predictions, a
wrong-result prediction, and a fifth, voided entry predicting the same
exact score as the first — `compute-scores` resolved the four paid
entries' picks; `admin-actions reinstate_entry` (marking the fifth paid,
then reinstating it) was the real trigger that first invoked
`settle()`/`generateStandings()` for this pot at all (confirmed nothing
had run beforehand) — the resulting standings correctly showed the exact
tie shape (`rank 1` shared by the two 5-point entries including the
freshly-reinstated one, `rank 3` shared by the two 3-point entries,
`rank 5` for the 0-point entry), correct `meta`, and a second
`reinstate_entry` call (a legitimate retry) left every score and rank
unchanged rather than duplicating or incrementing anything — 15 checks,
all passing. All test data removed by exact ID, independently
re-verified as zero residue.

## Score Predictor winner determination

**Decided 2026-08-08**, Milestone 6 Slice 7, per the repo owner's explicit
"review Pick5Engine.determineWinner() and LmsEngine.determineWinner()
first, do not assume Predictor should follow either, justify every
similarity and difference" instruction, continuing directly from Slice 6's
own standings work.

**Decision:** `PredictorEngine.determineWinner()` recomputes directly from
`game_entries`/`game_entry_predictor` (never `pot_standings_snapshots`),
returns every non-void entry tied for the highest cumulative
`total_points` once the pot's `end_gameweek_id` deadline has passed, and
returns `[]` otherwise. Purely a read — no writes of any kind.

**Architecture review, the eight questions, in order:**

1. **What constitutes a completed Predictor competition?** The pot's
   designated final gameweek (`pots.end_gameweek_id` — a shared,
   mode-agnostic column, GE-4.1, not an LMS-specific concept borrowed
   without justification) has actually passed its deadline. Same
   mechanism `LmsEngine`'s own `classifyOutcome()` already uses for its
   `season_end` case, reused for the identical reason: nothing about "has
   this season's real-world calendar end been reached" differs between
   the two modes. This is Predictor's *only* conclusion path, unlike
   LMS's four — no elimination concept means no earlier-than-end-gameweek
   conclusion is structurally possible (confirmed by re-reading
   `validateEntry()`/`calculateScore()`: `game_entry_predictor` has no
   status column analogous to `competitive_status`, exactly as the Slice
   1 architecture review already established).
2. **How does `predictor_cycle_mode` affect this?** Not at all — confirmed
   by reasoning, not assumed silently. GE-6's fixed
   `determineWinner(ctx, potId)` signature has no way to express "which
   half," so it can only ever answer one question: who has the most
   cumulative points once the season ends. That computation is identical
   regardless of `predictor_cycle_mode` — a `two_halves` pot's season-end
   winner is still whoever has the most points across the *whole* season,
   exactly like a `single_cycle` pot's. The genuinely open, still-
   unresolved question — whether a `two_halves` pot ALSO needs a
   separate, earlier determination at its half-cycle boundary
   (§ Score Predictor architecture review, above; GE-15's "half_cycle
   boundary computation... needs resolving") — is a question about a
   different, not-yet-designed invocation this method has no part of. Not
   guessed at, not blocked on.
3. **Once per season, once per half, or both?** Once per season only —
   the only concept the fixed interface can express (see Q2). "Once per
   half" would need a different method signature, not something to
   invent under "implement `determineWinner()` only."
4. **How are ties handled?** Every entry tied for the highest
   `total_points` is a winner — the same "every rank-1 entry wins"
   philosophy already used everywhere in this codebase (Pick 5's
   `rankWithTies()`-driven standings; LMS's wipeout/season-end groups),
   not reinvented here. No Predictor-specific secondary tiebreak — nothing
   documents one, and inventing one would repeat the exact mistake
   `ISSUE-17` already taught this codebase to avoid.
5. **Standings snapshots, or recompute from source?** Recompute directly
   from `game_entries`/`game_entry_predictor` — explicitly required
   ("never depend on cached state, recompute from authoritative data"),
   and matches `LmsEngine.classifyOutcome()`'s own choice, not
   `Pick5Engine.determineWinner()`'s (which *does* read
   `pot_standings_snapshots` — safe for Pick 5 only because a settled
   gameweek's snapshot can never change retroactively; a Predictor
   season-end snapshot could in principle be stale if `generateStandings()`
   hasn't been re-run since the last score change, so trusting it here
   would be trusting a cache, not the source of truth).
6. **How do reinstated entries interact with winner determination?**
   Included automatically, no special-case code — this method has no
   memory of any previous call, reads `game_entries.status` and
   `game_entry_predictor` fresh every time, and a successful
   reinstatement (§ Late Payment Override, above) already leaves both
   correctly updated by the time this runs.
7. **Can a void entry ever become eligible again?** Yes, via the same
   reinstatement flow — this method excludes `status = 'void'` entries at
   read time (the identical `.neq('status', 'void')` filter
   `generateStandings()` uses), but remembers nothing about that
   exclusion between calls; once reinstated, an entry is simply no longer
   void the next time this runs.
8. **Is repeated execution completely idempotent?** Yes, trivially — no
   writes of any kind, same "only determine the outcome" discipline
   already required of `LmsEngine.determineWinner()`. A pure read of
   current state is idempotent by construction.

**Reason:** Symmetric with `LmsEngine`'s own design decision for the
identical underlying reason (real money, no room for a stale or cached
"who won" answer), plus a hard, explicit requirement in this slice's own
task ("never depend on cached state, recompute from authoritative data")
that further confirms rather than merely permits this choice.

**Alternatives considered:**
- **Modeling on `Pick5Engine.determineWinner()`'s one-line
  `pot_standings_snapshots` lookup** — rejected. Simpler, but reads a
  derived cache rather than the source of truth, and the explicit
  requirement above rules it out directly, not just by preference.
- **A rich `PredictorOutcome` union with more than two cases, mirroring
  LMS's four-way `classifyOutcome()` return type** — considered, reduced
  to two (`in_progress` | `season_end`) once confirmed Predictor
  genuinely has no elimination-driven early-conclusion case at all;
  copying LMS's shape wholesale here would have been assuming a
  structural similarity that isn't actually true.
- **Throwing a `PredictorTwoHalvesNotImplementedError`-style guard for
  `two_halves` pots**, mirroring `LmsFinalPredictionNotImplementedError`
  — rejected once Q2's reasoning showed the season-end computation itself
  never differs by cycle mode; there is nothing here to guard against,
  unlike LMS's Final Prediction path, which genuinely cannot compute a
  result without a feature that doesn't exist yet.

**Consequences:**
- A private `classifyOutcome()` helper (mirroring `LmsEngine`'s own
  split) is reusable by a future `awardPrize()` slice exactly the way
  LMS's `awardPrize()` already reuses its own — "remain compatible with
  `awardPrize()`" satisfied by construction, not merely stated.
- The `two_halves` payout-timing question remains exactly as open as it
  already was — this slice neither resolves nor blocks on it, consistent
  with every prior slice's "flag, don't guess" handling of the same gap.

**Verified:** 9 new unit tests (296/296 across `supabase/functions/`, no
regressions — the shared `settle()` test fake needed `.maybeSingle()`
support and a `gameweeks` table added, since `determineWinner()` is the
first Predictor method to need either). Live, calling the real, shipped
`PredictorEngine` class directly against real database state produced
entirely through real Edge Function calls (`compute-scores` for scoring,
`admin-actions` for `mark_paid`/`reinstate_entry`) — not through an HTTP
endpoint, since `determineWinner()` isn't wired into any Edge Function
yet, the same "standalone, read-only method" shape Pick5's and LMS's own
Slice 7 had: a real pot with a real, already-passed `end_gameweek_id`
deadline, four real entries (two tied at the top with an exact-score
prediction, one lower, one starting void) — the two tied, paid entries
were correctly identified as winners, the voided entry correctly
excluded despite matching their score; reinstating the voided entry via
the real `admin-actions` Edge Function correctly grew the tie to three,
with no code change needed to make that happen; repeated calls returned
identical results and wrote nothing to `pot_standings_snapshots`; a
second, single-entry pot correctly produced exactly one winner — 13
checks, all passing. All test data removed by exact ID, independently
re-verified as zero residue.

## Score Predictor prize awarding

**Decided 2026-08-08/09**, Milestone 6 Slice 8, per the repo owner's
explicit "review Pick5Engine.determineWinner()/awardPrize() and
LmsEngine.awardPrize() first, do not assume Predictor should follow
either, justify every similarity and difference" instruction.

### A product-rule mix-up, caught before writing any code

The task arrived with a stated "NEW PRODUCT RULE (Pick 5)": winner
hierarchy of highest points, then "most exact score predictions," then
"most correct goalscorer predictions," then a full split. Before
implementing it, Pick 5's actual data model was checked
(`pick5_picks`: `player_id`, `goal_threshold`, `goals_scored`, `result` —
a pick wins if `goals_scored >= goal_threshold`) and cross-referenced
against `business-rules.md`/`decisions.md`: Pick 5 has no concept of an
"exact score" or a "goalscorer prediction" at all — that vocabulary
exists nowhere in Pick 5's schema or documented rules, only in Score
Predictor's own (`predictor_fixture_picks.is_exact_score`,
`game_entry_predictor.exact_score_count`/`correct_scorer_count`, Slice
4). Per the task's own explicit instruction — "if any product rule is
genuinely missing, stop and ask instead of inventing behaviour" — this
was raised directly rather than guessed at (silently applying it to Pick
5's `goals_scored`/`goal_threshold` fields under an invented
reinterpretation, or silently assuming it was a mistake and doing
nothing, would each have been inventing behaviour in a different
direction). **Confirmed by the repo owner: the rule was meant for Score
Predictor, not Pick 5.** Pick 5's `determineWinner()`/`awardPrize()` are
therefore **entirely unchanged** by this slice — the tiebreak hierarchy
applies to `PredictorEngine.determineWinner()` instead, revising Slice
7's own "no secondary tiebreak — nothing documents one" conclusion, which
was correct at the time (no rule existed yet) and is now superseded by an
explicit one, the same way several other slices in this project have
revised their own prior, correctly-reasoned-at-the-time conclusions once
a real product decision changed the premise.

### Predictor's revised tiebreak (Slice 8)

`PredictorEngine`'s private `classifyOutcome()` (Slice 7) now narrows its
`season_end` winner set through three levels, only when the level above is
tied: highest `total_points`, then highest `exact_score_count`, then
highest `correct_scorer_count`; whatever remains after all three
genuinely ties and splits equally at `awardPrize()`, unchanged mechanism.
Deliberately **not** applied to `PredictorEngine.generateStandings()`'s
own ranking (Slice 6) — the repo owner's own instruction for this
correction said "no changes to standings unless genuinely required," and
awarding the actual prize doesn't require the ongoing leaderboard display
to adopt the same tiebreak; that leaderboard still uses the shared "every
rank-1 entry ties, no further tiebreak" rule every other standings view
in this codebase uses.

### Architecture review — the seven Score Predictor questions, in order

1. **How does `predictor_cycle_mode` affect prize awarding?** Not at all
   — same reasoning as `determineWinner()` (Slice 7): the fixed
   `awardPrize(ctx, potId)` signature can only ever award the one
   season-end outcome `determineWinner()` identified, and that
   computation and payout are both unchanged by cycle mode. The still-open
   "does `two_halves` need a *separate*, earlier payout at its half-cycle
   boundary" question is not resolved or guessed at here.
2. **One `pot_prizes` row, or multiple?** One — `scope='season'`,
   matching `LmsEngine`'s shape exactly, not `Pick5Engine`'s (which
   legitimately creates a new `scope='gameweek'` row every week because a
   new payable instance — a weekly jackpot — concludes weekly for Pick
   5). Predictor has exactly one conclusion, ever, per pot (GE-5.3, no
   elimination, no recurring weekly payout) — the identical structural
   fact that already made LMS a single-row mode.
3. **How are tied winners paid?** Equally, via the same `floorToCents`
   split every mode already uses — the tiebreak hierarchy above narrows
   `determineWinner()`'s output as far as points/exact-score/scorer-count
   can resolve it; whatever's left after that genuinely ties and splits,
   same as Pick 5's/LMS's own remaining-tie handling. No tied recipient is
   ever favored by rounding — the remainder (at most `winnerCount - 1`
   cents) is never paid to anyone, identical rule platform-wide.
4. **Does Predictor use prize deductions identically to Pick 5/LMS?** Yes
   — `admin_fee_*`/`charity_fee_*` are shared, mode-agnostic `pots`
   columns (GE-4.1), calculated with the identical `roundToCents`/fee-
   percentage math (a private duplicate, per GE-18). One genuine
   divergence: `gross_amount` has no `carry_over_amount` term the way
   `LmsEngine`'s does — LMS's carry-over exists specifically for its own
   rollover-pot mechanism (a wipeout resolving as `roll_prize`, GE-5.2), a
   structurally LMS-only concept with no Predictor equivalent (Predictor
   pots' own `carry_over_amount` is always 0, since nothing ever sets it
   for this `game_type`) — including an always-zero term would be dead
   code, not a faithful port.
5. **Should `awardPrize()` consume `determineWinner()` directly?** Yes —
   unlike `LmsEngine.awardPrize()` (which calls `classifyOutcome()`
   directly, because it genuinely needs the richer outcome type to
   distinguish wipeout/season_end/single_survivor's different payout
   groups and the wipeout-only rollover branch), Predictor's
   `classifyOutcome()` carries no information `determineWinner()` doesn't
   already flatten faithfully — there is only one non-trivial outcome
   shape, `season_end`, and no further branching by outcome type. Calling
   `determineWinner()` directly matches `Pick5Engine.awardPrize()`'s own
   choice, for the same reason: nothing richer to lose by using the thin
   wrapper instead of the private helper. This also confirms, rather than
   duplicates, `determineWinner()`'s own tiebreak logic — the entire
   reason this question was asked was to avoid re-implementing that
   hierarchy a second time here.
6. **Does repeated execution remain fully idempotent?** Yes — identical
   mechanism to `Pick5Engine`'s/`LmsEngine`'s own: an existing, settled
   `pot_prizes` row (`scope='season'`) short-circuits the whole method
   before any classification or writes happen.
7. **Any additional transaction-ordering risks?** Simpler than LMS's, not
   riskier — Predictor has no rollover-pot-creation step (an LMS-only
   wipeout mechanism), so there are only three writes: settle entries to
   `'settled'` (idempotent UPDATE), write payouts (idempotent UPDATE),
   then the `pot_prizes` row LAST — applying the hardening-sprint's
   write-ordering lesson from the start rather than retrofitting it later,
   the way both `Pick5Engine`/`LmsEngine` originally had to. `is_settled
   = true` is written only once every other write has already succeeded,
   so a failure anywhere above it leaves the pot safely retryable with no
   compensating-rollback logic needed (unlike LMS's own rollover step).

**Silent no-op on zero winners** — deliberately matching
`LmsEngine.awardPrize()`'s philosophy, not `Pick5Engine`'s (which throws
`Pick5NoEligibleWinnersError` when `winners.length === 0` despite settled
entries existing — genuinely anomalous there, since Pick 5's `settle()`
has already confirmed real, paid, settled entries exist by that point).
For Predictor, "season not concluded yet" is the overwhelmingly common
state (this method runs every `settle()` tick, same as LMS), and a
genuinely-concluded pot with zero eligible entries has zero money to
award either (`gross_amount` computes to 0) — internally consistent, not
an anomaly worth failing loudly for.

**`settle()` wiring:** `PredictorEngine.settle()`'s existing per-pot loop
(Slice 6, `generateStandings()` only) now also calls `awardPrize()` — the
same revision Pick5Engine's/LmsEngine's own `settle()` needed when each
shipped `awardPrize()` for the first time (their own Slice 8s). Most calls
find the season still in progress and `awardPrize()` silently no-ops,
exactly like `generateStandings()` being idempotent/harmless on an
ordinary gameweek.

**Consequences:**
- A new error class, `PredictorPrizePoolExceededError`, mirrors
  `Pick5PrizePoolExceededError`/`LmsPrizePoolExceededError` exactly — fee
  configuration that would drive `net_amount` negative fails loudly
  before any write, never silently clamped.
- No schema change — every column used (`pot_prizes.gross_amount`/
  `admin_fee_amount`/`charity_fee_amount`/`is_settled`, `game_entries.
  payout_amount`/`status`, `game_entry_predictor.exact_score_count`/
  `correct_scorer_count`) already existed.

**Verified:** 13 new unit tests for `awardPrize()` (sole winner, tied
split, percentage + fixed fee deductions together, prize-pool-exceeded
error, idempotent re-call, retry after an injected mid-method failure —
a dedicated fake-level failure-injection flag, same purpose as the LMS
fake's own `entriesVoidShouldFail`/`picksVoidShouldFail`) plus 3 revised/
new `determineWinner()` tests for the tiebreak hierarchy itself (exact-
score tiebreak, scorer-count tiebreak, a genuine complete tie still
splitting) — 305/305 across `supabase/functions/`, including Pick 5's own
full, entirely unmodified test suite (a direct regression check: zero
changes to `pick5/engine.ts`, confirmed by `git diff`, and its existing
tests passing unchanged). Live, through the real `settle-gameweek` and
`compute-scores` Edge Functions (not a bypass script), using the same
"gameweek 9 triggers the call, a separate pot's own `end_gameweek_id`
marks the season concluded" technique Slice 5 established: a sole winner
with 10%-admin-fee + fixed-charity-fee deductions correctly received the
entire net prize while the non-winning (but still-participating, still-
settled) entry received nothing; a genuine complete tie split the net
prize evenly; a second real `settle-gameweek` call left every payout and
`pot_prizes` row unchanged (idempotent, not doubled); a third pot proved
retry-safety against a real, client-side-intercepted write failure (no
persistent database mutation, unlike a schema-level constraint injection
would risk on a shared local dev database) — the first attempt correctly
left no `pot_prizes` row and no payout behind, and a plain retry, with no
special recovery step, completed correctly — 24 checks, all passing. All
test data removed by exact ID, independently re-verified as zero
residue; the temporarily-flipped fixture/gameweek status both correctly
reverted.

## Score Predictor notifications

**Decided 2026-08-09**, Milestone 6 Slice 9 — the final `GameEngine`
method for Score Predictor. Per the repo owner's explicit "review
Pick5Engine.notifyUsers() and LmsEngine.notifyUsers() first, do not
assume Predictor should follow either, justify every similarity and
difference" instruction.

**Finding: the two existing implementations are byte-for-byte identical
to each other already.** Both `Pick5Engine.notifyUsers()` and
`LmsEngine.notifyUsers()` do exactly the same thing — insert one row into
`notifications`, throw on error — with zero mode-specific logic in
either. This is a strong, direct signal (not an assumption) that
`notifyUsers()` itself is genuinely shared-platform-shaped, not a method
where "don't assume Predictor should follow either mode" leaves any real
room for divergence: `PredictorEngine.notifyUsers()` is the same
duplicate (per GE-18, no cross-mode import), with no design decision to
make beyond the routine "reuse the established pattern."

**Architecture review — six questions, in order:**

1. **Which notification events should Predictor emit?** Exactly one,
   `predictor.prize_awarded` — mirroring both existing modes' own single
   event type (`pick5.prize_awarded`, `lms.prize_awarded`) exactly.
   Unlike LMS (which explicitly weighed and rejected a second,
   rollover-specific event, since it has multiple distinct outcome
   shapes to potentially describe), Predictor has no second event
   candidate to even consider: `awardPrize()` has exactly one non-trivial
   outcome shape (`season_end`, GE-5.3 — no elimination, no wipeout, no
   rollover), so there's nothing else for a notification to describe.
2. **Once per winning user, once per pot, or both?** Once per winning
   user — the same loop shape both existing modes use, uniform whether
   `winners.length` is 1 (a sole winner) or more (a tied group): no
   special-casing by winner count, since a "tied winner" notification and
   a "sole winner" notification are the same write with a different
   payload, not a structurally different flow. Never once per pot.
3. **What payload should be stored?** `{ amount, tied }`. `amount`
   mirrors both existing modes exactly (the actual payout this recipient
   received — the core fact the notification exists to convey). The
   second field diverges from both, deliberately, rather than copying
   either verbatim: Pick 5's own second field is `gameweekId` (meaningful
   there because its competition instance *is* a gameweek); LMS's is
   `outcome` (meaningful there because it has three genuinely different
   conclusion shapes — single_survivor/wipeout/season_end — worth
   recording which one occurred). Neither applies to Predictor: it has no
   gameweek-scoped instance and, per Q1, only one outcome shape, so
   copying either field would carry no real information (LMS's own
   `outcome` field would always read the same constant value for
   Predictor). `tied: winners.length > 1` is the genuinely Predictor-
   relevant analog — recipient-specific context about the *nature* of
   their win, cheaply available from data `awardPrize()` already computed
   (no extra query), directly relevant given Slice 8 just added a real
   tiebreak hierarchy that decides whether a win is sole or shared.
4. **Must failed notification writes affect settlement?** No — required
   explicitly ("never prevent prize settlement if notification insertion
   fails") and matches both existing modes' own call-site design exactly:
   `notifyUsers()` itself still throws on error, like every other
   `GameEngine` method, but the call site inside `awardPrize()`'s
   recipient loop wraps it in try/catch, logs, and continues — never
   unwinds or blocks a payout already written, never stops the loop from
   notifying the pot's remaining winners.
5. **Emitted for sole winner, tied winners, split prizes?** Yes to all
   three, uniformly — see Q2. These are just different sizes of the same
   `winners` array processed by the same loop, not different code paths.
6. **Does repeated execution remain fully idempotent?** Yes — not via any
   dedup mechanism on the `notifications` table itself (there is none,
   matching both existing modes' own established precedent), but because
   the entire notify loop is only ever reached once per pot's actual
   conclusion: `awardPrize()`'s own existing `pot_prizes.is_settled`
   short-circuit means an already-awarded pot never reaches the notify
   loop again on any later call, so a retry of the *outer* method can
   never duplicate notifications. A single recipient's own notification
   write failing (logged, not retried) is an accepted, pre-existing
   limitation this design shares with Pick5Engine's/LmsEngine's own — not
   a new gap introduced here, and not something this slice redesigns
   (explicitly out of scope: "do not redesign notifications").

**No delivery mechanism invented or implied** — `notifyUsers()` remains a
pure domain-event emitter, exactly matching
[decisions.md § Notifications: domain events, not delivery](./decisions.md#notifications-domain-events-not-delivery)'s
original design and both existing modes' own implementations. Email/push/
SMS delivery remains explicitly out of scope, unchanged by this slice.

**Wiring:** `PredictorEngine.awardPrize()`'s notify loop is placed after
the trailing `pot_prizes` write, matching the exact invariant both
existing modes already established — a notification only ever fires once
both the money and the settlement record it describes are already
durably written. Settlement logic itself (the payout loop, the entry-
settling update, the `pot_prizes` write) is completely unmodified by this
slice, per the explicit "do not modify settlement logic" instruction —
only the notify loop was appended after it.

**Consequences:**
- All eight `GameEngine` contract methods are now implemented for Score
  Predictor — Milestone 6's core implementation work (Slices 1-9) is
  complete, the same milestone-completion point Pick 5 (Milestone 4) and
  LMS (Milestone 5) each reached at the end of their own Slice 9.
- No schema change — `notifications` already had every column needed
  (`user_id`, `pot_id`, `type` free-text, `payload` jsonb).

**Verified:** 7 new unit tests (`notifyUsers()` writes/throws correctly
in isolation; `awardPrize()` writes a correct sole-winner notification;
writes one correctly-tied notification per tied winner, never once per
pot; still awards the prize and payout when the notification write fails
— failure isolation; still notifies a remaining winner after one of two
notification writes fails; does not duplicate a notification on an
idempotent second call) — 312/312 across `supabase/functions/`, no
regressions. Live, through the real `settle-gameweek`/`compute-scores`
Edge Functions (not a bypass script): a sole winner received exactly one
correctly-typed, correctly-payloaded notification while the non-winning
entry received none; a genuine tied pot produced exactly two
notifications, both correctly marked `tied: true`; a second real
`settle-gameweek` call left both pots' notification counts unchanged
(not duplicated); a third pot proved failure isolation by calling the
real `PredictorEngine` class directly with the `notifications` insert
intercepted client-side (no persistent database mutation) — `awardPrize()`
itself did not throw, the winner was still paid in full, the entry still
settled, the pot still fully settled, and no notification row exists for
the one attempted write that genuinely failed — 15 checks, all passing.
All test data removed by exact ID, independently re-verified as zero
residue; the temporarily-flipped fixture/gameweek statuses both
reverted.

## Member invitations

**Decided 2026-08-09**, Phase 7 Stage 2 Slice 3 (`ISSUE-8`). Before writing
any code, the exact existing backend was read directly, not assumed: two
mechanisms already exist, both from Milestone 2/4, neither ever wired to
any frontend. `pots.invite_code` (unique, nullable) +
`redeem_invite(p_invite_code text)` — a `security definer` RPC that looks
up the pot by code, rejects an invalid code or a caller already a member,
and inserts a `pot_members` row as `'member'`, all in one server-side
step. And `admin-actions`' `add_member`/`remove_member` — an organiser (or
app-admin) adding or removing a specific, already-registered user by id,
also immediate, also already implemented and tested.

**Architecture review finding: there is no "pending invitation" concept
anywhere in the schema.** `pot_members` has no status column; `joined_at`
is always set at insert time. Both existing mechanisms grant membership
immediately, in one step — there is no intermediate state between "not
invited" and "a full member."

**This created a real tension against the task's own initial request**,
which asked for "pending members," "resend invitations," and "accept/
decline" as distinct player actions — none representable in the current
data model. Two paths existed: add a small, additive `pot_invitations`
table (new pre-membership layer, `pot_members`/roles themselves untouched)
to support those literally, or build only on what already exists and
accept that those specific items become approximate rather than literal.
**Raised directly with the repo owner rather than guessed at, per this
project's own "if a product rule is genuinely missing, stop and ask"
discipline.** The repo owner chose the second option explicitly and in
detail: *"Do NOT introduce a new `pot_invitations` table. Do NOT redesign
the membership model. The existing backend architecture is intentional
and should remain the source of truth. Membership is immediate. This is
the MVP behaviour... There is NO concept of: pending invitations,
invitation status, resend invitation, accept invitation, decline
invitation. Those are future enhancements and are explicitly out of
scope."**

**Revised scope, per that instruction:**
- Organiser: generate/copy an invite code, copy a shareable invite link
  (`{origin}/join/{code}`), add a known registered user directly by
  username, view current members, remove members.
- Player: join by invite code, join by invite link, immediate membership,
  duplicate-join protection (already server-side, via `redeem_invite()`'s
  own existing-member check), friendly success/error messages, view
  joined competitions.
- No pending state, no resend, no accept/decline, anywhere. "Leave the
  competition" was investigated (`admin-actions`' `remove_member` is
  gated to callers who are already a pot admin — a regular member has no
  path to remove themselves) and deliberately **not** built: the task's
  own framing was "if existing rules allow," and they don't — extending
  `remove_member`'s authorization to permit self-removal would be new
  backend business logic, not "only fix bugs," so it's documented as an
  open, out-of-scope gap rather than built.

**Implemented, reusing 100% of the existing backend — zero migrations,
zero Edge Function changes:**
- `hooks/useMembership.js` — `useGenerateInviteCode()` (client-side random
  8-char code from an ambiguity-free alphabet, written via a plain
  `pots` update — `pots_update_admin`, 002_rls_policies.sql, already lets
  an admin update any column on their own pot, `invite_code` included;
  retries on the astronomically rare unique-constraint collision, since
  `invite_code` is globally unique, not per-pot); `useSearchProfilesByUsername()`
  (a plain read against `profiles`, already broadly readable to any
  authenticated user per `profiles_select_authenticated`, `using (true)`
  — username only, since `profiles` has no email/phone column and
  `auth.users` isn't client-readable at all, same reason
  `admin-actions`' own bulk-payment identifier resolution needs the
  service role instead); `useAddMember()`/`useRemoveMember()` (thin
  wrappers around the existing `admin-actions` actions); `useRedeemInvite()`
  (wraps the RPC, translates its two known exception messages into a
  friendlier shape, with a best-effort follow-up pot lookup for the
  "already a member" case — only possible *after* membership is
  confirmed, since `pots` RLS requires membership to read a row at all).
- `components/pot/InviteCard.jsx` (copy code/link, generate-if-missing,
  add-by-username) and `components/pot/MemberList.jsx` (plain list +
  admin-only remove with a confirmation modal, reusing the existing
  `Modal` component) — both mounted on all three pot-detail surfaces
  (Pick 5's existing Members tab gained a "Remove" button added directly
  to its existing per-row rendering rather than a second, duplicate list;
  LMS/Predictor, which had no members section at all before this slice,
  got the full `InviteCard` + `MemberList` pair).
- `pages/JoinPot.jsx`, a new public route (`/join`, `/join/:inviteCode`,
  deliberately outside `ProtectedRoute`/`AppShell`) — a real invite link
  must work for someone who isn't signed in yet, not just an existing
  member. `pots` itself isn't readable pre-membership (every `pots`
  SELECT policy requires an existing `pot_members` row), so there's no
  pot-name preview possible before joining — the post-join redirect to
  `/pot/:potId` is what shows the player what they joined.
- `pages/auth/SignIn.jsx`/`SignUp.jsx` gained a `redirect` query-param
  (falling back to the existing `/dashboard` default) — without it, a
  signed-out visitor clicking a real invite link would be bounced through
  sign-in and land back on `/dashboard` with the invite code lost
  entirely. `JoinPot.jsx` passes `?redirect=/join/:code` when it renders
  the signed-out sign-in/sign-up prompt.

**A real bug found and fixed during this slice's own live verification,
not deferred**: `pages/PotDetail.jsx` (Pick 5) holds its `pot`/`members`
state via plain `useState` + imperative fetches, not react-query — so
`useGenerateInviteCode()`/`useAddMember()`'s own `invalidateQueries(['pot',
potId])` calls (correct for the LMS/Predictor surfaces, which use
`usePot()`) never touched it. Confirmed live: generating an invite code
wrote `BSD9PK44` to the database correctly, but the UI kept showing "No
invite code yet" until a manual reload. Fixed with the smallest available
change — an optional `onChange` callback prop on `InviteCard`, called
after a successful generate/add in addition to its own cache
invalidation; `PotDetail.jsx` passes `async () => { await loadPot(); await
loadMembers() }`, its own existing reload functions. LMS/Predictor don't
need to pass it — their `usePot()`-based state already refreshes
correctly via react-query alone. Not a reason to convert `PotDetail.jsx`
to react-query wholesale (`ISSUE-10`'s own existing scope, deliberately
not touched here).

**Verified live**, real browser, two real users (an organiser and a
player, sequential sessions — sign out/sign in, not concurrent, since
proving the flow doesn't require true concurrency): organiser created a
pot, generated an invite code, copied both the code and the derived link;
player joined via the invite link while already signed in (immediate
membership, confirmed via direct DB read); a second redemption attempt
with the identical code correctly hit the "already a member" path and
still redirected to the pot, no duplicate `pot_members` row; organiser
removed the player via the confirmation-modal-gated Remove button, the
UI's member count and the "add by username" search results both updated
live with no page reload; organiser added the same player back directly
by username, confirmed live; player rejoined via the plain `/join` form
(no code in the URL, typed and lowercase — case-normalized client-side
before submission) after being removed a second time; an invalid invite
code produced a friendly "Invalid invite code" message, not a raw
exception; a fully signed-out visitor landed on the same invite link,
saw sign-in/sign-up prompts carrying the invite code through the redirect
query param, and after signing in landed back on the join page (not the
default dashboard) with the code still pre-filled. "View joined
competitions" needed no new code at all — `Dashboard.jsx`'s existing
`usePots()` already lists every pot a user is a member of. All test data
(1 pot, 2 users) removed by exact ID, independently re-verified as zero
residue.
