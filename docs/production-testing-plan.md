# Production Testing Plan — signed-in workflows

Created 2026-11-02 (post-release hardening). **Status: plan only — no production
account has been created.** Creating accounts, granting roles and recording payments
in production each need the owner's explicit approval (§ 7).

This document owns *how to test safely against production*: isolation, accounts,
what runs where, approval gates and clean-up. The step-by-step checks themselves are
[SMOKE-TESTS.md](./SMOKE-TESTS.md) (referenced by section, not repeated). Release
context: [finalisation-status.md](./finalisation-status.md).

---

## 1. Principles

1. **Isolation.** Every test runs inside dedicated test competitions with dedicated
   test accounts. Pots are private (RLS: members only), so real players never see
   test pots, test picks, test standings or test notifications.
2. **No real money.** The app never processes payments — it only *records* that an
   organiser received one (business-rules.md § Payment Verification). Test pots use an
   entry fee of **€0.00**, or a nominal amount that is only recorded, never collected.
3. **No changes to real player records.** Tests never join, edit, pay for or remove
   a real player or a real pot.
4. **Recorded and reversible.** Every production object created is logged with its id
   in a test log (§ 6) and removed by exact id afterwards — never by name pattern or
   status filter.
5. **Real time, real fixtures.** Scoring only happens when real Premier League
   matches are played, so the full plan spans one gameweek (§ 5).

## 2. Test identities (to be approved — § 7)

| Account | Purpose | How |
|---|---|---|
| `QA Organiser` | Creates and administers the test pots | New sign-up |
| `QA Player` | Joins via invite link and plays | New sign-up |
| Owner's existing Super Admin | Admin / Super Admin screens, read-only checks | Existing account, used by the owner |

- Emails: **plus-addresses on an inbox the owner controls** (for example
  `<owner-mailbox>+plg-qa-organiser@…`), so verification and password-reset emails can
  actually be received. Never a fake domain: sign-up requires email verification.
- Display names start with `QA ` and usernames with `qa_`, so test accounts are
  obvious in the Super Admin users list.
- No role grants to test accounts unless the owner approves one (an `app_admin` grant
  changes what that account can see across the platform).

## 3. Test competitions

| Pot | Mode | Settings |
|---|---|---|
| `[QA] Pick 5` | Pick 5 | €0.00 fee, private, current Premier League season |
| `[QA] LMS` | Last Man Standing | €0.00, start gameweek = next gameweek |
| `[QA] Predictor` | Score Predictor | €0.00, `two_halves` (default) — prize logic unchanged |

Created by `QA Organiser`; `QA Player` joins each via invite link. Payments are
recorded through the admin UI **only for these pots**.

**Free pots must still be marked paid (ISSUE-86).** Settlement voids every entry
not marked paid, regardless of the entry fee, and for LMS/Predictor the "Record
payment received" form refuses a €0 pot. In €0 test pots, use the Payments page's
per-member **Mark paid** toggle for every member before the deadline. Leaving one
member unmarked on purpose is a useful test of the voiding path. Until ISSUE-86 is
decided, this is also exactly what real organisers of free pots must do.

## 4. What runs where

| Workflow | Local stack | Production | Why production is needed |
|---|---|---|---|
| Sign-up, verification, sign-in, sign-out | ✅ (local mail catcher) | ✅ required | Real email delivery, production Auth settings and redirect URLs |
| Password reset | ✅ | ✅ required | Real email + production redirect |
| Session restore / tab resume | ✅ (done: `auth-resume.mjs`) | ✅ on a real phone | Real devices |
| Create pot (3 modes), invite, join | ✅ | ✅ | Production RLS + data |
| Pick 5 picks, edit, lock at deadline | ✅ (simulated time) | ✅ | Real deadline + `lock-due-entries` cron |
| Pick 5 scoring / standings / winner | ✅ (equivalence test) | ✅ over a gameweek | Real match events and cron |
| LMS pick, no-reuse, elimination | ✅ | ✅ over a gameweek | Real results |
| Predictor score + scorer, scoring | ✅ | ✅ over a gameweek | Real results |
| Payments: mark paid, CSV import, player sees status | ✅ | ✅ (test pots only) | Production admin path |
| Late Payment Override / reinstatement | ✅ | Optional | Only if a test entry is voided |
| Admin, Rollovers, Super Admin screens | ✅ (done in sweeps) | ✅ read-only | Real data volumes |
| Notifications inbox | ✅ | ✅ | Real prize/settlement events |
| Mobile layout | ✅ (done: 222 runs) | ✅ on real iOS + Android | Real browsers, safe areas, keyboards |
| Migration 046 behaviour | ✅ (done: pgTAP + HTTP) | After owner applies it | — |

Everything marked "done" was verified locally on 2026-11-02 (finalisation-status.md).

## 5. Schedule (one gameweek)

| When | Steps (SMOKE-TESTS.md §) | Checks |
|---|---|---|
| **Day 1, before the next deadline** | §1 Authentication (both accounts), §3 create the 3 pots, §4 join by invite, §5 record €0 payments, §6 submit picks in all 3 modes, edit them once | Player sees "Entry paid" (Dashboard, Pick 5 bar, LMS/Predictor status line) |
| **Deadline + 5 min** | §7 Locking | Picks read-only; `lock-due-entries` ran |
| **During matches** | §8 Scoring, §9 Standings | Live updates on a phone; compute-scores `sync_runs` successful |
| **After the gameweek completes** | §10 Winner, §11 Prize, §12 Notifications | Pick 5 weekly result; LMS survival/elimination; Predictor points; €0 prizes recorded |
| **Any time** | §2 Admin, §13 Rollover (read-only), §14 Cron, §15 Admin jobs | Owner's Super Admin account |
| **Mobile (each day)** | Repeat the core steps on iOS Safari and Android Chrome | Bottom bar, no sideways scroll, no input zoom, dialogs reach their buttons, picks bar above the home indicator |

## 6. Test log and clean-up

Record every object created (UTC time, type, id, name) in a private log — **not in
this public repository**. After testing:

1. Remove test pots' memberships and entries by **exact id** (owner-approved SQL, or a
   future admin delete action), then the pots. No pot-deletion UI exists today.
2. Delete the two test accounts by exact id (Super Admin or Supabase dashboard).
3. Re-run the data-preservation check from the 2026-11-02 deployment record (core
   table counts must match the counts taken just before testing began, plus only the
   logged test objects).

## 7. Approvals needed from the owner

- [ ] Create the two test accounts in production (§2) — and which inbox to use.
- [ ] Create the three `[QA]` pots and record €0 payments in them (§3).
- [ ] Optional: grant `app_admin` to `QA Organiser` (§2) — not recommended.
- [ ] Clean-up SQL by exact id after testing (§6).

## 8. Stop conditions

Stop and report — do not work around — if a test would touch a real player or pot,
any step needs a real payment, a production error appears in the console or
`sync_runs`, or anything behaves differently from SMOKE-TESTS.md.
