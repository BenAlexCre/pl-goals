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
