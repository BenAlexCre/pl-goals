# PL-GOALS — FINALISATION STATUS & MASTER TODO

Last updated: **2026-11-02** (finalisation audit, session 83 in
[session-log.md](./session-log.md)).

This is the release-readiness view of the whole project: what is finished, what
is broken, what remains, and what needs the owner's attention. It **summarises
and links**; it does not replace the canonical documents:

- Open/resolved issues (full detail) → [current-state.md](./current-state.md)
- Work tracker → [project-board.md](./project-board.md)
- Business rules → [business-rules.md](./business-rules.md)
- Schema / migrations → [database.md](./database.md)
- Deployment procedure → [DEPLOYMENT.md](./DEPLOYMENT.md), [deployment-checklist.md](./deployment-checklist.md)

**Evidence legend** used throughout — every claim is one of:

| Mark | Meaning |
|---|---|
| ✅ **Auto** | Verified by an automated check that was actually executed this session |
| 👁 **Manual** | Verified by hand / scripted browser run this session, with screenshots |
| ◻ **Not tested** | Not exercised this session (status comes from earlier sessions' docs, not re-proven) |
| ⛔ **Blocked** | Could not be verified — needs credentials, production access or a real-world event |

---

## 1. Executive summary

**Overall health: good, with a short list of owner decisions before wider launch.**
The three game modes (Pick 5, Last Man Standing, Score Predictor), admin and
super-admin tooling are built and deployed to production at
`https://www.premierleaguepredictor.ie`. The backend security posture is solid
(RLS on every table, every Edge Function authenticates, no service-role key in the
browser bundle, production views no longer leak data to anonymous callers).

**The "doesn't load on my phone" problem — what was actually found.**
The production site does load on both iOS Safari (WebKit) and Android Chrome
emulation with **zero JavaScript errors and no failed requests**, and the bundle
contains no syntax that older Safari can't parse. The real problem was a
combination that, on a phone, reads as "broken":

1. **A blank black screen for 3.5 s (4G) to ~5.7 s (3G)** before anything
   appeared — the whole app was one 809 KB (215 KB gzipped) script, the font
   stylesheet blocked rendering, and `index.html` had no loading state.
2. **No way to reach the Pots screen on a phone** — the bottom bar lacked a
   "Pots" tab (desktop links are hidden on mobile).
3. **Layout defects on small screens** — horizontal overflow at 320 px, modals
   whose lower content (incl. action buttons) was unreachable, iOS auto-zoom
   on 14 px inputs, overlapping floating bars on iPhones with a home indicator,
   a broken header on tablets (768–1023 px), and many sub-44 px touch targets.

All of the above are fixed in this session's commits and verified by scripted
browser runs at 8 widths on Chromium and WebKit. **They are not yet deployed** —
production still serves the old build until the owner deploys (see §8).

**Biggest remaining problems (need the owner):**

1. **Migration version collision (ISSUE-77)** — an uncommitted worktree holds a
   *different* `043_*.sql` than `main`. Must be renumbered before it is merged or
   it will silently never run in production.
2. **Two migrations/one deploy pending** — `044` (security hardening, this
   session) and this session's frontend build need to be applied/deployed.
3. **Live end-to-end verification on production** has not been done this
   session for anything requiring sign-in (no production credentials were used).
4. **Product decisions still open**: ISSUE-39 (which gameweek is "current" in
   seed data), Score Predictor reuse rule / two-halves payout / entry window,
   LMS `final_prediction` tie rule — see [project-board.md § Ready](./project-board.md#ready).

**Ready for real users?** Ready for a **closed beta with known users** once this
session's build is deployed and ISSUE-77 is resolved. Not yet ready for an open
launch: there is no CI, ESLint has never run (ISSUE-79), automated coverage is
thin (17 frontend unit tests + the Game Engine Deno suite), and no live,
authenticated production smoke test has been recorded since August.

**Completion estimate:** not given as a percentage — there is no defensible
basis for one. The feature matrix below is the honest measure: every major
feature is implemented; the gaps are verification, deployment hygiene and a
handful of explicitly-deferred product rules.

---

## 2. Feature completion matrix

"Desktop"/"Mobile" = the screen renders correctly and is usable at those widths
(👁 verified at 1024/1440 and 320–430 px this session). Functional status
(submitting, scoring, settling) is marked separately — this session verified
rendering and data loading, and **did not re-execute write flows** (see §3).

| Feature | Status | Desktop | Mobile | Outstanding work |
|---|---|---|---|---|
| Sign up / sign in / sign out | Complete | 👁 | 👁 | ◻ live sign-in on prod not re-run |
| Password reset / email verification pages | Complete | 👁 | 👁 | ⛔ email delivery needs real inbox |
| Session restore (incl. expired token) | Complete | 👁 | 👁 | — (verified: 1 refresh call, lands on page) |
| Return-to-tab session refresh | Complete | 👁 | 👁 | P3: forces a refresh on every focus (deliberate, documented) |
| Landing page | Complete | 👁 | 👁 | — |
| Dashboard | Complete | 👁 | 👁 | ISSUE-39 data: no `is_current` gameweek |
| Pot list / create pot (all 3 modes) | Complete | 👁 | 👁 | — |
| Invite link / join by code | Complete | 👁 | 👁 | ◻ join write flow not re-run |
| Pot management (members, invite code) | Complete | 👁 | 👁 | Member self-leave not built (net-new) |
| **Pick 5** — entry, picks, lock, scoring, standings | Complete | 👁 | 👁 | ◻ write/score flow not re-run this session |
| **Last Man Standing** — entry, picks, elimination, standings | Complete | 👁 | 👁 | `final_prediction` tie rule deferred |
| **Score Predictor** — fixtures, score/scorer, standings | Complete | 👁 | 👁 | Reuse rule, two-halves payout, entry window: product decisions |
| Player payment status (ISSUE-44) | **Complete (this session)** | 👁 | 👁 | — |
| Admin payments (verify, CSV import) | Complete | 👁 | 👁 | ◻ CSV import not re-run |
| Admin rollovers / late-payment reinstatement | Complete | 👁 | 👁 | ◻ |
| Notifications (in-app inbox) | Complete | 👁 | 👁 | Email/push delivery: not designed (net-new) |
| Match Centre drawer | Complete | 👁 | 👁 | — |
| Standings page | Complete | 👁 | 👁 | — |
| Super Admin (overview, users, roles, audit) | Complete | 👁 | 👁 | — |
| Demo Centre / demo gameweek | Complete | 👁 | 👁 | Super-admin only |
| Scheduled jobs (cron → Edge Functions) | Complete in code | n/a | n/a | ⛔ prod Vault secret / run history needs prod access |
| Live scores / live events (WhoScored worker) | Complete in code | n/a | n/a | ⛔ needs a live match + Railway access |
| Fixture sync (football-data.org) | Complete in code | n/a | n/a | ⛔ needs prod logs |

---

## 3. Mobile compatibility report

**Method** (all scripts committed under `frontend/scripts/qa/`, re-runnable):

- `viewport-sweep.mjs` — loads every route as a signed-in user at
  320/360/375/390/430/768/1024/1440 px and records horizontal overflow (and the
  offending elements), interactive elements under 40 px, console errors, failed
  requests and time-to-content; screenshots every combination.
- `overlays.mjs` — opens drawers/modals at 375×667 and checks the last control is
  reachable. `create-pot.mjs` — expands the create-pot form in all three modes.
- `auth-resume.mjs` — cold load with an expired token, then simulated
  background/foreground cycles, counting token refreshes.
- `probe-prod.mjs`, `throttled-load.mjs` — read-only, signed-out probes of the
  live site under iPhone 13 (WebKit) / Pixel 7 (Chromium) emulation and
  throttled 3G/4G + 4× CPU.
- `local-session.mjs` — mints a session for an existing **local** user via the
  local GoTrue admin API (refuses non-local URLs). No passwords changed.

Run against the local Supabase stack (same 43 migrations as production) with
two real-shaped accounts (a super_admin and a pot owner) so every role's screens
were covered.

**Final verification run** (👁): a **production-mode build** (minified, code-split, same Vite config) pointed at the local stack, served by `vite preview` — 222 route × width runs, Chromium at all 8 widths plus WebKit at 320/390: **0 unexpected redirects, 0 error screens, 0 horizontal overflow, 0 console errors, every route ready.**

> **Two false passes were caught and corrected during this session**, and the sweep was hardened as a result: (1) a JSX syntax error I introduced rendered Vite's error overlay, which the sweep initially counted as "content" — the build failure exposed it; the sweep now fails on the overlay and on the app's ErrorBoundary screen. (2) A sweep against the real production build silently redirected to Sign-in (that build targets the production Supabase project, so local sessions don't apply) — the sweep now fails on any unexpected redirect, and the final run used a production-mode build pointed at the local stack. Results above are from the hardened sweep only.

**Results after fixes:**

| Screen | 320 | 360–430 | 768 | 1024 | 1440 | Notes |
|---|---|---|---|---|---|---|
| Landing, sign-in, sign-up, forgot/reset, verify, join, 404 | ✓ | ✓ | ✓ | ✓ | ✓ | Zero overflow before and after |
| Dashboard | ✓ | ✓ | ✓ | ✓ | ✓ | Fixed: fixture-card overflow, cramped tiles at 1024 |
| Pots (list + create, 3 modes) | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Pick 5 pot / picks / gameweek | ✓ | ✓ | ✓ | ✓ | ✓ | Fixed: fixture cards, floating bar overlap |
| LMS pot | ✓ | ✓ | ✓ | ✓ | ✓ | Added payment status |
| Score Predictor pot | ✓ | ✓ | ✓ | ✓ | ✓ | Fixed: 16 px tap targets; added payment status |
| Pot manage | ✓ | ✓ | ✓ | ✓ | ✓ | Fixed: member row overflow |
| Standings, Profile | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Admin, Payments, Rollovers, Demo | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Super Admin (all tabs) | ✓ | ✓ | ✓ | ✓ | ✓ | Users table: intentional in-card horizontal scroll |
| Notifications drawer, Match Centre drawer | ✓ | ✓ | — | — | — | 375×667: last control reachable |

Every row: no horizontal page overflow, no console errors, no failed requests
(other than the deliberate RLS denial when viewing a pot you're not a member of).

**Remaining mobile items (not defects):** inline text links ("View standings",
"Back to …") are ~20 px tall — permitted by WCAG 2.5.8's inline exception;
⛔ not tested on a physical device (only emulation) — see §8.

---

## 4. Technical health report

| Area | Health | Evidence |
|---|---|---|
| Frontend build | ✅ Good | `npm run build` clean; entry JS 152 KB→ split into 30 + 54 + 69 KB gz parallel chunks; no >500 KB chunk |
| Frontend tests | ✅ Pass, thin | `vitest run`: 5 files, **17/17 passed** (was 6) |
| Linting | ❌ Not functional | ESLint has never run — ISSUE-79 |
| Type checking | n/a frontend (JS); Deno | ISSUE-38: `sync-fixtures` fails `deno check` (pre-existing, not re-run) |
| Performance (mobile) | 👁 Much improved | Throttled 4G: first paint 3.5 s → 0.56 s; app content 3.6 s → 1.5 s. 3G: blank ~5.7 s → paint 1.6 s, usable 4.4 s (local preview vs live CDN — directionally valid, not identical) |
| Auth/session | 👁 Good | Expired-token restore works; concurrent refreshes are deduped by supabase-js |
| RLS | ✅ Good | All public tables have RLS enabled (pg_class query) |
| SECURITY DEFINER functions | 🟡 Fix pending deploy | 4 lacked pinned `search_path`; migration 044 (verified in rolled-back txn) |
| Views exposing data to anon | ✅ Fixed in prod | Prod anon reads 0 rows from all views; matview 401 (043 applied in prod) |
| Edge Functions | ✅ Good | All 16 authenticate; super-admin/demo check `super_admin`; admin-actions 403s non-admins |
| Secrets | ✅ Good | No service-role key in `dist/`; `.env*` gitignored |
| Migrations | 🔴 Collision | ISSUE-77 |
| Cron | ⛔ Prod unverified | Code/design sound (Vault secret, ISSUE-40 resolved); prod run history needs access |
| CI/CD | ❌ None | No workflows; deploys are manual (Vercel) |
| Backups / recovery | ⛔ Unknown | Supabase plan-level backups not inspected (needs dashboard access) |
| Data integrity | ✅ Good | ISSUE-42 duplicates: 0, enforced by partial unique index |

---

## 5. Outstanding bugs (confirmed, unresolved)

| ID | Severity | Summary | Recommended fix |
|---|---|---|---|
| ISSUE-77 | **P1** | Migration version `043` collision (worktree vs main); local DB has the worktree's 043, so main's 043 never ran locally | Renumber the worktree migration to the next free number before merging; re-sync local DB |
| ISSUE-79 | P2 | ESLint config targets ESLint 9 but ESLint 8 + no plugins installed — lint has never run | Upgrade to ESLint 9 + `@eslint/js`, `globals`, `eslint-plugin-react-refresh`, matching `react-hooks`; triage findings |
| ISSUE-80 | P3 | Viewing a pot you aren't a member of logs a 406 console error (`.single()` on an RLS-filtered row) | `.maybeSingle()` + explicit not-found handling |
| ISSUE-39 | P1 (data/product) | No gameweek marked `is_current` in seed data | Owner decision on which season is current |
| ISSUE-38 | P2 | `sync-fixtures` fails `deno check` (31 type errors) | Type cleanup, no runtime change |
| ISSUE-10/27 | P2 | `PotDetail.jsx` imperative fetching, no stale-response guard | Migrate to TanStack Query hooks |

Full register: [current-state.md § Issue register](./current-state.md#issue-register).

---

## 6. Master TODO list

| Pri | Task | Component | Why | Depends on | Effort | Autonomous? |
|---|---|---|---|---|---|---|
| P0 | Deploy this session's frontend build | Vercel | Mobile fixes only reach users once deployed | Owner approval | 5 min | No — production deploy |
| P0 | Apply migration 044 to production | Supabase | Closes `search_path` advisory | Owner approval | 5 min | No — production DB |
| P1 | Resolve ISSUE-77 (renumber worktree migration, re-sync local DB) | migrations | Otherwise the orphan-admin guard never runs in prod | Owner: finish/merge worktree | 30 min | Partly |
| P1 | Authenticated production smoke test on a real phone (iOS + Android) | all | Emulation ≠ device; prod data differs from local | Deploy | 1 h | No — needs owner's accounts/devices |
| P1 | Decide ISSUE-39 (current gameweek) | data | Dashboard banner / pot creation | Owner | — | No |
| P1 | Verify cron health in prod (`net._http_response`, `sync_runs`) | Supabase | Confirms scoring/settlement actually run | Prod access | 30 min | No |
| P2 | Fix ESLint (ISSUE-79), add CI (build + test + lint on PR) | tooling | Catch regressions before deploy | — | 2–4 h | Yes |
| P2 | Score Predictor rules: reuse restriction, two-halves payout, entry window | engine | Undefined product behaviour | Owner decisions | varies | No |
| P2 | `PotDetail.jsx` → TanStack Query (ISSUE-10/27) | frontend | Removes race conditions, duplicate fetch logic | — | 4–6 h | Yes |
| P2 | `sync-fixtures` type errors (ISSUE-38) | Edge Function | `deno check` clean | — | 1–2 h | Yes |
| P2 | Store project URL in Vault for cron, not hardcoded | migrations | Lets local stack run its own pipeline | — | 1 h | Yes (needs prod apply) |
| P3 | ISSUE-80 `.maybeSingle()` for non-member pot view | frontend | Console noise | — | 30 min | Yes |
| P3 | Remove focus-triggered `refreshSession()` or throttle it | auth | One token round-trip per tab focus | — | 30 min | Yes (behaviour change — confirm) |
| P3 | Dead code / duplicate scripts (ISSUE-11/12/13), `api.md` Predictor endpoints | repo/docs | Hygiene | — | 2 h | Yes |
| P3 | LMS `final_prediction` tie rule, member self-leave, notification delivery | product | Deferred net-new features | Owner | — | No |

---

## 7. Completed during this session (2026-11-02)

**Root-cause investigation of the mobile load problem** — see §1; evidence from
production probes (iPhone/WebKit + Pixel/Chromium, throttled), bundle syntax scan,
and the local signed-in sweep.

**Fixes (frontend):**

| Change | Files |
|---|---|
| Inline boot screen + slow-network reload hint; non-render-blocking font CSS with preconnect | `frontend/index.html` |
| Route-level code splitting with stale-deploy chunk reload (once, loop-guarded) | `src/App.jsx`, `src/lib/lazyRoute.js` (new), `src/components/layout/AppShell.jsx` |
| Vendor chunking for long-term caching | `frontend/vite.config.js` |
| Bottom bar: added **Pots**; shown on phones *and* tablets (< 1024 px); 5-column support; better contrast | `src/components/layout/BottomNav.jsx` |
| Header: 44 px touch targets; desktop link row from 1024 px (fixes tablet header) | `src/components/layout/TopNav.jsx` |
| Fixture card: grid-item overflow fix; stacked layout chosen by **card width** (container query, safe fallback) | `src/components/matchcentre/FixtureCard.jsx`, `src/index.css` |
| Modal height-capped with scrolling body; 44 px close buttons; safe-area padding | `src/components/ui/Modal.jsx`, `Drawer.jsx`, `SlideDrawer.jsx` |
| Touch devices: 16 px form text (stops iOS zoom), 44 px inputs/selects, 44 px small buttons | `src/index.css`, `src/components/ui/Button.jsx` |
| Floating pick bars and toasts clear the bottom bar + iPhone home indicator | `src/pages/PotDetail.jsx`, `src/components/pot/PredictorPotDetail.jsx`, `src/components/ui/ToastContainer.jsx`, `AppShell.jsx` |
| Member row overflow; Dashboard gameweek navigator and summary tiles | `src/components/pot/MemberList.jsx`, `src/pages/Dashboard.jsx` |
| Tap targets on Predictor/LMS fixture controls and pot "Manage" links | `PredictorFixtureCard.jsx`, `LmsFixtureSelector.jsx`, `LmsPotDetail.jsx`, `PredictorPotDetail.jsx`, `PotDetail.jsx` |
| **ISSUE-44 closed**: player payment status on LMS & Score Predictor pages | `src/hooks/usePots.js` (`useMySeasonPayment`), `src/components/pot/SeasonPaymentStatus.jsx` (new) |
| Fixed `npm run lint` invocation (still blocked by ISSUE-79) | `frontend/package.json` |

**Database:** `supabase/migrations/044_pin_security_definer_search_path.sql`
(new; verified locally in a rolled-back transaction; **not applied** anywhere).

**Tests:** `src/components/layout/BottomNav.test.jsx`, `src/lib/lazyRoute.test.js`
(new, 11 tests). Suite: 17/17 ✅.

**QA tooling:** `frontend/scripts/qa/*.mjs` (described in §3).

**Issues revalidated:** ISSUE-40 (resolved in code; prod run history ⛔),
ISSUE-42 (resolved — 0 duplicates, constraint enforced), ISSUE-44 (now resolved).
New: ISSUE-77 → ISSUE-82 (see current-state.md).

---

## 8. Blocked tasks — need the owner

| Task | Needs |
|---|---|
| Deploy frontend to production | Your approval (Vercel; CLI not installed here) |
| Apply migration 044 in production | Your approval + production DB access |
| Resolve ISSUE-77 | Decision on the in-progress `pot-admin-a11y-remediation` worktree (it also uses ISSUE-73…76) |
| Signed-in production smoke test | Your accounts; ideally your actual phone |
| Physical-device test (the phone that originally failed) | Device + OS/browser version — if it still misbehaves after deploy, the model/OS/browser and whether it's an in-app browser (Instagram/WhatsApp/Gmail) are the next clues |
| Cron/scoring health in production | Production DB or dashboard access |
| Backups / PITR status | Supabase dashboard (plan-dependent) |
| GitHub MCP | Its token has expired (HTTP 401) — refresh to enable PR/issue automation |
| Product decisions | ISSUE-39; Score Predictor reuse/two-halves/entry window; LMS `final_prediction` |

---

## 9. Final release checklist

**Code & build**
- [x] Production build succeeds with no oversized chunks
- [x] Unit tests pass (17/17)
- [ ] ESLint runs clean (ISSUE-79)
- [ ] CI runs build + test + lint on every PR
- [ ] `deno check` clean for all Edge Functions (ISSUE-38)

**Database**
- [ ] ISSUE-77 resolved; migration numbering linear and identical in repo, local and prod
- [ ] Migration 044 applied to production
- [ ] Fresh-database replay of all migrations succeeds (not done — needs a disposable project)
- [ ] Supabase security advisor shows no errors

**Production verification (on real devices)**
- [ ] New build deployed; boot screen visible on a throttled phone
- [ ] Sign up → verify email → sign in → create pot → invite → join (second account)
- [ ] Submit picks in each mode before the deadline; confirm lock after it
- [ ] Mark payments paid (single + CSV); player sees status in each mode
- [ ] Scores/standings update during a live gameweek; settlement voids unpaid entries
- [ ] Cron jobs: recent 2xx responses in `net._http_response`
- [ ] Test on iOS Safari and Android Chrome, 320–430 px; and one tablet

**Operations**
- [ ] Backups / point-in-time recovery confirmed
- [ ] Error monitoring in place (currently console only)
- [ ] Rollback procedure rehearsed (Vercel instant rollback; migration down-scripts don't exist — forward-fix only)
- [ ] Product decisions recorded for all deferred rules, or explicitly accepted as out of scope for launch
