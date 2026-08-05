# Roadmap

Last reviewed: 2026-08-03. This is a starting roadmap derived entirely from auditing
the existing code — there was no pre-existing product roadmap, backlog tool, or issue
tracker in the repo to draw from. Re-prioritize freely against real product goals;
treat the ordering below as "what the code is telling us is broken or unfinished," not
a committed plan.

This document owns **the plan** — what to do about each open issue, and in what order.
It does not restate the issue itself; each item below references an `ISSUE-N` id whose
full description, evidence, and verification status lives in
[current-state.md](./current-state.md). The tiers here (P0–P3) match
[current-state.md](./current-state.md)'s issue-register tiers exactly, so an issue's
priority only needs to be stated in one place. Item numbers below are just this
document's own reading-order list — they are not the same as `ISSUE-N` ids, and issues
land in whichever tier fits regardless of when they were discovered, so the two
numbering sequences will drift apart over time. Always cross-reference by `ISSUE-N`,
never by this list's item number.

For the current status of each of these items as work items (not started / in
progress / blocked), see [project-board.md](./project-board.md), which is kept in
sync with this plan by `/checkpoint`.

See also: [current-state.md](./current-state.md) (issue register), [decisions.md](./decisions.md)
(rationale behind choices some of these items would change).

## P0 — verify or fix before building further on pots/scoring

These aren't "features to build" so much as "facts to establish," because several
other decisions depend on the answer. All five are read-only investigations except
where noted — none require a code change to start.

1. **(ISSUE-1) Confirm whether pot creation actually works for a non-admin user**
   against the live RLS policies. If it's broken as the migrations suggest, either fix
   the `pot_members_insert_admin` policy (e.g. also allow `user_id = auth.uid() and
   pot_id in (select id from pots where created_by = auth.uid() and not exists
   (select 1 from pot_members where pot_id = pots.id))`), or move pot creation plus the
   first-member insert into a `security definer` RPC, or have the frontend call an
   edge function that uses the service role for this one step.
2. **(ISSUE-2) Confirm whether the deployed Supabase schema matches
   `supabase/migrations/`.** Specifically: does `fixture_player_status` exist? Does
   `fixtures.whoscored_fixture_id` / a `teams` WhoScored-ID column exist? If yes to
   either, write a migration that captures the current production shape so
   `supabase/migrations/` is trustworthy again.
3. **(ISSUE-3) Confirm what's keeping `player_fixture_goals` refreshed, if anything.**
   If nothing is, either add a scheduled refresh (a new cron job calling a thin edge
   function, or a `pg_cron` job that runs `select
   public.refresh_player_fixture_goals()` directly), or fold the aggregation into
   `compute-scores` as a live query instead of relying on the materialized view.
4. **(ISSUE-4) Decide the actual live-events ingestion story.** Pick one: (a) build
   `sync-live-events` for real, backed by a legitimate provider — api-football
   already has a live-fixtures/events endpoint in use for fixture sync, so extending
   `sync-fixtures`'s approach to events would remove the WhoScored dependency
   entirely — or (b) formally adopt the scraper as the ingestion mechanism and
   automate running it (a small always-on worker/cron container, not "someone's
   laptop"), accepting the fragility and possible ToS risk that comes with scraping.
5. **(ISSUE-5) Fix repository hygiene before the first commit.** Populate the root
   `.gitignore` (at minimum: `.env`, `node_modules`, `frontend/*chrome-profile*`,
   `frontend/dist`) and decide whether the root `.env` should exist at all (see item
   14 below). This is the one P0 item that's a straightforward code change, not an
   investigation — do it first, since it's a landmine that gets worse the longer it
   waits.

## P1 — close the loop on features that are half-built

6. **(ISSUE-6) Build Payment Verification.** Per the canonical design
   ([decisions.md § Payment Verification, not payment processing](./decisions.md#payment-verification-not-payment-processing),
   [business-rules.md § Payment verification rules](./business-rules.md#payment-verification-rules)):
   no payment gateway, ever — the app only records whether an entry has been
   verified as paid, off-platform. Needs two admin capabilities: (a) mark a single
   entry paid/unpaid manually (render `MemberTable`/`PaymentTable` somewhere
   reachable, call `useAdminAction` against `mark_paid`/`mark_unpaid` — the existing
   unwired components already match this shape), and (b) a CSV bulk importer
   (`Identifier,Pot,Status,Notes`, identifier = email or phone) that validates every
   row, previews all changes, reports errors before applying anything, updates only
   confirmed rows, keeps a full audit trail, and never partially imports without
   confirmation. Without this, `compute-scores`/`Pick5Engine.settle()` voids every
   entry.
7. **(ISSUE-7) Reconcile the two pick-building flows.** Either delete `PotDetail.jsx`'s
   inline picker in favor of linking to `PicksPage`, or extract the eligibility rules
   (goalkeeper exclusion, max-5-of-same-player, deadline lock) into one shared
   function/hook both flows call, so the rules can't silently diverge again. This is
   the concrete fix for the root cause tracked as ISSUE-10. Whatever the resolution
   is, it needs to be reflected in [business-rules.md § Entry eligibility](./business-rules.md#entry-eligibility),
   which currently can't state a single goalkeeper rule because the app enforces two.
8. **(ISSUE-8) Finish or remove the invite-code join flow.** Either build "generate
   code → share → redeem to join" (needs a new RPC or edge function, since self-serve
   join isn't covered by any current RLS policy), or drop the `invite_code` column if
   admin-only invites are the intended permanent model.
9. **(ISSUE-9) Gate `/admin` behind an actual role check** in `ProtectedRoute` or a
   dedicated `AdminRoute`, consistent with how `admin-actions` already checks
   `app_metadata.role = 'app_admin'` server-side.
10. ~~**(ISSUE-17) Define and implement a deterministic leaderboard tie-break rule.**~~
    **Done** — resolved 2026-08-05 (Milestone 4, Slice 6): standard competition
    ranking, ties share a rank, no forced winner. Implemented in
    `Pick5Engine.generateStandings()`. Still open for the retired prototype's
    `settle-gameweek` leaderboard path, which is out of scope for the new schema's
    rebuild.

## P2 — cleanup / consolidation

11. **(ISSUE-10) Pick one data-fetching pattern.** Migrate `PotDetail.jsx` and
    `potManager.jsx` onto the existing `hooks/usePots.js` / `hooks/useEntry.js` React
    Query hooks (or, if the team prefers the manual-fetch style, do the reverse).
    Standardizing removes an entire class of "the two implementations drifted" bugs —
    item 7 above being the first one already found.
12. **(ISSUE-11) Delete or finish the dead code**: `components/entryBuilder.jsx`,
    `lib/gameAPI.js`, `lib/footballDataProvider.js`, `lib/whoScored.js` (move its
    content out of `src/lib` if it's meant to be kept as a reference script — it's a
    Node/Playwright script, not browser code, and doesn't belong in the Vite-bundled
    tree either way).
13. **(ISSUE-12) Consolidate the football-data-provider scripts.** Decide whether
    football-data.org is a real fallback/secondary provider or leftover exploration,
    and delete or consolidate the three overlapping scripts accordingly.
14. **(ISSUE-13) Resolve the duplicate `.env` files.** Decide whether the root `.env`
    needs to exist at all given `frontend/.env.local` already covers every variable
    everything in the repo actually reads.
15. **(ISSUE-14) Remove the Chrome profile directories from the working tree**, or
    move them outside the repo entirely, once ISSUE-5's `.gitignore` fix is in place.
16. **(ISSUE-18) Remove the debug `console.log` in `useAuth.js`** that logs the
    signed-in user's id and email on every auth state change — see
    [engineering-principles.md § Logging](./engineering-principles.md#logging) for the
    standard to apply instead.

## P3 — known product gaps (unbuilt, not broken)

17. **(ISSUE-15) Overall (cross-gameweek) leaderboard.** `settle-gameweek` needs to
    also write an `is_overall: true` row per pot/user, aggregating across all
    completed gameweeks, matching what `hooks/useLeaderboard.js` already expects to
    read.
18. **(ISSUE-16) Automated tests.** Given how much business logic lives in RLS
    policies, triggers, and edge functions (goal-threshold recomputation, deadline
    locking, payment voiding, leaderboard ranking), even a thin layer of tests around
    `utils/scoring.js` and the edge functions would catch regressions the type system
    can't.
19. Notification delivery (email/push/SMS beyond the in-app inbox; deadline reminders)
    — the in-app domain-event write exists as of Milestone 4 Slice 9
    (`Pick5Engine.notifyUsers()`, [game-engine.md § GE-4.8](./game-engine.md#ge-48-notifications));
    an actual delivery mechanism beyond that remains unbuilt, not yet tracked as a
    numbered issue since it's a net-new feature rather than a gap in existing behavior.
20. Avatar upload — `profiles.avatar_url` exists but there's no Supabase Storage
    bucket or upload UI; same status as item 19.

## Suggested near-term sequencing

1. Do ISSUE-5 (repo hygiene) immediately — it's the one P0 item that's pure upside
   with no investigation required, and it only gets riskier to leave for later.
2. Verify ISSUE-1 through ISSUE-4 against the live Supabase project (read-only,
   no code changes) — everything else is more efficient once these are known facts
   instead of open questions. Record results in
   [current-state.md § Verification status](./current-state.md#verification-status)
   as you go.
3. Fix whichever of ISSUE-1 through ISSUE-4 turn out to be real bugs, not
   hypothetical ones.
4. Land ISSUE-6 (Payment Verification: single-entry admin UI + CSV bulk import) — a
   prerequisite for payouts to be trustworthy. ISSUE-17 (tie-break rule) is already
   done for the new schema (2026-08-05).
5. Do the P2 cleanup (ISSUE-10 through ISSUE-14, and ISSUE-18) in one pass — it's
   largely mechanical once the P0/P1 decisions are made, and it shrinks the codebase
   enough to make the rest of P1 and P3 easier to reason about.
