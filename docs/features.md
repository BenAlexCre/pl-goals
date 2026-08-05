# Features

Last reviewed: 2026-08-03. This is an inventory of what the product actually does,
judged from what's wired into a route in `App.jsx` and reachable through the UI — not
from what components merely exist in the source tree.

This document changes whenever a feature ships, is removed, or is discovered to be
unwired — more often than architecture/database/api, less often than
[current-state.md](./current-state.md). Where a feature has an open bug or gap, this
document names it and points to the `ISSUE-N` entry in
[current-state.md](./current-state.md) that owns the full detail (evidence,
verification status, fix plan) rather than re-explaining it here.

See also: [architecture.md](./architecture.md) (how these pages/routes are built),
[roadmap.md](./roadmap.md) (what's planned to close the gaps below).

## Implemented and reachable

### Authentication
- Sign up, sign in, forgot password (`pages/auth/{SignUp,SignIn,ForgotPassword}.jsx`)
  via Supabase Auth (email/password). `SignIn.jsx` redirects to `/dashboard` if a
  session already exists.
- Session state lives in `store/authStore.js`, hydrated by `hooks/useAuth.js`, which
  also loads the matching `profiles` row via React Query.
- Route protection: `App.jsx`'s `ProtectedRoute` wrapper redirects unauthenticated
  users to `/sign-in` for every route except `/`, `/sign-in`, `/sign-up`,
  `/forgot-password`.
- New-user bootstrap: a Postgres trigger (`handle_new_user`) creates the `profiles`
  row automatically on signup — no explicit "complete your profile" step in the UI
  beyond editing it later on `/profile`.

### Landing page (`/`)
Static marketing page describing the four core rules (private pots, 30-minute
deadline lock, duplicate-pick thresholds, unpaid entries excluded from scoring).

### Dashboard (`/dashboard`)
Lists the current user's active pots (`usePots`) and shows the current gameweek with
a live countdown to its deadline (`CountdownTimer`, `useCurrentGameweek`).

### Pot creation & listing (`/pots`, `components/pot/potManager.jsx`)
Create a pot (name + league/tournament — season is inherited from the league's
`season_id`), automatically joining the creator as `admin`. Lists all pots the user
belongs to via `pot_members`. Pot creation may currently fail for non-admin users —
[current-state.md ISSUE-1](./current-state.md#issue-1--pot-creation-likely-violates-its-own-rls-policy).
This page also doesn't use the `usePots`/`useCreatePot` hooks that exist for this
exact purpose, re-implementing the same logic locally —
[current-state.md ISSUE-10](./current-state.md#issue-10--duplicated-data-fetching-pattern).

### Pot detail (`/pot/:potId`, `pages/PotDetail.jsx`)
The most feature-dense page: shows pot metadata, a gameweek selector, a searchable/
filterable player picker (search, position, team; goalkeepers excluded by an inline
rule specific to this page — [current-state.md ISSUE-7](./current-state.md#issue-7--two-pick-building-flows-enforce-different-eligibility-rules)),
builds a 5-pick entry, saves it, and shows a "Members" tab listing every member's
submission status — with picks hidden until the gameweek deadline has passed
(`deadlineClosed` check), then revealed.

### Picks page (`/pot/:potId/picks`, `pages/PicksPage.jsx` + `components/picks/*`)
A second, parallel pick-building UI, driven by the `hooks/useEntry.js` +
`hooks/usePlayers.js` React Query hooks and the `PickSelector`/`PickSlip`/`PickSlot`/
`PlayerSearch` components. Enforces "exactly 5 picks", deadline lock, and validates
picked players are actually eligible (`available_players_by_gameweek`) at submit time
via a server round-trip. Unlike `PotDetail`'s picker, does not exclude goalkeepers —
see the cross-reference above.

### Gameweek page (`/pot/:potId/gameweek/:gameweekId`, `pages/GameweekPage.jsx`)
Shows all fixtures in the gameweek with live score, minute, goal/card event timeline,
and every pot member's entry with each pick's live result and player appearance
status (starting/bench/subbed), refreshed in real time via
`hooks/useLiveScores.js`'s Supabase Realtime subscription. This page depends on the
`fixture_player_status` table — [current-state.md ISSUE-2](./current-state.md#issue-2--fixture_player_status-table-missing-from-migrations).

### Admin dashboard (`/admin`, `pages/AdminDashboard.jsx`)
Buttons to manually trigger `sync-fixtures`, `sync-live-events` (endpoint doesn't
exist — [current-state.md ISSUE-4](./current-state.md#issue-4--sync-live-events-edge-function-is-referenced-but-doesnt-exist)),
`compute-scores`, `settle-gameweek`, plus a live-refreshing table of the last 50
`sync_runs` (`components/admin/SyncLog.jsx`). The route itself has no role check in
the UI — [current-state.md ISSUE-9](./current-state.md#issue-9--admin-has-no-ui-level-role-gate).

### Profile (`/profile`)
Edit `display_name`, `username`, `timezone`. No password-change or avatar-upload UI
despite `profiles.avatar_url` existing in the schema.

## Built but not reachable (dead code / unwired UI)

- **`components/entryBuilder.jsx`**, **`lib/gameAPI.js`**,
  **`lib/footballDataProvider.js`**, **`lib/whoScored.js`** — no importers anywhere in
  the reachable app; `entryBuilder.jsx` additionally has a broken, case-sensitive
  import. Full detail: [current-state.md ISSUE-11](./current-state.md#issue-11--dead-code-including-a-latent-case-sensitivity-import-bug).
- **`components/admin/MemberTable.jsx`** and **`PaymentTable.jsx`** — presentational
  components matching the `admin-actions` edge function's `mark_paid`/`mark_unpaid`/
  `add_member`/`remove_member` actions, never imported by any page. Consequence:
  [current-state.md ISSUE-6](./current-state.md#issue-6--payment-verification-has-no-ui-or-bulk-import-compute-scoressettle-will-void-every-entry).
- **`pots.invite_code`** — column exists, nothing generates, displays, or redeems it.
  [current-state.md ISSUE-8](./current-state.md#issue-8--no-self-serve-pot-join-flow).

## Not implemented

- Overall (season-long, cross-gameweek) leaderboard —
  [current-state.md ISSUE-15](./current-state.md#issue-15--overall-cross-gameweek-leaderboard-is-never-populated).
- Any password reset flow beyond the `ForgotPassword` page's presumed Supabase email
  trigger (not verified against Supabase project config).
- Avatar upload / image storage (no Supabase Storage bucket configured in the repo).
- Any notification system (email/push) for deadline reminders, results, etc.
- Automated tests of any kind —
  [current-state.md ISSUE-16](./current-state.md#issue-16--no-automated-tests).
