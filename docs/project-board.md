# Project Board

Last reviewed: 2026-08-05.

This is the **active work tracker** — a Kanban view of what's queued, in progress,
blocked, or done. It's derived from, and must stay consistent with,
[roadmap.md](./roadmap.md) (the plan) and [current-state.md](./current-state.md)'s
issue register (the facts). `/checkpoint` is responsible for keeping this file
current every session: moving cards between columns, adding cards for newly
discovered issues, and archiving completed ones into [Done](#done) rather than
deleting them.

**Every card references an `ISSUE-N` id** where one exists, linking to
[current-state.md](./current-state.md) for full detail — this board only carries a
one-line summary and a column. Net-new feature work with no corresponding bug/gap
(nothing is "wrong," it just doesn't exist yet) doesn't get an `ISSUE-N` — see
[roadmap.md](./roadmap.md) items 19–20 for why that distinction is kept.

Column meanings:

| Column | Meaning |
|---|---|
| **Backlog** | Known and prioritized, but not next up |
| **Ready** | Unblocked, scoped, actionable right now |
| **In Progress** | Actively being worked this session |
| **Blocked** | Can't proceed without something external (usually: live Supabase access) |
| **Testing** | Implementation done, being verified |
| **Done** | Complete — kept here as a record, not deleted when superseded |

See also: [roadmap.md](./roadmap.md) (why things are prioritized this way),
[current-state.md](./current-state.md) (the issue register these cards point to).

## Backlog

- **Payment Verification (single-entry + CSV bulk import)** — `ISSUE-6` (P1, **now live and reachable, not just theoretical** — see [current-state.md](./current-state.md#issue-6--payment-verification-has-no-ui-or-bulk-import-compute-scoressettle-will-void-every-entry)). No payment gateway, ever — see [decisions.md § Payment Verification, not payment processing](./decisions.md#payment-verification-not-payment-processing). Scope now expands beyond Pick 5 — see [game-engine.md § GE-4.3/GE-4.4](./game-engine.md#ge-43-entry_payments-generalized). Since the Pick 5 frontend cutover (2026-08-05), this is the single biggest thing standing between a real pot and a working payment flow — every entry voids without it.
- **Reconcile the two pick-building flows** — `ISSUE-7` (P1) → [current-state.md](./current-state.md#issue-7--two-pick-building-flows-enforce-different-eligibility-rules). Correctness resolved 2026-08-05 (both flows now enforce the same server-side rule via `submit-pick5-picks`); the remaining UI-list inconsistency (`PicksPage.jsx` doesn't filter goalkeepers from its player list) is now cosmetic only.
- **Finish or remove invite-code join flow** — `ISSUE-8` (P1) → [current-state.md](./current-state.md#issue-8--no-self-serve-pot-join-flow). Redemption RPC (`redeem_invite()`) is drafted in `004_game_engine_shared_platform.sql`, deliberately missing `max_members`/`status` checks until Milestone 7 gives it a UI caller.
- **Gate `/admin` behind a role check** — `ISSUE-9` (P1) → [current-state.md](./current-state.md#issue-9--admin-has-no-ui-level-role-gate). Production audit (2026-08-05) additionally found `compute-deadlines`/`compute-scores`/`settle-gameweek` have no server-side auth check at all — broader than this issue's original UI-gate framing; consider splitting into its own tracked issue.
- **Standardize on one data-fetching pattern** — `ISSUE-10` (P2) → [current-state.md](./current-state.md#issue-10--duplicated-data-fetching-pattern). `PotDetail.jsx` still uses its own imperative fetch style, not TanStack Query hooks — deliberately not converted during the Pick 5 frontend cutover (2026-08-05), since that's this issue's concern, not a schema dependency.
- **Delete or finish dead code** (`entryBuilder.jsx`, `gameAPI.js`, `footballDataProvider.js`, `whoScored.js`) — `ISSUE-11` (P2) → [current-state.md](./current-state.md#issue-11--dead-code-including-a-latent-case-sensitivity-import-bug)
- **Consolidate football-data.org sync scripts** — `ISSUE-12` (P2) → [current-state.md](./current-state.md#issue-12--overlapping-unused-football-dataorg-sync-scripts)
- **Resolve duplicate `.env` files** — `ISSUE-13` (P2) → [current-state.md](./current-state.md#issue-13--duplicate-env-files)
- **Remove debug `console.log` in `useAuth.js`** — `ISSUE-18` (P2) → [current-state.md](./current-state.md#issue-18--useauthjs-logs-the-signed-in-users-email-to-the-browser-console)
- **Automated tests** — `ISSUE-16` (P3) → [current-state.md](./current-state.md#issue-16--no-automated-tests). Partially addressed for new code going forward: the Game Engine framework has its own Deno test suite (Milestone 3); the original frontend/edge-function code this issue describes is still untested.
- **Notification delivery** (email/push/SMS beyond the in-app inbox; deadline reminders) — no issue id, net-new feature → the in-app domain-event write is implemented (`Pick5Engine.notifyUsers()`, Milestone 4 Slice 9, [game-engine.md § GE-4.8](./game-engine.md#ge-48-notifications)); an actual delivery mechanism beyond that is still undesigned, deferred to Milestone 7 — see [decisions.md § Notifications](./decisions.md#notifications-domain-events-not-delivery).
- **Avatar upload** — no issue id, net-new feature → [roadmap.md § P3](./roadmap.md#p3--known-product-gaps-unbuilt-not-broken)

## Ready

*(nothing ready — the Pick 5 frontend cutover is implemented and verified, awaiting review/approval before Milestone 5 (LMS) begins)*

## In Progress

*(nothing in progress — the Pick 5 frontend cutover is implemented and verified, awaiting review/approval before Milestone 5 (LMS) begins)*

## Blocked

- **ISSUE-24 — undocumented SQL trigger overwrites `gameweeks.deadline_utc` with a conflicting 15-minute offset** → [current-state.md](./current-state.md#issue-24--an-undocumented-sql-trigger-recomputes-gameweeksdeadline_utc-with-a-conflicting-incorrect-offset). Discovered 2026-08-05, live-confirmed via direct reproduction. `supabase_admin`-owned, not in any migration — same out-of-band pattern as ISSUE-1/ISSUE-21. Blocked on: a decision on which offset (15 min or the documented 30 min) is actually correct before either removing the trigger or changing `compute-deadlines` to match.
- **ISSUE-20 — prototype tables have RLS disabled and full anonymous write access** → [current-state.md](./current-state.md#issue-20--prototype-tables-have-rls-disabled-and-full-anonymous-write-access). Narrowed 2026-08-03 — the new schema ships fully RLS-protected; the 7 original prototype tables remain exposed. Blocked on: Phase 8 of `deployment-checklist.md` (final removal), or a Dashboard/support RLS fix on the old tables directly.
- **`sync-live-events-every-5-min` cron job removal** — `supabase_admin`-owned, `postgres` cannot unschedule it. Low severity (no data/security impact). Folded into Track B/Phase 8 scope, not tracked separately.
- **Verify what (if anything) refreshes `player_fixture_goals`** — `ISSUE-3` (P0) → [current-state.md](./current-state.md#issue-3--player_fixture_goals-materialized-view-is-never-refreshed).
  Live-verified as never refreshed; moot in practice until ISSUE-19 is fixed (nothing reaches it to refresh).
- **Decide the live-events ingestion story** — `ISSUE-4` (P0) → [current-state.md](./current-state.md#issue-4--sync-live-events-edge-function-is-referenced-but-doesnt-exist).
  Blocked on: a product decision (rebuild `sync-live-events` on api-football vs. formalize the WhoScored scraper), separate from the ISSUE-19 config fix both cron variants also need.

## Testing

- **Pick 5 frontend cutover** → [current-state.md](./current-state.md#repository-snapshot). Replaced every remaining frontend interaction with the retired prototype schema (`user_entries`/`user_entry_picks`/`leaderboard_snapshots`) with the Game Engine schema (`game_entries`/`pick5_picks`/`pot_standings_snapshots`) via `get-or-create-pick5-entry`/`submit-pick5-picks`. Migrated: `hooks/useEntry.js`, `hooks/useLiveScores.js`, `hooks/useLeaderboard.js`, `hooks/usePick5Entry.js` (fixed, wired in for the first time), `pages/PicksPage.jsx`, `pages/PotDetail.jsx` (the actual reachable pick-building flow), `pages/GameweekPage.jsx` (gained a new Standings section — no prior page rendered `pot_standings_snapshots` at all), `components/leaderboard/LeaderboardCard.jsx`/`LeaderboardTable.jsx`. Found and fixed `ISSUE-25` (`supabase.functions.invoke()` error messages were being swallowed — generic message shown instead of `Pick5Engine.validateEntry()`'s real rejection reason) along the way, via a new shared `extractFunctionError()` helper in `lib/supabase.js`. Verified live, end-to-end, through the real browser UI (Playwright): create entry, submit picks, edit picks, locking (including the corrected rejection message), score calculation, settlement (including the payment-void rule via a real `admin-actions` call), standings, prize awarding with fee deductions, notification creation, and settlement idempotency. All test data removed by exact ID; all fixture/gameweek state reverted. **Not yet committed** — awaiting review/approval (see `session-log.md`).

## Done

- **Milestone 4, Slice 9 — Notifications (domain events)** — 2026-08-05, committed and pushed. `Pick5Engine.notifyUsers()` (the eighth and final real Game Engine contract implementation for Pick 5 — all eight `GameEngine` methods implemented). A pure domain-event emitter, inserting one row into `notifications`, called from within `awardPrize()` once per winner — see [decisions.md § Notifications: domain events, not delivery](./decisions.md#notifications-domain-events-not-delivery). 7 new Deno unit tests (59/59 in file, 87/87 total pass at the time). See [session-log.md](./session-log.md).
- **Pick 5 production readiness audit** — 2026-08-05, reviewed, approved, committed. Investigation-only (no code changed) — full findings across Game Engine, database, Edge Functions, migrations, documentation, security, open issues, and technical debt. Identified the frontend-cutover gap (below) as the top Critical finding. See [session-log.md](./session-log.md).
- **Milestone 4, Slice 8 — Prize awarding + prize pool deductions** — 2026-08-05, committed and pushed. `Pick5Engine.awardPrize()` (the seventh real Game Engine contract implementation) — wired into `settle()` alongside `determineWinner()` (Slice 7), so a single `settle-gameweek` invocation settles, ranks, and pays out in one pass. `pot_prizes` rows created lazily inside `awardPrize()`, keyed by real `id` (never a partial-index `upsert`, per the Slice 6 `pot_standings_snapshots` precedent). **Prize pool deductions** feature (Admin Fee, Charity Fee — see [decisions.md § Prize pool deductions](./decisions.md#prize-pool-deductions-admin-fee-and-charity-fee)) applied via migration `010_prize_pool_deductions.sql`. The Game Engine only ever distributes `net_amount`, never `gross_amount`. Resolves no `ISSUE-N` (net-new Game Engine build-out plus a net-new product feature). 11 new Deno unit tests (53/53 in file, 81/81 total pass at the time). Verified live end-to-end. See [session-log.md](./session-log.md).
- **Milestone 4, Slice 7 — Winner determination** — 2026-08-05, committed and pushed. `Pick5Engine.determineWinner()` (the sixth real Game Engine contract implementation) — identifies the rank-1 user(s) of a pot's most recently settled gameweek, correctly returning multiple winners on a tie (Slice 6's shared-rank rule). Implemented standalone at the time; wired into `settle()` in Slice 8 alongside `awardPrize()`. Resolves no `ISSUE-N` (net-new Game Engine build-out). 6 new Deno unit tests (71/71 total pass at the time). Verified live against the real database. See [session-log.md](./session-log.md).
- **Milestone 4, Slice 6 — Standings** — 2026-08-05, committed. `Pick5Engine.generateStandings()`, called internally from `settle()`. Resolved `ISSUE-15`/`ISSUE-17`. See [session-log.md](./session-log.md).
- **Milestone 4, Slice 5 — Settlement** — 2026-08-05, committed. `Pick5Engine.settle()` wired into `settle-gameweek` via the dispatcher — implements the payment-void rule deferred from Slice 4. See [session-log.md](./session-log.md).
- **Milestone 4, Slices 3-4 — Locking and scoring** — 2026-08-05, committed (`be06bbd`). `Pick5Engine.lockEntries()`/`calculateScore()` wired into `compute-deadlines`/`compute-scores`. See [session-log.md](./session-log.md).
- **Milestone 4, Slice 2 — Pick submission** — 2026-08-04. `submit-pick5-picks` Edge Function + `Pick5Engine.validateEntry()` (the first real Game Engine contract implementation) + `pick5_picks` table (`007`) + `available_players_by_gameweek` fix (`008`, `ISSUE-23`). See [session-log.md](./session-log.md).
- **ISSUE-22 resolved — Edge Runtime JWT verification fixed by CLI/Edge Runtime upgrade** — 2026-08-04. CLI `2.75.0`→`2.111.0`, Edge Runtime `v1.70.0`→`v1.74.2`. Re-verified from scratch with a brand-new user via real `supabase.functions.invoke()` calls: `admin-actions` now `403` (correctly authorized-but-denied, not rejected), `get-or-create-pick5-entry` now genuine `200` success. See [current-state.md](./current-state.md#issue-22--edge-runtimes-default-jwt-verification-rejected-gotrues-es256-tokens-no-authenticated-edge-function-call-worked-locally) and [session-log.md](./session-log.md).
- **Milestone 4, Slice 1 — Pick 5 entry creation** — 2026-08-03. `get-or-create-pick5-entry` Edge Function, `hooks/usePick5Entry.js`. Database-layer logic verified directly at creation time; HTTP/auth-layer end-to-end path now also confirmed live 2026-08-04 following the `ISSUE-22` fix above. See [session-log.md](./session-log.md).
- **Shared platform schema deployed: `004`/`005` applied, ISSUE-21 resolved for the 2 blocking objects, ISSUE-20 narrowed to only the un-migrated prototype tables, `006` (cron header fix) applied** — 2026-08-03. See [session-log.md](./session-log.md#2026-08-03-7--track-b-resolved-shared-platform-schema-deployed). Fully verified live: 7 tables, 14 FKs, 21 indexes, 5 triggers, 10 RLS policies, zero data loss on any existing table.
- **Milestones 1–3: three-game-mode platform architecture, shared schema design, Game Engine framework** — 2026-08-03. No single `ISSUE-N` (this is the strategic rebuild superseding the retired LMS/Predictor prototype). See [game-engine.md](./game-engine.md), [schema-review.md](./schema-review.md), [session-log.md](./session-log.md#2026-08-03-5--live-evidence-priority-review-drift-investigation-and-the-start-of-a-three-game-mode-platform-rebuild). Framework verified by the repo owner running the Deno test suite locally.
- **Live-evidence drift investigation: `/drift` command created; ISSUE-19/20/21 discovered and logged; ISSUE-1/2/3/4 verified against the live database** — 2026-08-03. See [session-log.md](./session-log.md#2026-08-03-5--live-evidence-priority-review-drift-investigation-and-the-start-of-a-three-game-mode-platform-rebuild).
- **Repository hygiene remediation: secrets and Chrome-profile data removed from git tracking, comprehensive `.gitignore` added, `.env.example` created** — `ISSUE-5`, `ISSUE-14` (both P0/P2) → [current-state.md § Resolved issues](./current-state.md#resolved-issues). 2026-08-03. See [session-log.md](./session-log.md).
- **Documentation restructure: issue register, cross-references, doc ownership map** — 2026-08-03. No `ISSUE-N` (this was the documentation work that created the issue-tracking system itself). See [session-log.md](./session-log.md#2026-08-03-2--documentation-restructure-remove-duplication-add-cross-references).
- **Initial documentation pass: `docs/` created from a full codebase audit** — 2026-08-03. No `ISSUE-N`. See [session-log.md](./session-log.md#2026-08-03-1--initial-documentation-pass).
- **Project management layer: `project-board.md`, `business-rules.md`, `engineering-principles.md` created; `/checkpoint` upgraded; `/preflight` added; `ISSUE-17` and `ISSUE-18` discovered and logged** — 2026-08-03. No single `ISSUE-N` (infrastructure work). See [session-log.md](./session-log.md) for this session's entry.
