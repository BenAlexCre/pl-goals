# Smoke Tests

Created 2026-08-10, Production Readiness Sprint (Staging & Deployment Audit).
A documented, executable checklist for confirming a deployment actually works
— run this after every deployment to a new or changed environment, per
[DEPLOYMENT.md § 9](./DEPLOYMENT.md#9-deployment-sequence).

Every step below was actually exercised, live, against this project's own
local environment during Launch Readiness Sprint 2 (2026-08-10) and/or this
sprint — this is not a generic template, it's the specific sequence already
proven to work against this codebase. Where a step is mode-specific, it's
marked; run it once per mode unless noted otherwise.

Written for someone who has never seen this project before. No prior
knowledge of the codebase assumed beyond having completed
[DEPLOYMENT.md](./DEPLOYMENT.md)'s deployment sequence first.

---

## Before you start

- [ ] You have a signed-in browser session available, or can create one (an
      email/password account works — no external OAuth provider is
      configured by default).
- [ ] You have at least one account with `app_admin` granted
      (`DEPLOYMENT.md` § 8) for the Admin Jobs section of this checklist.
- [ ] You know this environment's frontend URL and Supabase API URL.

---

## 1. Authentication

- [ ] Navigate to the frontend's root URL while signed out — you should land
      on (or be redirected to) `/sign-in`, not a broken page or an
      unauthenticated view of protected content.
- [ ] **Player registration**: use "Need an account? Create one", sign up
      with a real-format email and a password meeting the configured minimum
      length (`config.toml`'s `auth.minimum_password_length`, default `6`).
      Confirm you land on `/dashboard` (or wherever post-signup redirect
      goes) signed in, not stuck on an error.
- [ ] **Sign in**: sign out, sign back in with the same credentials. Confirm
      you land back on a signed-in view.
- [ ] Confirm the top nav shows no "Admin" link for a plain, non-admin
      account, and that navigating directly to `/admin` shows "Not
      authorised", not the real admin dashboard. Do this on both a desktop
      and a mobile-width viewport — an authorization check that only holds
      at one viewport size is a real bug, not a cosmetic difference (found
      and ruled out as a false alarm — stale JWT after a role revocation,
      not an actual gap — during Launch Readiness Sprint 2; re-confirm this
      still holds on your environment).

## 2. Admin login

- [ ] Sign in as the account you granted `app_admin` to
      (`DEPLOYMENT.md` § 8). Confirm the top nav now shows an "Admin" link,
      and `/admin` shows the real Admin Dashboard: "Payment verification",
      "Rollover management", "Manual jobs" (four buttons), and "Recent sync
      logs".
- [ ] Sign in as a **pot-admin who is not an `app_admin`** (create a pot with
      any account — the creator automatically becomes that pot's admin).
      Confirm `/admin/payments` and `/admin/rollovers` are reachable (pot-
      level admin is sufficient for these), but `/admin` itself does *not*
      show the "Manual jobs" section (platform-wide, `app_admin`-only).

## 3. Create a pot — once per mode (Pick 5, Last Man Standing, Score
   Predictor)

- [ ] From `/pots`, create a pot in each mode against a league/season that
      has genuinely **future** fixture data — check the league's gameweeks
      before picking one; using a league whose fixtures are all in the past
      relative to today will make LMS/Predictor's entry-window check
      correctly reject joining, which looks like a bug if you don't expect
      it (this happened during Launch Readiness Sprint 2's own testing — not
      a real defect, a test-setup mistake).
- [ ] Set a non-zero entry fee on each. Confirm each pot creates successfully
      and the creator is auto-added as its admin.
- [ ] LMS specifically: confirm the "Last Man Standing settings" section
      (start/final gameweek, wipeout resolution, season-end tie rule)
      appears and a start/final gameweek can be selected. Score Predictor
      specifically: confirm its own settings section (final gameweek, cycle
      mode, scoring point values) appears.

## 4. Join a pot — both paths, with a second real account

- [ ] **Add by username**: as the pot admin, use "Add a registered player by
      username" to add a second account. Confirm they appear in the Members
      list immediately.
- [ ] **Invite code**: as the pot admin, click "Generate invite code".
      Copy the resulting `/join/<code>` link. Open it in a signed-out
      session (or an incognito window) with a **third** account — confirm
      you're prompted to sign in or create an account, with the invite code
      preserved through that detour (`redirect=` query param), and land back
      on the join screen afterward, then successfully join on confirming.

## 5. Payments

- [ ] As the pot admin, go to `/admin/payments`, select the pot. For
      Pick 5: confirm a Gameweek selector is shown; for LMS/Predictor:
      confirm it is **not** shown (season-scoped, no per-gameweek concept).
- [ ] **Record payment received**: enter a member and the exact required
      amount (a multiple of the entry fee for Pick 5; exactly the entry fee
      for LMS/Predictor). Click Preview — confirm it shows what will change
      before anything is written. Confirm.
- [ ] **Mark paid / Mark unpaid**: toggle a member's status directly from the
      table. Confirm the UI updates immediately and the label reads "Mark
      paid" (LMS/Predictor) vs. "Mark paid for this week" (Pick 5).
- [ ] Confirm a player's own view never exposes a way to mark themselves
      paid or enter a payment amount anywhere in the app (there is currently
      no player-facing payment status display at all — `ISSUE-44`, a known,
      confirmed, deliberately-unfixed gap, not something this checklist
      should find "broken").

## 6. Picks

- [ ] **Pick 5**: as a player, open the picker for the pot's current
      gameweek, select exactly 5 outfield players, save. Confirm the entry
      shows "5/5 picks selected" afterward.
- [ ] **LMS**: select one team to win the gameweek, save. Confirm "Alive"
      status shows.
- [ ] **Score Predictor**: select a fixture, enter a scoreline, optionally a
      goalscorer, save. Confirm the prediction persists on reload.
- [ ] **Edit before deadline**: change any of the above before the gameweek
      deadline passes. Confirm the change saves (same underlying row
      updated, not a duplicate).

## 7. Locking

- [ ] Once a gameweek's deadline has passed (naturally, or via a manually-
      triggered `compute-deadlines` run against a gameweek whose deadline
      you've deliberately moved into the past for testing — see
      `decisions.md`'s own prior sessions for the exact technique if you
      need to force this in a non-production environment), confirm a
      resubmission attempt against that now-locked entry is rejected with a
      clear error, not silently accepted or silently ignored.

## 8. Scoring

- [ ] After a gameweek's fixtures are finished (real result data, via the
      real `sync-fixtures`/live-score pipeline in production, or manually
      seeded for a non-production test environment), confirm a
      `compute-scores` run updates picks with real results — Pick 5 picks
      show `won`/`lost` and `goals_scored`; LMS picks show `won`/`lost`
      matching the real match result; Predictor picks show `points_awarded`
      matching the pot's own configured scoring values.

## 9. Standings

- [ ] Open the pot's own standings/leaderboard view. Confirm every paid
      member appears, ranked correctly, and any unpaid/voided member does
      **not** appear.

## 10. Winner

- [ ] After a gameweek/competition concludes (Pick 5: any gameweek with a
      5/5 winner; LMS: down to one survivor, a full wipeout, or the
      configured final gameweek; Score Predictor: the configured final
      gameweek), confirm the winning entry/entries are correctly identified
      — check `pot_prizes`/the standings view, not just that settlement ran
      without error.

## 11. Prize

- [ ] Confirm the winning entries' `game_entries.payout_amount` (or
      equivalent) reflects the correct net prize (gross entry fees minus any
      configured admin/charity fee), and that a non-winning, still-settled
      entry receives nothing.

## 12. Notifications

- [ ] Confirm the winning player(s) see a notification (bell icon, unread
      count) after settlement — `pick5.prize_awarded` or
      `lms.prize_awarded`. Note: Score Predictor's own prize notification
      only fires at genuine season conclusion (per its own settlement
      design, not a per-gameweek event) — don't expect one after an
      individual gameweek's scoring alone.

## 13. Rollover

- [ ] Confirm `/admin/rollovers` loads without error and shows its correct
      empty state ("No draft rollover pots") when none exist.
- [ ] If your environment has a genuine no-winner conclusion available to
      test against (a Pick 5 gameweek with no 5/5 winner at season end, or
      an LMS wipeout configured to roll rather than split), confirm the
      resulting draft rollover pot appears here, can be renamed, and can be
      activated (LMS requires both a start and final gameweek chosen first;
      Pick 5 needs neither, both auto-resolve).

## 14. Cron

- [ ] Wait for (do not manually trigger) one real tick of each job in
      [DEPLOYMENT.md § 6](./DEPLOYMENT.md#6-cron-jobs). Check
      `net._http_response` for each — expect `200`, **not** just
      `cron.job_run_details` showing `succeeded` (see `DEPLOYMENT.md` § 7
      for exactly why the latter alone is not sufficient evidence).
- [ ] `sync-live-events-every-2-min` is expected to show `404` — this is
      correct, documented behavior (`ISSUE-4`), not a failed smoke test.

## 15. Admin jobs

- [ ] As an `app_admin`, click each of the four "Manual jobs" buttons on
      `/admin` in turn ("Sync fixtures / squads", "Sync live events",
      "Compute live scores", "Settle finished gameweeks"). Confirm each
      produces a new row in "Recent sync logs" with a real status (`success`
      or a legible `failed` reason) within a few seconds — not a silent
      no-op, not an unhandled exception in the browser console.

---

## If something fails

- **A `401` anywhere in the cron/admin-jobs section**: check
  `DEPLOYMENT.md` § 7 first — the service-role-key GUC mismatch is the
  single most likely cause and was, on this project's own environment, the
  cause of a total, silently-invisible pipeline failure.
- **`sync-fixtures`/"Sync fixtures / squads" fails**: check `VITE_FOOTBALL_DATA_KEY`
  is actually set as an Edge Function secret (`DEPLOYMENT.md` § 5) — this is
  a known, currently-unresolved gap in this project's own local environment,
  not something to assume is already configured.
- **A player can reach `/admin/*`**: this is a genuine security regression,
  not a config gap — stop and investigate `App.jsx`'s `AdminRoute` and the
  relevant RLS policies before proceeding with anything else.
