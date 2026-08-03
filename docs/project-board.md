# Project Board

Last reviewed: 2026-08-03.

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

- **Payments UI** — `ISSUE-6` (P1) → [current-state.md](./current-state.md#issue-6--payments-ui-isnt-wired-up-compute-scores-will-void-every-entry)
- **Reconcile the two pick-building flows** — `ISSUE-7` (P1) → [current-state.md](./current-state.md#issue-7--two-pick-building-flows-enforce-different-eligibility-rules)
- **Finish or remove invite-code join flow** — `ISSUE-8` (P1) → [current-state.md](./current-state.md#issue-8--no-self-serve-pot-join-flow)
- **Gate `/admin` behind a role check** — `ISSUE-9` (P1) → [current-state.md](./current-state.md#issue-9--admin-has-no-ui-level-role-gate)
- **Define a leaderboard tie-break rule** — `ISSUE-17` (P1) → [current-state.md](./current-state.md#issue-17--leaderboard-ranking-has-no-tie-break-rule)
- **Standardize on one data-fetching pattern** — `ISSUE-10` (P2) → [current-state.md](./current-state.md#issue-10--duplicated-data-fetching-pattern)
- **Delete or finish dead code** (`entryBuilder.jsx`, `gameAPI.js`, `footballDataProvider.js`, `whoScored.js`) — `ISSUE-11` (P2) → [current-state.md](./current-state.md#issue-11--dead-code-including-a-latent-case-sensitivity-import-bug)
- **Consolidate football-data.org sync scripts** — `ISSUE-12` (P2) → [current-state.md](./current-state.md#issue-12--overlapping-unused-football-dataorg-sync-scripts)
- **Resolve duplicate `.env` files** — `ISSUE-13` (P2) → [current-state.md](./current-state.md#issue-13--duplicate-env-files)
- **Remove debug `console.log` in `useAuth.js`** — `ISSUE-18` (P2) → [current-state.md](./current-state.md#issue-18--useauthjs-logs-the-signed-in-users-email-to-the-browser-console)
- **Overall (cross-gameweek) leaderboard** — `ISSUE-15` (P3) → [current-state.md](./current-state.md#issue-15--overall-cross-gameweek-leaderboard-is-never-populated)
- **Automated tests** — `ISSUE-16` (P3) → [current-state.md](./current-state.md#issue-16--no-automated-tests)
- **Notifications** (deadline reminders, results) — no issue id, net-new feature → [roadmap.md § P3](./roadmap.md#p3--known-product-gaps-unbuilt-not-broken)
- **Avatar upload** — no issue id, net-new feature → [roadmap.md § P3](./roadmap.md#p3--known-product-gaps-unbuilt-not-broken)

## Ready

*(nothing ready right now — see [Blocked](#blocked) for what's queued behind live
Supabase access)*

## In Progress

*(nothing in progress right now)*

## Blocked

- **Verify pot creation against live RLS policies** — `ISSUE-1` (P0) → [current-state.md](./current-state.md#issue-1--pot-creation-likely-violates-its-own-rls-policy).
  Blocked on: live Supabase project access (dashboard or connected CLI) to test as a non-admin user.
- **Verify `fixture_player_status` exists in the deployed schema** — `ISSUE-2` (P0) → [current-state.md](./current-state.md#issue-2--fixture_player_status-table-missing-from-migrations).
  Blocked on: live Supabase project access to inspect the actual deployed schema.
- **Verify what (if anything) refreshes `player_fixture_goals`** — `ISSUE-3` (P0) → [current-state.md](./current-state.md#issue-3--player_fixture_goals-materialized-view-is-never-refreshed).
  Blocked on: live Supabase project access to check for a dashboard-configured cron job not captured in migrations.
- **Decide the live-events ingestion story** — `ISSUE-4` (P0) → [current-state.md](./current-state.md#issue-4--sync-live-events-edge-function-is-referenced-but-doesnt-exist).
  Blocked on: a product decision (rebuild `sync-live-events` on api-football vs. formalize the WhoScored scraper), not a technical blocker — see [roadmap.md § P0 item 4](./roadmap.md#p0--verify-or-fix-before-building-further-on-potsscoring).

## Testing

*(nothing in testing right now — no code changes have shipped yet)*

## Done

- **Repository hygiene remediation: secrets and Chrome-profile data removed from git tracking, comprehensive `.gitignore` added, `.env.example` created** — `ISSUE-5`, `ISSUE-14` (both P0/P2) → [current-state.md § Resolved issues](./current-state.md#resolved-issues). 2026-08-03. See [session-log.md](./session-log.md).
- **Documentation restructure: issue register, cross-references, doc ownership map** — 2026-08-03. No `ISSUE-N` (this was the documentation work that created the issue-tracking system itself). See [session-log.md](./session-log.md#2026-08-03-2--documentation-restructure-remove-duplication-add-cross-references).
- **Initial documentation pass: `docs/` created from a full codebase audit** — 2026-08-03. No `ISSUE-N`. See [session-log.md](./session-log.md#2026-08-03-1--initial-documentation-pass).
- **Project management layer: `project-board.md`, `business-rules.md`, `engineering-principles.md` created; `/checkpoint` upgraded; `/preflight` added; `ISSUE-17` and `ISSUE-18` discovered and logged** — 2026-08-03. No single `ISSUE-N` (infrastructure work). See [session-log.md](./session-log.md) for this session's entry.
