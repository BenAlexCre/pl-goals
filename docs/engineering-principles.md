# Engineering Principles

Last reviewed: 2026-08-03.

This is the engineering handbook for this repository — the conventions new code is
expected to follow, regardless of whether all existing code follows them yet. Where
the current codebase deviates from a standard below, that's tracked as an issue in
[current-state.md](./current-state.md) (linked inline), not treated as a second valid
pattern to keep using. Don't write new code that matches an anti-pattern just because
older code in the repo does the same thing — match the standard here instead, and
optionally note the pre-existing violation if you're already touching that file.

This document changes rarely — only when the team actually decides to change a
convention, not every time a violation is found. New violations go in
[current-state.md](./current-state.md) as issues; this document stays the fixed
target those issues are measured against.

See also: [architecture.md](./architecture.md) (the structure these conventions
apply to), [decisions.md](./decisions.md) (why some structural choices were made),
`CLAUDE.md` (project-level operating instructions this document elaborates on).

## Folder structure

```
frontend/src/
  pages/        one component per route — orchestrates hooks + components, minimal logic of its own
  components/   presentational and feature components, grouped by domain (picks/, pot/, admin/, layout/, ui/)
  hooks/        one file per domain (usePots.js, useEntry.js, ...) — the only place supabase-js is called from page/component code
  lib/          cross-cutting clients and utilities with no React dependency (supabase.js, queryClient.js)
  store/        zustand stores — only for state that's genuinely global and client-only (session, toasts)
  utils/        pure functions, no side effects, no React, no Supabase
supabase/
  migrations/   the only source of schema truth — see Supabase conventions below
  functions/    one directory per edge function, `_shared/` for code used by more than one function
  seed/         idempotent seed data, safe to re-run
  scripts/ (frontend/scripts/)  standalone Node scripts run manually, never imported by the app
```

**Rule:** a page component should not call `supabase.from(...)` directly — it should
call a hook from `hooks/`. This rule exists specifically because it was violated
early on and the violation caused real, findable bugs — see
[current-state.md ISSUE-10](./current-state.md#issue-10--duplicated-data-fetching-pattern)
and [ISSUE-7](./current-state.md#issue-7--two-pick-building-flows-enforce-different-eligibility-rules)
for what happens when it isn't followed: the same query gets re-implemented in two
places and the two copies drift.

## Naming conventions

- **Components:** PascalCase file and export name, one component per file
  (`PickSelector.jsx`, not `pickSelector.jsx` or multiple components per file).
  `components/pot/potManager.jsx` and `components/entryBuilder.jsx` are pre-existing
  exceptions to fix opportunistically (lowercase-leading filenames for a
  PascalCase-exported component are exactly the kind of mismatch that produced
  [ISSUE-11](./current-state.md#issue-11--dead-code-including-a-latent-case-sensitivity-import-bug)'s
  case-sensitivity bug) — don't add new files that follow their pattern.
- **Hooks:** camelCase, always prefixed `use` (`usePots.js`, `useLiveScores.js`), one
  file per domain rather than one file per hook where the hooks are related.
- **Database tables/columns:** snake_case, plural table names (`pots`, `fixtures`,
  `user_entries`), singular enum type names (`pot_status`, not `pot_statuses`).
  Foreign key columns end in `_id` and match the referenced table's singular
  (`gameweek_id`, `player_id`).
- **Migrations:** numbered prefix, zero-padded to at least 3 digits, snake_case
  description (`004_add_fixture_player_status.sql`) — continue the sequence already
  established by `001_initial_schema.sql`, `002_rls_policies.sql`,
  `003_cron_jobs.sql`.
- **Issue ids:** `ISSUE-N`, assigned sequentially in discovery order (never reused,
  never reassigned to match a document's reading order) — see
  [current-state.md § Issue register](./current-state.md#issue-register).

## React conventions

- **Function components only**, no class components.
- **Server state goes through TanStack Query hooks in `hooks/`.** This is the
  established pattern for `Dashboard`, `PicksPage`, `GameweekPage`, and
  `AdminDashboard` and should be the pattern for everything — see
  [architecture.md § Two competing data-fetching patterns](./architecture.md#two-competing-data-fetching-patterns)
  for the two files that don't follow it and the debt that's produced.
- **Zustand is for genuinely global, client-only state only** (auth session, toast
  queue) — not a place to cache server data that a `useQuery` hook should own instead.
- **Business rules that affect what a user can pick or submit belong in exactly one
  place**, not copied into each component that needs to check them. Where the picker
  UI needs "is this player eligible," "has this deadline passed," or "how many of
  this player has the user already picked," those checks should call a shared
  function, not re-derive the logic locally — this is the concrete fix for
  [ISSUE-7](./current-state.md#issue-7--two-pick-building-flows-enforce-different-eligibility-rules).
- **Realtime subscriptions invalidate query caches, they don't carry payload data
  into state directly** — follow `hooks/useLiveScores.js`'s pattern of calling
  `queryClient.invalidateQueries(...)` on a `postgres_changes` event rather than
  trying to merge the raw payload into local state.

## Supabase conventions

- **Every schema change is a migration.** The live database should never be edited by
  hand through the dashboard without a corresponding migration file committed
  afterward — [ISSUE-2](./current-state.md#issue-2--fixture_player_status-table-missing-from-migrations)
  exists specifically because this rule was (apparently) broken at least once, and
  it's expensive to recover from: nobody can trust `supabase/migrations/` to reflect
  reality until it's fixed.
- **Every new table gets Row Level Security enabled and an explicit policy for each
  operation it needs**, before it ships — not "RLS later." Default to the least
  permissive policy that satisfies the actual requirement (see
  [database.md § Row Level Security summary](./database.md#row-level-security-summary)
  for the existing pattern of `is_pot_member`/`is_pot_admin`/`is_app_admin` helper
  functions — reuse these rather than inlining new equivalent logic).
- **New RLS policies that grant an insert/update based on a role the same insert is
  meant to create are circular and will fail** — this is exactly the bug in
  [ISSUE-1](./current-state.md#issue-1--pot-creation-likely-violates-its-own-rls-policy).
  When a "become the first admin of a thing you just created" flow is needed, either
  use a `security definer` RPC that performs both inserts atomically, or have an edge
  function do it with the service role — don't rely on RLS to authorize the very
  first row that would grant the authorization.
- **Edge functions are for what RLS can't do**: service-role-only writes, calls to
  external APIs with secrets that can't reach the browser, and cross-cutting jobs
  triggered by cron. They are not a place to duplicate logic that a normal
  RLS-gated client call could do directly.
- **Shared edge function logic goes in `_shared/`**, not copy-pasted into each
  function — CORS headers already follow this pattern (`_shared/cors.ts`); auth-header
  parsing and service-role client construction currently don't and should when
  touched (see [architecture.md § Backend structure](./architecture.md#backend-structure)).
- **Every edge function that accepts an authenticated request checks the caller's
  identity and authorization explicitly** — don't assume "it's called from a button
  behind a login screen" is enough; several existing functions have no auth check at
  all, tracked as part of
  [ISSUE-9](./current-state.md#issue-9--admin-has-no-ui-level-role-gate).

## SQL conventions

- snake_case identifiers, explicit foreign key constraints (not just a matching
  column name), `on delete cascade` where child rows have no meaning without their
  parent (matches the existing pattern throughout `001_initial_schema.sql`).
- Index every foreign key column that's queried directly, and any column used in a
  frequent `where`/`order by` (see the existing `idx_*` indexes for the pattern).
- Use a Postgres `enum` for any column with a small, closed set of valid values
  (matches `pot_status`, `gameweek_status`, `fixture_status`, etc.) rather than a
  free-text column with an application-level check — `fixture_events.event_type` is
  a deliberate exception (see [database.md § fixture_events](./database.md#fixture_events)
  for why an open value space was chosen there).
- `security definer` functions should do the minimum necessary and nothing else —
  every one of them is a deliberate RLS bypass and should be easy to audit in full by
  reading it once (the existing ones — `is_pot_member`, `is_pot_admin`,
  `create_entry_payment`, `handle_new_user` — are each a few lines for this reason).
- Triggers that derive a value should cover every operation that can invalidate it.
  `recompute_goal_thresholds()` only fires on `insert`/`delete`, not `update` — see
  [decisions.md § Duplicate-pick scoring model](./decisions.md#duplicate-pick-scoring-model-goal-thresholds-via-trigger)
  for why, and the trap this leaves for any future code that does an in-place
  `update` on `user_entry_picks.player_id`.
- A materialized view that anything relies on for correctness needs an owner for
  keeping it refreshed — a cron job, a trigger-driven refresh, or a documented manual
  process. A materialized view with no refresh path is a silent-staleness bug waiting
  to happen; see [ISSUE-3](./current-state.md#issue-3--player_fixture_goals-materialized-view-is-never-refreshed)
  for exactly that happening.

## Error handling

- Edge functions return a JSON body with an `error` key and an appropriate HTTP
  status (`400` for a bad request, `401`/`403` for auth failures, `500` for anything
  unexpected) — follow `admin-actions`' pattern
  ([api.md § admin-actions](./api.md#post-functionsv1admin-actions)), not a bare
  `throw` that surfaces a stack trace.
- Frontend errors that are meaningful to the user surface through the existing toast
  system (`useUiStore.addToast`), not `alert()`, not a silently swallowed promise
  rejection, and not a `console.error` with no user-visible feedback.
- Client-side checks that mirror a server-side rule (e.g. deadline checks, pick-count
  checks) are a UX nicety, not the enforcement mechanism — the enforcement is
  whatever RLS policy or edge-function check backs it up. Don't remove a client-side
  check without confirming the server-side equivalent actually exists; several places
  in this codebase currently have the client check but not a matching server-side one
  (see [database.md § pot_members](./database.md#pot_members) and
  [api.md](./api.md) for which edge functions currently skip auth checks).

## Logging

- No `console.log` left in shipped code, including "just for debugging" statements —
  `hooks/useAuth.js`'s `console.log('auth changed', ...email)` is the concrete
  example of what this rule exists to prevent
  ([current-state.md ISSUE-18](./current-state.md#issue-18--useauthjs-logs-the-signed-in-users-email-to-the-browser-console)):
  it logs a user's email to the console on every auth state change, which is exactly
  the kind of thing that's easy to add during development and easy to forget to
  remove.
- Backend job runs (syncs, scoring, settlement) log through the `sync_runs` table —
  `job_name`, `status`, `records_processed`, `errors` — not through `console.log`
  inside the edge function, which isn't queryable or visible to anyone after the
  function invocation ends. Any new scheduled job should write a `sync_runs` row the
  same way `sync-fixtures` and `compute-scores` already do.
- If a genuine need for structured application logging/monitoring arises (there's
  currently none beyond `sync_runs`), that's a decision worth recording in
  [decisions.md](./decisions.md) before adopting a tool, not something to bolt on
  function-by-function.

## Testing

There are currently no automated tests in this repository
([current-state.md ISSUE-16](./current-state.md#issue-16--no-automated-tests)) — that
is a gap to close, not the accepted standard. The standard:

- Pure functions (`utils/scoring.js`, `utils/format.js`, `utils/time.js`) get unit
  tests — they have no external dependencies and are the cheapest possible place to
  start.
- Edge functions get tests that cover at least: the happy path, the "not
  authenticated"/"not authorized" path where one exists, and one representative
  malformed-input case.
- Business-rule logic that lives in triggers or RLS policies (goal-threshold
  recomputation, deadline enforcement, payment voiding) should have at least one test
  that exercises it against a real (local) Postgres instance — a unit test that mocks
  Postgres cannot catch a policy or trigger bug like
  [ISSUE-1](./current-state.md#issue-1--pot-creation-likely-violates-its-own-rls-policy).
- A test that would have caught a bug in [current-state.md](./current-state.md)'s
  issue register is a good first test to write when picking up that issue.

## Security

- RLS is the default authorization boundary — see
  [architecture.md § Security model](./architecture.md#security-model). Any code path
  that bypasses it (an edge function using the service-role key) is a deliberate
  exception that re-implements authorization manually, and that re-implementation
  needs to actually happen, not be assumed — see
  [ISSUE-9](./current-state.md#issue-9--admin-has-no-ui-level-role-gate) for functions
  that currently skip this.
- Secrets never go in frontend code or a committed file outside `.gitignore` — see
  [current-state.md ISSUE-5](./current-state.md#issue-5--repository-has-no-git-history-secrets-arent-excluded-from-version-control)
  for the current, live version of this problem.
- New RLS policies should default to **owner-only** or **pot-member-only** access and
  widen deliberately, not default to `using (true)` for convenience during
  development and "tighten it later."
- Any endpoint (edge function or RPC) that accepts a `pot_id`, `user_id`, or similar
  identifier from the request body must verify the caller is actually authorized for
  that specific id — never trust an id in the request body as self-authorizing.

## Performance

- Prefer a database view or materialized view over fetching broad data into the
  client and filtering/aggregating there — `available_players_by_gameweek` and
  `player_fixture_goals` are the existing examples of this pattern.
- A materialized view used for anything time-sensitive (live scores, in this app)
  needs an explicit refresh cadence appropriate to how fresh it needs to be — see the
  Supabase conventions section above.
- TanStack Query's `staleTime`/`refetchInterval` should be set deliberately per query
  based on how often the underlying data actually changes (compare
  `hooks/useGameweek.js`'s `staleTime: 60_000` for slow-moving gameweek metadata
  against `hooks/useLeaderboard.js`'s `refetchInterval: 30_000` for a leaderboard —
  don't copy one query's timing onto an unrelated query without thinking about it).
- Avoid N+1 query patterns in edge functions — `compute-scores` currently loops over
  entries and picks with a query per pick; this is a known, accepted tradeoff for
  correctness/simplicity at current scale, not a pattern to copy into a new function
  without considering whether a single batched query would do.

## Documentation expectations

Documentation is the permanent memory of this project (`CLAUDE.md`). Practically,
that means:

- If you're adding a fact that's true **today but might not be true next month**
  (a bug, an unverified assumption, a half-built feature), it goes in
  [current-state.md](./current-state.md) as a new `ISSUE-N`, not scattered as a
  comment in code or a one-off mention in whatever doc you happen to be editing.
- If you're adding a fact that's **structurally true** (how a system is built, what a
  table means, what an endpoint does), it goes in the one document that owns that
  kind of fact — see [current-state.md § How these documents fit together](./current-state.md#how-these-documents-fit-together)
  for the map — and every other document links to it instead of restating it.
- Never state something as fact that you haven't verified by reading the actual code
  or schema. "This table probably has an `is_active` column" is not documentation;
  read the migration and confirm it, or say explicitly that it's unverified.
- When you fix an issue, move its entry to
  [current-state.md § Resolved issues](./current-state.md#resolved-issues) instead of
  deleting it, and add a [changelog.md](./changelog.md) entry.

## Code review expectations

Whether "review" means another engineer, a future session of yourself, or the
`/review` command:

- A change that touches an RLS policy, a trigger, or an edge function's auth check
  gets extra scrutiny by default — these are exactly the categories that have
  produced real bugs in this codebase already (ISSUE-1, ISSUE-9).
- A change to one of the two currently-duplicated pick-eligibility implementations
  (`PicksPage` vs. `PotDetail.jsx`) should either fix both or explicitly note that
  it's deliberately only touching one, so the divergence in
  [ISSUE-7](./current-state.md#issue-7--two-pick-building-flows-enforce-different-eligibility-rules)
  doesn't get worse by accident.
- A new dependency, a new external API integration, or a new standalone script
  outside the main app (like the existing `frontend/scripts/*` sync tools) is worth a
  [decisions.md](./decisions.md) entry explaining why, so a future reader isn't left
  reverse-engineering the reasoning the way this handbook had to for the three
  pre-existing, mostly-unused football data providers (see
  [architecture.md § Three football data providers](./architecture.md#three-football-data-providers)).
- "It works on my machine" is not sufficient for anything touching RLS — RLS bugs are
  specifically the kind of thing that pass a naive manual test (the developer is
  often testing as an app admin, or with the service role, without realizing it) and
  fail for a real, unprivileged user. See
  [ISSUE-1](./current-state.md#issue-1--pot-creation-likely-violates-its-own-rls-policy)
  for exactly this shape of bug.
