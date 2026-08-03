# Architecture

Last reviewed: 2026-08-03.

This document describes **how the system is structured** — stack, request flow,
directory layout, security model. It changes rarely: only when the structure itself
changes, not when a bug is found in it. For "is this actually working correctly right
now," see [current-state.md](./current-state.md), which is linked throughout this
document by `ISSUE-N` id wherever a structural characteristic described here has a
known, currently-open consequence.

See also: [database.md](./database.md) (schema reference), [api.md](./api.md)
(edge function and external API contracts), [features.md](./features.md) (what's
actually reachable in the product), [decisions.md](./decisions.md) (why these
choices were made).

## What this system is

PL Goals is a private "goals pot" prediction game. Members of a private group (a "pot")
each pick 5 players before a gameweek deadline; if a picked player scores at least as
many goals in that gameweek as the number of times the member picked them (picking the
same player twice raises their threshold to 2 goals, etc.), the pick wins. Pots track a
leaderboard per gameweek and, by design, an overall season leaderboard too (though the
overall leaderboard is currently never populated — ISSUE-15).

The current data source is the Premier League (see `supabase/seed/seed_season.sql`),
but the schema and edge functions are written generically against "leagues/seasons,"
and there is evidence in `frontend/scripts/` of earlier/parallel work targeting the
2026 World Cup — see [decisions.md](./decisions.md#apparent-drift-not-a-decision-two-parallel-data-fetching-patterns)
for what that suggests about the codebase's history. Treat "Premier League" as the
current configuration, not a hard assumption baked into the schema.

## Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | React 18 + Vite 5 | SPA, client-side routing via `react-router-dom` v6 |
| Styling | Tailwind CSS 3 | Custom "pitch/surface/accent" dark theme, see `frontend/tailwind.config.js` |
| Server state | TanStack Query v5 | Used by most, not all, hooks — see [Two competing data-fetching patterns](#two-competing-data-fetching-patterns) |
| Client/UI state | Zustand v4 | `authStore.js` (session/profile), `uiStore.js` (toasts, drawer) |
| Backend | Supabase (hosted Postgres + Auth + Edge Functions + `pg_cron`) | No separate backend server — the browser talks to Supabase directly |
| Edge functions | Deno, `supabase/functions/*` | Privileged operations that can't run under the anon key + RLS |
| Scheduled jobs | `pg_cron` + `pg_net`, defined in `supabase/migrations/003_cron_jobs.sql` | Calls edge functions over HTTP on a schedule |
| External data | api-football (v3.football.api-sports.io), football-data.org v4, WhoScored.com (scraped) | Three separate, only partially-integrated providers — see [Three football data providers](#three-football-data-providers) |

## Request flow

There is no application server. Two request paths exist:

1. **Direct-to-Postgres via PostgREST** (the normal path). The browser holds a Supabase
   anon key (`VITE_SUPABASE_ANON_KEY`) and calls `supabase.from('table').select/insert/
   update/delete(...)` directly. Every table has Row Level Security enabled
   (`supabase/migrations/002_rls_policies.sql`), so authorization is enforced in
   Postgres, not in application code. This is how all of pots, picks, entries, profiles,
   and leaderboards are read and written today.

2. **Edge functions** (`supabase/functions/*`), invoked either by the frontend via
   `fetch(.../functions/v1/<name>)` with the user's JWT forwarded, or by `pg_cron` on a
   schedule with the service-role key. Edge functions run with the **service role key**
   (bypasses RLS entirely) and are where admin-only or system-only writes happen:
   marking payments, settling gameweeks, computing scores, pulling fixtures from
   api-football. Full endpoint-by-endpoint contract: [api.md](./api.md).

```
Browser (anon key, RLS-enforced)
  │
  ├─▶ Supabase PostgREST  ───▶  Postgres (public schema, RLS on every table)
  │
  └─▶ Edge Functions (fetch, JWT forwarded) ─▶ service-role client ─▶ Postgres (RLS bypassed)
                                              └─▶ api-football.com (sync-fixtures only)

pg_cron (Postgres, on schedule) ─▶ net.http_post ─▶ Edge Functions (service-role key)
```

Realtime updates (live scores while matches are in progress) go through Supabase
Realtime's `postgres_changes` channel — see `frontend/src/hooks/useLiveScores.js`,
which subscribes to `fixtures`, `fixture_events`, `fixture_player_status`, and
`user_entry_picks` and invalidates the relevant React Query caches on change, rather
than pushing data through the channel payload itself. (`fixture_player_status` is one
of the tables affected by ISSUE-2 — its existence in the live database is unverified.)

## Frontend structure

```
frontend/src/
  App.jsx              route table + ProtectedRoute wrapper (redirects to /sign-in if unauthenticated)
  main.jsx             React root, QueryClientProvider
  pages/                one component per route (Dashboard, PotDetail, GameweekPage, PicksPage, AdminDashboard, Profile, Landing, NotFound, auth/*)
  components/
    layout/             AppShell (top nav + bottom nav + outlet), TopNav, BottomNav
    ui/                 design-system primitives (Button, Card, Badge, Modal, Drawer, Toast, Spinner, Skeleton, CountdownTimer, EmptyState, Avatar)
    picks/               PickSelector, PickSlip, PickSlot, PlayerSearch, LivePickCard — the pick-building UI used by PicksPage
    pot/                 potManager.jsx (pot creation + listing, routed at /pots)
    admin/               SyncLog (wired up), MemberTable + PaymentTable (not wired up — ISSUE-6)
    entryBuilder.jsx     an alternate, unrouted pick-builder component — dead code, ISSUE-11
  hooks/                 one file per domain, mostly thin TanStack Query wrappers over supabase-js
  lib/                   supabase client, queryClient config, and three parallel "provider" modules (see below)
  store/                 zustand stores (auth, ui)
  utils/                 pure helpers (format.js, scoring.js, time.js)
```

For what each route/page actually does from a product perspective, see
[features.md](./features.md).

### Two competing data-fetching patterns

Most pages (`Dashboard`, `PicksPage`, `GameweekPage`, `AdminDashboard`) go through the
`hooks/use*.js` layer: TanStack Query hooks that wrap `supabase-js` calls, get caching,
retries, and cache invalidation via `queryClient`.

`pages/PotDetail.jsx` and `components/pot/potManager.jsx` do **not** use this layer.
They re-implement the same reads/writes (loading a pot, its members, gameweeks,
available players, entries, saving picks, creating a pot) with local `useState` +
`useEffect` + direct `supabase.from(...)` calls, duplicating logic that already exists
in `hooks/usePots.js` and `hooks/useEntry.js`. This is the single largest structural
inconsistency in the frontend. For the likely origin of the split and the
consequences it's already produced (rules implemented twice, once each way, that have
since diverged), see [current-state.md ISSUE-10](./current-state.md#issue-10--duplicated-data-fetching-pattern)
and [decisions.md](./decisions.md#apparent-drift-not-a-decision-two-parallel-data-fetching-patterns).

### Three football data providers

The app has three independent integrations with football data providers, at different
levels of completion and wired into different parts of the system:

1. **api-football (v3.football.api-sports.io)** — used by `supabase/functions/
   sync-fixtures/index.ts`, the only edge function that talks to an external API. This
   is the **active** pipeline: it's on the `sync-fixtures-daily` cron job and pulls
   leagues, teams, squads, and fixtures into Postgres. Contract detail:
   [api.md § sync-fixtures](./api.md#post-functionsv1sync-fixtures).
2. **football-data.org v4** — implemented in `frontend/src/lib/footballDataProvider.js`
   and in three standalone Node scripts (`frontend/scripts/fullSyncInsert.js`,
   `fullSyncPlayers.js`, `syncFootballData.js`), each with slightly different upsert
   logic. None of these are wired into the running app or cron — see
   [current-state.md ISSUE-12](./current-state.md#issue-12--overlapping-unused-football-dataorg-sync-scripts).
3. **WhoScored.com (scraped via Playwright, no official API)** — five scripts in
   `frontend/scripts/` (`ws-live-events.js`, `sync-whoscored-fixture-map.js`,
   `sync-whoscored-player-map.js`, `sync-whoscored-teamids.js`, and logic duplicated
   into `frontend/src/lib/whoScored.js`, which is misplaced — it's a Node/Playwright
   script, not browser code, sitting inside `src/lib` where Vite would try to bundle
   it if anything imported it; nothing currently does). These scripts scrape
   WhoScored's match centre JSON for goals/cards/substitutions and appearance status,
   and write to columns/tables that aren't in the versioned migrations — see
   [database.md § Schema drift](./database.md#schema-drift). This strongly suggests
   live-event ingestion is currently a manually-run local process, not an automated
   pipeline, despite cron and the admin UI both expecting an edge function called
   `sync-live-events` that doesn't exist in the repo
   ([current-state.md ISSUE-4](./current-state.md#issue-4--sync-live-events-edge-function-is-referenced-but-doesnt-exist)).

Scraping a third-party site for live match data (option 3) carries real maintenance
risk (their markup can change without notice) and possible Terms-of-Service exposure;
whether this is meant to be permanent or a stop-gap is an open product decision — see
[roadmap.md § P0 item 4](./roadmap.md#p0--verify-or-fix-before-building-further-on-potsscoring).

## Backend structure

```
supabase/
  migrations/            001_initial_schema.sql, 002_rls_policies.sql, 003_cron_jobs.sql
  functions/
    _shared/cors.ts       shared permissive CORS headers
    admin-actions/        pot-admin actions: mark_paid, mark_unpaid, add_member, remove_member
    compute-deadlines/    recomputes gameweek deadline_utc from earliest fixture kickoff
    compute-scores/       recomputes pick results while a gameweek is live/upcoming
    settle-gameweek/      finalizes a gameweek once all its fixtures are finished, writes leaderboard_snapshots
    sync-fixtures/        pulls leagues/teams/squads/fixtures from api-football
  seed/seed_season.sql    seeds current season + Premier League as the active league
  config.toml             local Supabase CLI config (Postgres 17, local ports, no pooler)
```

Every edge function is a single `Deno.serve` handler in `index.ts` — there's no shared
routing framework, and cross-cutting concerns (CORS, auth-header parsing, service-role
client construction) are copy-pasted into each function rather than factored into
`_shared/`. Full behavioral contract for each function: [api.md](./api.md).

## Security model

- **RLS is the authorization layer.** Every table has RLS enabled; policies are defined
  in `002_rls_policies.sql` using two `security definer` helper functions,
  `is_pot_member(pot_id)` and `is_pot_admin(pot_id)`, plus a JWT-claim check
  `is_app_admin()` (`auth.jwt() -> 'app_metadata' ->> 'role' = 'app_admin'`). Full
  policy-by-policy table: [database.md § Row Level Security summary](./database.md#row-level-security-summary).
- **Edge functions bypass RLS** by using the service-role key, then re-implement
  authorization manually where they do it at all (e.g. `admin-actions` checks
  `pot_members.role` and `app_metadata.role` itself before acting; several other edge
  functions have no auth check — see [api.md](./api.md) for which).
- **Reference data** (seasons, leagues, teams, players, gameweeks, fixtures,
  fixture_events) is readable by any authenticated user — there's no per-pot
  partitioning of football data, only of pots/entries/picks.
- A new `auth.users` row automatically creates a `public.profiles` row via the
  `handle_new_user()` trigger, seeding `username`/`display_name` from
  `raw_user_meta_data` or falling back to `user_<id prefix>` / the user's email.
- **Structural note on `pot_members` inserts:** the policy that allows inserting a new
  `pot_members` row requires the inserting user to already be an admin of that pot (or
  an app admin). For a brand-new pot with no members yet, that check cannot pass for
  anyone except an app admin — see the exact policy text in
  [database.md § Row Level Security summary](./database.md#row-level-security-summary).
  This is a description of the policy as written, not a claim about what happens in
  production today; for that, see
  [current-state.md ISSUE-1](./current-state.md#issue-1--pot-creation-likely-violates-its-own-rls-policy).

## Environment configuration

Two `.env` files exist and serve different purposes:

- `frontend/.env.local` — used by the Vite dev server (`import.meta.env.VITE_*`) and
  by the Node scripts in `frontend/scripts/` (via `dotenv.config({ path:
  '.env.local' })`, resolved relative to the `frontend/` working directory those
  scripts are run from). Correctly excluded via `frontend/.gitignore`.
- `.env` at the repo root — contains the same keys as `frontend/.env.local` (Supabase
  URL/anon key/service-role key, football-data.org key, competition code/season).
  Nothing in the repo appears to read it — see
  [current-state.md ISSUE-13](./current-state.md#issue-13--duplicate-env-files) for
  the consolidation recommendation, and
  [current-state.md ISSUE-5](./current-state.md#issue-5--repository-has-no-git-history-secrets-arent-excluded-from-version-control)
  for why this file's presence at the repo root was a live risk, not just clutter, and
  how that risk was remediated (the root `.gitignore` now excludes it).
