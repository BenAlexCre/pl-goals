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
UI to mark a payment. Live status: [current-state.md ISSUE-6](./current-state.md#issue-6--payments-ui-isnt-wired-up-compute-scores-will-void-every-entry).
Once payments UI exists, this design still leaves open a real product question worth
deciding deliberately: should the deadline for marking paid be before or after the
pick deadline?
