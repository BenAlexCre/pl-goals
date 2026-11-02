# PL-GOALS — FINALISATION STATUS & MASTER TODO

Last updated: **2026-11-02, post-deployment** (sessions 83–85 in
[session-log.md](./session-log.md)). **Status: DEPLOYED to production** —
migration 044 applied 09:06 UTC, frontend live 09:46 UTC (`main` = `a7b7804`).
Signed-out and database-side smoke tests pass; signed-in smoke tests await an owner
decision on a test account (§0).

## 0. Deployment record (2026-11-02)

| Step | When (UTC) | Result | Evidence |
|---|---|---|---|
| Production backup | 08:50 | ✅ verified | Supabase lists **no managed backups** (PITR off), so a full dump was taken: roles + schema + data to `C:\Users\benal\pl-goals-backups\2026-11-02-pre-044\` with SHA-256 manifest. Restore-tested into a disposable Supabase stack pinned to production's Postgres 17.6.1.155 / Auth v2.195.0, single transaction with ON_ERROR_STOP: **exit 0; public 31/31 tables, 46,765/46,765 rows; auth.users 13/13; identities 13/13; Auth service lists all 13 users.** Ephemeral session/token rows and empty hosted-only tables were excluded from the *test* only (they differ from the open-source images). |
| Linked project verified | 09:03 | ✅ | CLI link, `supabase projects list`, the live site's bundle and `.env.production.local` all = `rgohuoooujqclcfkoaht` (pl-predictor-production). |
| Migration 044 | 09:06:35 | ✅ applied | `db push --dry-run` listed only 044; after push, `migration list` shows 044 remote; production schema diff before→after = **only the four `SET search_path` lines**; grants identical (12); anon still sees 0 rows on protected tables/views; matview 401; auth health 200. |
| Push + PR #1 | 09:08 | ✅ | https://github.com/BenAlexCre/pl-goals/pull/1 |
| CI first run | 09:09 | ❌ → fixed | `npm ci` failed on npm 10 (Node 22): lockfile lacked Vitest 4's optional-peer `esbuild`. **Pre-existing on `main`** (since 5e8292b), invisible until CI first ran `npm ci` on npm 10 (local dev is npm 11). Fixed by commit 10, `a7b7804`: purely additive lockfile entries (27 added, 0 removed, 0 version changes); production bundle byte-identical. Owner accepted the extra commit. |
| CI + Vercel preview | 09:15 | ✅ all green | Every CI step ran (npm ci, lint, test, build; 16 deno checks; deno tests). Preview served identical bundle hashes. **Note: previews use the production Supabase project.** |
| Merge to `main` | 09:45:31 | ✅ owner-approved | Fast-forward `89735dc..a7b7804`; PR #1 closed as merged. |
| Production deploy | 09:46 | ✅ | Vercel production deployment `pl-goals-i4g3ywh5m`; both domains serve `index-au8_b9qg.js`. CI on `main` green. **Rollback target:** previous production deployment `7481307279` (commit `89735dc`). |

**Smoke tests after deploy:**

| Area | Result | Evidence |
|---|---|---|
| Live site, signed-out, mobile + desktop | ✅ | Hardened sweep against https://www.premierleaguepredictor.ie: 68 runs (Chromium 8 widths, WebKit 320/390/768) — 0 overflow, redirects, error screens, console errors or failed requests. iPhone 13 / Pixel 7 emulation: new bundle, 0 errors. |
| Auth guards | ✅ | Signed-out `/dashboard`, `/pots`, `/admin`, `/super-admin` redirect to `/sign-in`; deep links resolve (SPA fallback). |
| Mobile load (live CDN, same throttling as the original diagnosis) | ✅ | 4G: first paint **3.5 s → 0.57 s**, app content **3.6 s → 1.5 s**. 3G sign-in: blank until ~5.7 s → paint **1.65 s**, usable 4.6 s. |
| Data preserved | ✅ | 21 core tables (users, profiles, pots, members, entries, picks, payments, prizes, notifications, fixtures, players…) — counts **identical** to the pre-release backup (read-only queries). |
| Cron / scoring pipeline | ✅ healthy | All jobs firing since 044 (compute-scores 14, live-scores 43, settle 1). `sync_runs` last 24 h: compute-scores **480/480 success**, compute-deadlines 24/24, sync-fixtures 1/1. ~25 % of pg_net calls hit its 5 s client timeout — **same rate before and after the release (25.9 % → 24.1 %)**, functions still complete; logged as ISSUE-83. |
| Supabase security advisor | ✅ no errors | 28 warnings, none error-level; the four 044 functions no longer flagged. Remaining warnings logged as ISSUE-84 (incl. anon-executable `SECURITY DEFINER` functions). |
| Signed-in flows (sign-up, Pick 5 / LMS / Predictor picks, payments, admin) | ⛔ pending | Needs the owner's decision: use an owner-supplied test account, or create a named test account in production. Not done without that decision. |

This is the release-readiness view: what ships, how to ship it, how to undo it, and
what needs the owner. It summarises and links; canonical detail lives in
[current-state.md](./current-state.md) (issues), [project-board.md](./project-board.md)
(tracker), [business-rules.md](./business-rules.md), [database.md](./database.md) and
[DEPLOYMENT.md](./DEPLOYMENT.md) (general deployment reference).

**Evidence legend** — every claim below is one of:

| Mark | Meaning |
|---|---|
| ✅ | Verified by an automated check actually executed (named) |
| 👁 | Verified by a scripted browser run, with screenshots reviewed |
| 🔍 | Verified read-only against production (schema dump, dry run, anon-key probe) |
| ◻ | Not tested this session |
| ⛔ | Blocked — needs owner credentials, approval, a decision or a real-world event |

---

## 1. Release readiness

**Verdict: ready for owner approval.** Every check that can run without production
write access has been run and passes. What remains is owner-only: approve, back up,
apply one migration, deploy, smoke-test on real devices.

| Gate | Result |
|---|---|
| ESLint (`npm run lint`) | ✅ 0 errors, 7 warnings (ratchet `--max-warnings 7` — see §5) |
| Unit tests — frontend (`npm test`) | ✅ 17/17 |
| Unit tests — Edge Functions (`deno test`) | ✅ 347/347 |
| Type check — all 16 Edge Functions (`deno check`) | ✅ 16/16 (negative control confirmed the checker catches errors) |
| Production build (`npm run build`) | ✅ clean, no oversized chunks |
| Clean CI simulation (local `.env` files removed, `npm ci`, placeholder env) | ✅ lint, test, build all pass |
| Mobile regression sweep (production-mode build, local stack) | 👁 222 route×width runs, Chromium 8 widths + WebKit 320/390: 0 redirects, 0 error screens, 0 overflow, 0 console errors; overlays reachable at 375×667 |
| Migration replay on a fresh database, 001→044 and 001→045 | ✅ both exit 0 (`supabase db diff` shadow database) |
| Production migration state | 🔍 001–043 applied; push dry run would apply **only 044** |
| Production schema drift vs migrations | 🔍 none material (schema-only dump diff; see §3) |
| CI on GitHub | ✅ green on PR #1 and on `main` (after the lockfile fix — see §0) |
| Real-device / signed-in production smoke test | ⛔ owner (§8, §9) |

---

## 2. Branch and commit inventory

**What ships = `fix/mobile-finalisation-audit`, a fast-forward of `main` (89735dc =
`origin/main`).** Nothing on `main` is missing from it; it has no merge conflicts by
construction.

| # | Commit | Subject | Area |
|---|---|---|---|
| 1 | `8c08372` | perf(frontend): boot screen and route-level code splitting | frontend |
| 2 | `673ce7b` | fix(mobile): navigation, overflow, modals and touch targets (ISSUE-82) | frontend |
| 3 | `e270f70` | feat(pots): show players their own season payment status (ISSUE-44) | frontend |
| 4 | `fd13037` | fix(db): pin search_path on SECURITY DEFINER functions (ISSUE-78) | **migration 044** |
| 5 | `9fd126d` | chore(qa): Playwright QA scripts; fix lint invocation | tooling |
| 6 | `3bc3472` | docs: finalisation status; register ISSUE-77..82 | docs |
| 7 | `729e914` | build(lint): make ESLint actually run — ESLint 9 toolchain (ISSUE-79) | tooling + 6 small source fixes |
| 8 | `43bfbd4` | ci: GitHub Actions quality gates for PRs and main | CI |
| 9 | (this commit) | docs: release preparation | docs |

**Scope of the production change:** frontend bundle + one migration (044). **No Edge
Function changes** (`git diff main..HEAD -- supabase/functions` is empty), **no new
environment variables**, no data changes.

**Not in this release:**

| Item | Where | Why excluded |
|---|---|---|
| `pot-admin-a11y-remediation` worktree | `.claude/worktrees/pot-admin-a11y-remediation`, branch at `5e8292b` (1 commit **behind** `main`), all changes **uncommitted** | Unfinished owner work: migration 045 (now renumbered), `admin-actions` remove-member pre-check, Profile/SignIn accessibility fixes + tests, docs using ISSUE-73–76. Migration 045 must ship *with* its `admin-actions` change, not ahead of it. |
| Other worktrees | none (`git worktree list`) | — |

---

## 3. Migration status

| Version | File | Repo (`main`/RC) | Local DB | Production | Notes |
|---|---|---|---|---|---|
| 001–042 | — | ✅ | ✅ | 🔍 applied | — |
| 043 | `043_views_security_invoker.sql` | ✅ | ✅ (repaired this session) | 🔍 applied — schema dump shows all four views `security_invoker`; anon gets 0 rows, matview 401 | — |
| **044** | `044_pin_security_definer_search_path.sql` | ✅ | ✅ | ✅ **applied 2026-11-02 09:06 UTC** | §4, §0 |
| 045 | `045_prevent_pot_admin_orphaning.sql` | ❌ worktree only, uncommitted | ✅ applied (was recorded as 043) | 🔍 never applied (no `enforce_pot_has_admin` in prod schema) | Ships later with its worktree |

**ISSUE-77 (043 collision) — resolved:**

- Renumbered the worktree file `043_prevent_pot_admin_orphaning.sql` →
  **`045_prevent_pot_admin_orphaning.sql`**; updated its 3 references
  (`admin-actions/removeMember.ts` ×2, worktree `docs/current-state.md`). Added
  `set search_path = ''` to its `SECURITY DEFINER` function (same policy as 044;
  body is fully schema-qualified) and a header note explaining the renumbering.
  Left **uncommitted** in the worktree — it is the owner's in-progress work.
- Checks: no `045` existed anywhere; nothing depends on the migration (only
  comments/docs reference it); never applied in production (🔍 schema dump);
  applied only to the local DB; SQL is idempotent and depends only on objects from
  001/002; **001→045 replays cleanly on a fresh database** ✅; its worktree unit
  tests pass (6/6) and `admin-actions` type-checks after the edit ✅.
- Trigger behaviour proven locally in rolled-back transactions: removing or
  demoting an active pot's last admin is blocked; deleting a whole pot still
  cascades; deleting a user who created a pot was **already** blocked by
  `pots_created_by_fkey`, so the trigger adds no new restriction there.
- **Local DB repaired** (local only; backup of `schema_migrations` taken first):
  main's real 043 and 044 applied, 045 re-applied in its updated form, and history
  rows rewritten to 043 = views, 044 = search_path, 045 = orphaning.
  `supabase migration list --local` now shows 045 as database-only on this branch,
  which is expected until the worktree merges.
- **When the worktree is finished:** commit it, rebase onto `main` *after* this
  release lands (it currently lacks 89735dc), confirm `supabase db push --dry-run`
  lists only 045, ship 045 together with its `admin-actions` change.

**Drift (🔍 production vs migrations):** production matches the migrations — its
only differences from a fresh replay are main's 043 and trivial owner/identity
details. The *local* DB is the dirty one (out-of-band prototype tables/policies,
ISSUE-20/21/28, and relaxed constraints on `fixtures`/`gameweeks`). Not a release
risk; recommended clean-up: `supabase db reset` locally when convenient (destroys
local test data).

---

## 4. Migration 044 review

**Change:** `alter function … set search_path = ''` on exactly four functions.
Production has nine `SECURITY DEFINER` functions; the other five already pin
`search_path = 'public'`, so 044 closes the whole gap (🔍 schema dump).

| Check | Result |
|---|---|
| All four functions updated | ✅ `proconfig = {search_path=""}` on each (local, after apply) |
| Permissions preserved | ✅ ACL identical to production's (`EXECUTE` for `anon`, `authenticated`, `service_role`; owner `postgres`); `SECURITY DEFINER` and volatility unchanged |
| Bodies safe under empty search_path | ✅ every reference schema-qualified (`public.*`, `auth.uid()`) |
| RLS helpers unchanged in behaviour | ✅ under a real user's JWT: member ✓ / admin ✓ / non-member ✗, identical RLS-visible row counts before and after (rolled-back txn) |
| Trigger functions still work | ✅ `handle_new_user` creates the profile on signup; `create_entry_payment` creates the unpaid payment row (rolled-back txn) |
| Still bound | ✅ 23 RLS policies, 3 triggers |
| Replays on fresh DB | ✅ 001→044 |
| Rollback tested | ✅ the four `reset search_path` statements restore `proconfig = NULL` (production's current state) with ACLs unchanged (rolled-back txn) |
| Locking / downtime | `ALTER FUNCTION` takes a brief lock on each function's catalog row; no table rewrite; no measurable downtime |

---

## 5. Issues

**Resolved in this release candidate:** ISSUE-44 (player payment status), ISSUE-81
(mobile blank screen), ISSUE-82 (mobile/tablet layout & navigation), ISSUE-79
(ESLint never ran), ISSUE-77 (043 collision — resolved in repo and local DB; the
renumbered file awaits the worktree's commit), **ISSUE-38** (`sync-fixtures` type
errors — found already fixed by `a11a32c`, closed now with evidence).
**Fixed, pending production apply:** ISSUE-78 (044).

**Outstanding:**

| ID | Pri | Summary | Next step |
|---|---|---|---|
| ISSUE-83 | P2 | ~25 % of cron → Edge Function calls hit pg_net's 5 s timeout (some stall on DNS); pre-existing | Raise `timeout_milliseconds` in the cron `net.http_post` calls (new migration); monitor DNS stalls |
| ISSUE-84 | P2 | Security advisor warnings: anon can EXECUTE 8 `SECURITY DEFINER` functions (incl. data-writing `refresh_gameweek_deadlines`); 7 invoker functions without pinned search_path; leaked-password protection off | `REVOKE EXECUTE … FROM anon` where not needed; pin search_path; enable leaked-password protection in Auth settings (owner) |
| — | P2 | 7 `exhaustive-deps` warnings in `PotDetail.jsx`/`PotManager.jsx` | Real stale-closure risk, but adding the deps as suggested would loop (loaders are recreated every render). Fix with ISSUE-10/27 (TanStack Query migration). Ratcheted so no new warning can land. |
| ISSUE-10/27 | P2 | `PotDetail.jsx` imperative fetching, no stale-response guard | Planned refactor |
| ISSUE-80 | P3 | Non-member pot view logs a 406 | `.maybeSingle()` |
| — | P3 | No Deno lockfile for Edge Functions | Add `deno.lock` so CI and deploys resolve identical remote imports |
| — | P3 | Playwright mobile sweep not in CI | Needs a Supabase stack + seeded users in CI |
| ISSUE-39 | — | `is_current` unused | **Not an open bug** — decision recorded 2026-08-19; see §10. *(Last session's report wrongly listed it as needing a decision.)* |

Full register: [current-state.md](./current-state.md#issue-register).

---

## 6. CI status

`.github/workflows/ci.yml` (commit `43bfbd4`) runs on every pull request and every
push to `main`, needs **no secrets**:

- **frontend:** Node 22, `npm ci`, `npm run lint`, `npm test`, `npm run build`, with
  non-secret placeholder `VITE_SUPABASE_*` (without them one test fails at import —
  verified by running the suite with the local `.env` files moved aside).
- **edge-functions:** Deno 2.x, `deno check` on all 16 functions, `deno test`.

Validated locally (YAML parses; the exact command sequence passes after a clean
`npm ci`). ◻ **Has not run on GitHub yet** — it will on the first push. Recommended
after the first green run: GitHub branch protection on `main` requiring both jobs.
(The GitHub MCP token in this environment is expired, so PR/branch-protection
automation from here is unavailable.)

---

## 7. Deployment instructions (owner-run)

**Important:** production is wired to **Vercel Git integration — pushing to `main`
deploys the frontend to production** (evidence: the repo's own "trigger Vercel
redeploy" commits; session-log entry 82). A `git push origin main` *is* a
production deploy.

Order: **back up → apply 044 → verify → deploy frontend → smoke test.** The two
changes are independent (the frontend does not depend on 044); applying 044 first
means one smoke test covers both, and a migration problem is caught before the
frontend changes.

### Step 0 — Verify what you are releasing
```bash
git fetch origin
git rev-parse origin/main                                # expect 89735dc…
git log --oneline origin/main..fix/mobile-finalisation-audit   # expect the 9 commits in §2
git status                                               # clean
ls supabase/migrations | tail -3                         # 042, 043, 044 — NO 045
```

### Step 1 — Back up production
- Supabase Dashboard → Database → Backups: confirm a recent backup exists (and
  whether PITR is enabled on your plan). ⛔ not visible from here.
- Additionally, local dumps (read-only; **the data dump contains personal data —
  store it securely, never in the repo**):
```bash
npx supabase db dump --linked -f ~/pl-goals-backups/2026-11-XX-schema.sql
npx supabase db dump --linked --data-only -f ~/pl-goals-backups/2026-11-XX-data.sql
```

### Step 2 — Apply migration 044
```bash
npx supabase db push --linked --dry-run   # must list ONLY 044_pin_security_definer_search_path.sql
npx supabase db push --linked             # applies 044
npx supabase migration list --linked      # 044 now in the remote column
```
Verify in the Supabase SQL editor:
```sql
select proname, proconfig from pg_proc
where proname in ('is_pot_member','is_pot_admin','create_entry_payment','handle_new_user');
-- expect {search_path=""} on all four
```

### Step 3 — Deploy the frontend (recommended: via PR, so CI and a preview run first)
```bash
git push -u origin fix/mobile-finalisation-audit
```
Open a PR to `main`. Wait for **CI green** and the **Vercel preview** deployment.
⛔ Check first that Vercel's *Preview* environment has `VITE_SUPABASE_URL`/
`VITE_SUPABASE_ANON_KEY` set — if it points at the production project, the preview
uses real production data (reads are fine; anything you submit is real). Test the
preview on a phone, then merge the PR (this triggers the production deploy).
Alternative without a PR: `git checkout main && git merge --ff-only fix/mobile-finalisation-audit && git push origin main`.

### Step 4 — Post-deployment verification
Work through §9.

---

## 8. Rollback procedure

| What | How | Time |
|---|---|---|
| Frontend | Vercel Dashboard → Deployments → previous production deployment → **Instant Rollback** (no rebuild). Then `git revert` the merge on `main` so the next push doesn't redeploy it. | ~1 min |
| Migration 044 | Run in the SQL editor, then mark it reverted (SQL below). Restores production's exact prior state (✅ tested). | ~1 min |
| Data | Not affected by this release (no data migrations). Backups from Step 1 are the last resort. | — |

```sql
alter function public.is_pot_member(uuid)    reset search_path;
alter function public.is_pot_admin(uuid)     reset search_path;
alter function public.create_entry_payment() reset search_path;
alter function public.handle_new_user()      reset search_path;
```
```bash
npx supabase migration repair --status reverted 044 --linked
```
A stale browser tab after a frontend rollback recovers on its own: missing chunks
trigger one automatic reload (`lib/lazyRoute.js`).

---

## 9. Post-deployment verification checklist

Use two accounts (an organiser and a player) and a real phone. Tick each:

**Authentication**
- [ ] Load the site on a throttled/mobile connection — boot screen appears immediately, app follows
- [ ] Sign up a new test account → verification email arrives → verify → sign in (exercises `handle_new_user` after 044)
- [ ] Sign out / sign in; close and reopen the tab (session restores); forgot-password email arrives

**Pick 5**
- [ ] Create a Pick 5 pot; invite link opens for a signed-out visitor; second account joins
- [ ] Submit picks before the deadline; edit them; after the deadline they are locked
- [ ] Standings render; payment status bar shows correctly

**Last Man Standing**
- [ ] Create/join an LMS pot; "Start playing" creates the entry; pick a team; the same team can't be reused
- [ ] Payment status line shows ("Payment not verified yet" until marked paid)

**Score Predictor**
- [ ] Create/join; predict a score and scorer; floating "selected" bar sits above the bottom bar on iPhone
- [ ] Payment status line shows

**Payments**
- [ ] Organiser marks a player paid (single) → player sees "Entry paid"/"Paid" (Dashboard + pot page)
- [ ] CSV import: dry-run preview, then apply

**Admin**
- [ ] `/admin`, payments, rollovers load; Super Admin overview/users/roles/audit load (exercises Edge Functions)

**Mobile** (iOS Safari + Android Chrome; and one tablet)
- [ ] Bottom bar shows Home / Pots / Profile (+ Admin/Super for those roles); every tab works
- [ ] No sideways scrolling on Dashboard, a pot page, Manage, Payments
- [ ] Tapping a text field does not zoom the page (iOS); dialogs scroll to their buttons
- [ ] If anything still fails on the phone that originally failed: note model, OS version, browser, and whether it was opened inside another app (WhatsApp/Instagram/Gmail)

**Cron** (SQL editor, ~15 min after deploy)
```sql
select jobname, status, return_message, start_time
from cron.job_run_details d join cron.job j using (jobid)
order by start_time desc limit 20;                      -- 'succeeded' only means pg_net QUEUED the call

select status_code, count(*) from net._http_response
where created > now() - interval '1 hour' group by 1;  -- the real signal: expect 200s, no 401s

select job_name, status, started_at, error_message from public.sync_runs
order by started_at desc limit 10;                     -- recent successful runs
```

---

## 10. Product decisions

None of these are implemented or guessed in code. Recommendations are suggestions
for the owner, not decisions.

| # | Question | Current behaviour | Urgency | Recommendation |
|---|---|---|---|---|
| 1 | **ISSUE-39 — what is the "current gameweek"?** | **Already decided (2026-08-19, [decisions.md](./decisions.md#is_current-issue-39--decision)):** the earliest-deadline, not-completed gameweek of an active league (`useNextGameweek()`); `is_current` columns are legacy and never set. | Low | Confirm the recorded decision. Optional tidy-up: stop reading `is_current` anywhere so nobody mistakes it for truth. |
| 2 | **Score Predictor `two_halves` payout** — pay once (season end) or twice (half-season boundary + season end)? | Pays **once**, at season end. `two_halves` is the **default** mode for every new Predictor pot. | **High — decide before gameweek 19** (the half-season boundary) | See the proposed structure in §10a. **Pending owner decision; payout logic deliberately unchanged.** |
| 3 | **Score Predictor reuse restriction** — what can't be reused (scoreline, goalscorer, both), and how is a "half" defined? | No restriction enforced. | Medium | Define the rule (simplest: a goalscorer can't be picked twice per half; half = GW1–19 / GW20–38) or explicitly drop it. |
| 4 | **Score Predictor entry window** — can people join mid-season? | Allowed (no gate). Cumulative scoring makes late joiners uncompetitive. | Medium | Block after the pot's start gameweek deadline, matching LMS (`pots.start_gameweek_id` already exists). |
| 5 | **LMS `season_end_tie_rule = final_prediction`** | Not selectable in the UI (only `split_prize`); engine refuses rather than guesses. | Low | Keep deferred; design only if organisers ask. |
| 6 | **Member self-leave** | Members can't leave; only admins remove. | Low | Decide whether players may leave (and what happens to paid entries). |
| 7 | **Last admin can't be removed** (ships with migration 045) | Not yet in production. | Low | Confirm the invariant "every active pot keeps an admin"; also decide whether admins need a promote-member UI (none exists). |

---

### 10a. PENDING DECISION — proposed Score Predictor two-half payout structure

**Status: proposal only. Not a business rule, not implemented, payout logic
unchanged.** Recorded 2026-11-02 at the owner's request.

**How `two_halves` behaves today (verified in `PredictorEngine` and
business-rules.md):** one cumulative standings table across all 38 gameweeks; one
season-end prize (`pot_prizes`, `scope = 'season'`) to the leader(s) after
`end_gameweek_id`'s deadline, using the existing tiebreak hierarchy (points →
exact scores → goalscorer bonuses → split). `two_halves` and `single_cycle` are
paid identically; the mode currently changes nothing about money.

**Proposed structure (for decision):**

| Element | Proposal |
|---|---|
| Halves | **H1 = GW1–19, H2 = GW20–38** (for a pot starting mid-season: from `start_gameweek_id` to GW19, then GW20–38) |
| Standings | Two independent half tables (points reset at GW20) **plus** the existing cumulative season table |
| Prize split of the net pool (after admin/charity fees) | **Option A — 50 / 50:** H1 winner(s) 50 %, H2 winner(s) 50 %; no overall prize. **Option B — 40 / 40 / 20:** H1 40 %, H2 40 %, overall season winner 20 %. **Option C — current behaviour:** one season-end prize (rename the mode so it doesn't imply two payouts). |
| When H1 pays | After GW19's deadline has passed **and** every GW19 fixture is finished/resolved — the same readiness gate settlement already uses |
| Ties | Existing hierarchy (points → exact scores → goalscorer bonuses → equal split), applied within each half |
| Entry fee | Unchanged: one season-scoped fee covers both halves; an entry voided for non-payment is excluded from any half settled while void (Late Payment Override reinstates as today) |
| Late joiners | Depends on decision 4 (entry window); if mid-season joining stays allowed, a GW10 joiner competes for H1 from GW10 and fully in H2 |
| Notifications | One `predictor.prize_awarded` per winner per half (existing event, payload gains a `half` field) |

**Recommendation:** Option B (40/40/20) keeps the season meaningful after a poor
first half — the reason organisers pick "two halves" — while still rewarding the
season winner. Option C is the zero-engineering choice if a mid-season payout isn't
wanted; then rename `two_halves` in the UI before more pots are created with it.

**Engineering implications if A or B is chosen** (for estimating, not started):
half-scoped standings (a `half` dimension on `pot_standings_snapshots` or a
computed view), `pot_prizes` rows with a half scope, an extra `awardPrize` call
at the GW19 boundary in `settle()`, tests, and the pot-detail UI showing the
current half. Needs to be built, tested and deployed **before GW19** to pay H1 on
time; otherwise H1 can be paid retrospectively once built.

**Owner to decide:** A, B or C (or other split); confirm H1/H2 boundaries; confirm
mid-season-joiner treatment (ties to decision 4).

## 11. Owner approval checklist

Tick in order. Nothing in this list has been done by Claude.

- [x] **Read §2** — agree the release is exactly the 9 commits on `fix/mobile-finalisation-audit` (frontend + migration 044; no Edge Functions; no env changes)
- [x] **Agree to exclude** the `pot-admin-a11y-remediation` worktree and migration 045 from this release
- [x] **Confirm a production backup** exists (Step 1) — taken and restore-verified (§0)
- [x] **Approve applying migration 044** to production (Step 2) — reversible in ~1 min (§8)
- [x] **Check Vercel Preview env vars** before pushing (Step 3) — previews use the production Supabase project
- [x] **Approve pushing the branch** and opening a PR (triggers CI + Vercel preview, not production)
- [x] **Approve merging to `main`** — this deploys to production (approved; plus the 10th, lockfile-only commit)
- [ ] **Run §9** on real devices; keep the rollback steps (§8) at hand — signed-out + database checks done (§0); signed-in checks pending a test-account decision
- [ ] **Decide product item #2** (two-halves payout) before gameweek 19
- [ ] Later: commit and finish the worktree; ship 045 with its `admin-actions` change

---

## 12. Mobile compatibility (from session 83, re-verified in session 84)

Sweep scripts: `frontend/scripts/qa/` (route × width sweep that fails on overflow,
unexpected redirects, error overlays/ErrorBoundary and console errors; overlay
reachability; auth resume; throttled cold load). Verified screens at
320/360/375/390/430/768/1024/1440: landing, all auth pages, join, 404, Dashboard,
Pots (+ create, all modes), Pick 5 pot/picks/gameweek, LMS pot, Score Predictor
pot, Manage, Standings, Profile, Admin, Payments, Rollovers, Demo, all Super Admin
tabs. Performance (throttled, local preview vs live CDN — directional): 4G first
paint 3.5 s → 0.56 s; 3G usable 5.7 s → 4.4 s. Root-cause analysis of the original
"doesn't load on my phone" report: ISSUE-81/82 in [current-state.md](./current-state.md).

**Methodology note:** two false passes were caught in session 83 (a compile-error
overlay counted as content; a production build silently redirecting to sign-in)
and the sweep was hardened. In session 84 a leftover preview server from session 83
answered the sweep's port; the served bundle hash was confirmed identical to the
fresh build before the result was accepted, and all orphaned processes were then
terminated.
