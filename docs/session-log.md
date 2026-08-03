# Session Log

Chronological log of Claude Code sessions on this project. Newest entry on top. Per
`CLAUDE.md`, this — along with the rest of `docs/` — is treated as the permanent
memory of the project between sessions.

This log records **what happened in each session**: what was read, what was changed,
what was decided. It is not where open issues live — those belong in
[current-state.md](./current-state.md)'s issue register, referenced here by `ISSUE-N`.
Keep entries here terse; if you find yourself writing more than a sentence about a
specific bug or gap, that detail belongs in current-state.md instead, with a pointer
from here.

---

## 2026-08-03 (7) — Track B resolved; shared platform schema deployed

**Prompted by:** continuing the deployment checklist. `006_fix_cron_job_headers.sql`
was applied first (5 jobs fixed, 1 confirmed `200` end-to-end; the redundant
`supabase_admin`-owned `sync-live-events-every-5-min` job left alone per explicit
instruction, deferred to Track B). A first attempt to begin Track B (renaming the
two colliding enum types) failed identically to the prior session's attempt —
`must be owner of type game_type` — confirming nothing had changed. The user then
completed the rename via the Supabase Dashboard directly.

**Verified before proceeding** (not assumed): `game_type`/`predictor_cycle_mode` no
longer exist under their original names; `*_prototype_deprecated` versions exist,
still `supabase_admin`-owned. This cleared the way for Track A (4 `pots` columns
dropped — `postgres`-privileged, zero data loss, confirmed) and then
`004_game_engine_shared_platform.sql` / `005_game_engine_shared_platform_rls.sql`,
both applied with **zero errors across every statement**.

**Full verification performed, not assumed:** all 7 new tables exist and are
`postgres`-owned; all 14 foreign keys present with correct `restrict`/`cascade`
behavior per `schema-review.md`'s findings; 21 indexes; 5 triggers including the
new `trg_pots_contract_immutable`; 10 RLS policies across all 7 tables with RLS
enabled on every one; the 3 relevant functions `postgres`-owned; every pre-existing
table's row count unchanged (`pots`=2, `pot_members`=1, `entry_payments`=1,
`user_entries`=1, `user_entry_picks`=5). Cross-checked
`supabase/functions/_shared/game-engine/types.ts` against the deployed schema
field-by-field — exact match, no changes needed.

**Result:** ISSUE-21 is resolved for the two objects that blocked deployment.
ISSUE-20 is narrowed, not closed — the new schema is fully RLS-protected from
creation, but the 7 original prototype tables remain exactly as exposed as before,
deliberately untouched (Phase 8 of `deployment-checklist.md`, not yet done). The
`sync-live-events-every-5-min` cron job and the 7 tables/11 functions/1 view/2
non-colliding types are the complete remaining Track B/Phase 8 scope. Milestone 4
has not begun.

---

## 2026-08-03 (6) — Local infrastructure diagnosed and partially fixed; six-object isolation attempted and correctly rolled back

**Prompted by:** continuing the deployment checklist after Phase 1 (the two
`app.settings.*` GUCs) was applied. A key scoping correction landed first: the
database investigated all session is the **local Docker Supabase stack**, not a
hosted project — confirmed via `inet_server_addr()` returning a Docker bridge
address and `docker ps` showing the `supabase_*_pl-goals` container set. The user
directed treating local Docker as the authoritative environment going forward and
not comparing against any hosted project.

**Edge runtime root cause:** not "simply stopped" — `supabase_vector_pl-goals`
(the analytics log-shipping sidecar, unrelated to Edge Functions) was stuck in a
Docker container-name conflict that aborted `supabase start` before it ever reached
`edgeRuntime`. Fixed by removing the stale container and cycling `supabase stop` /
`supabase start`. Verified directly via curl (401 for a real function, 404 for a
nonexistent one) before trusting cron to prove it.

**A second cron root cause found and fixed:** `app.settings.supabase_url` was set to
`http://127.0.0.1:54321` — valid from the host, meaningless from inside the Postgres
container where pg_net's HTTP worker actually runs. Corrected to `http://kong:8000`
(Docker-internal DNS, confirmed via `docker network inspect`).

**A third cron root cause found, not yet fixed:** this local Kong requires an
`apikey` header to route to `/functions/v1/*`; `003_cron_jobs.sql` only ever sends
`Authorization: Bearer`. Reproduced directly (curl with `apikey` added succeeds;
without it, 401). Needs a new migration updating the cron job definitions — `003`
itself isn't rewritten in place, per `engineering-principles.md`. Not written this
session.

**Six-object isolation transaction — approved, executed, correctly rolled back.**
Ran the reviewed transaction (2 enum renames + 4 `pots` column drops) as a single
`begin`/`commit` block. Failed immediately on the first statement — `must be owner
of type game_type` — a direct, repeated confirmation that the ownership split
(ISSUE-21) is real inside local Docker too, not just a hosted-project concern.
Rolled back cleanly, zero side effects, verified. The mistake was combining Track A
(the `postgres`-privileged column drops) and Track B (the `supabase_admin`-privileged
type renames) into one transaction — corrected in `deployment-checklist.md` to run
them separately, Track B first.

**`/health` and `/drift` run** (the commands created earlier this session, now
exercised for the first time): confirmed infrastructure/database/edge-runtime
healthy, cron partially healthy (SQL layer fixed, HTTP delivery still blocked by the
apikey gap), security still fully open (ISSUE-20 unchanged), docs one step stale
(corrected in this session). No unexpected drift beyond what's already tracked.

**Result:** ISSUE-19 is two-thirds resolved with one precisely-diagnosed remaining
gap; ISSUE-20 is unchanged and open; ISSUE-21's Track A is ready and safe to execute
independently, Track B still needs Dashboard/support access. Milestone 4 has not
begun.

---

## 2026-08-03 (5) — Live-evidence priority review, drift investigation, and the start of a three-game-mode platform rebuild

**Prompted by:** a request to verify (using live Postgres/GitHub MCP evidence, not
documentation alone) whether ISSUE-1 was still the highest-priority issue, followed by
a long, multi-part session that escalated through a full drift investigation, an
emergency-security attempt, an ownership investigation, and — on discovering the
undocumented prototype objects represented real, wanted product features — a full
architecture-and-implementation restart for a three-game-mode platform (Pick 5, Last
Man Standing, Score Predictor). This is one continuous session; the entry below is
grouped by phase rather than by every individual turn.

**Phase A — Live-evidence priority review.** Queried the live Supabase project
directly (Postgres MCP) rather than trusting the docs. Found: ISSUE-1 is actually
**resolved** live (an undocumented RLS policy fixes the circularity) — the documented
P0 was stale. Found something far more severe and previously unknown: **every
cron-triggered Edge Function has a 100% failure rate since the earliest recorded run**
(missing `app.settings.supabase_url`/`service_role_key`), now `ISSUE-19`. Also found
6 undocumented tables (`gameweek_pots`, `lms_entries`, `lms_picks`, `predictor_entries`,
`predictor_picks`, `whoscored_fixture_map_staging`) plus `fixture_player_status`, all
owned by `supabase_admin` rather than `postgres`.

**Phase B — `/preflight` drift investigation and reconciliation planning.** Full
table/view/function/trigger/policy/extension/index/column comparison between live
Postgres and `supabase/migrations/`. Produced a categorized drift report (Missing
migration / Expected / Unexpected / Manual production change) and a reconciliation
plan. Created `.claude/commands/drift.md` (a new mandatory pre-release command) at the
user's request.

**Phase C — Emergency security attempt, blocked.** Designed and got approval for a
Phase 1 fix (enable RLS + minimum policies on the 7 exposed tables, revoke `EXECUTE`
on the related settlement functions and `lock_gameweek_entries()`). **Execution
failed**: `must be owner of table fixture_player_status`. Investigated why — every
prototype object is owned by `supabase_admin`, not `postgres`; `postgres` has no
privilege over `supabase_admin`'s objects by Supabase's own platform design. Most
likely origin: these objects were created via Supabase Studio's no-code Table Editor,
which executes as `supabase_admin`, not the SQL Editor/CLI path (which uses
`postgres` and produced everything in `001`–`003`). **This fix was never applied —
ISSUE-20 (the live RLS/anon-write exposure) and ISSUE-21 (the ownership split) are
both still open.**

**Phase D — Strategic pivot.** The user determined the undocumented LMS/Predictor
objects represented a real, wanted product direction, not just tech debt: the
application will launch with three fully production-ready game modes (Pick 5, Last
Man Standing, Score Predictor), one game mode per pot, immutable after creation. The
prototype objects are treated as a signal of business intent only — reverse-engineered
for what they were trying to do (including finding two real bugs in the process: an
`lms_tiebreak_picks` table referenced but never created, and a `'winner'` value used
but never added to the `lms_status` enum), not preserved as an implementation.

**Phase E — Milestones 1–3, designed, reviewed, and built.**
- **Milestone 1** — [docs/game-engine.md](./game-engine.md) created as the
  authoritative architecture specification: shared platform vs. mode-specific
  boundary, the `game_entries` shared-parent entry architecture (chosen over three
  fully independent entry systems, and over a polymorphic JSON picks table), an
  eight-method Game Engine lifecycle contract, a `game_type`-keyed dispatcher,
  Edge-Functions-only settlement (SQL functions retired), and a `GE-N` traceability
  scheme mirroring `ISSUE-N`.
- **Milestone 2** — `supabase/migrations/004_game_engine_shared_platform.sql` and
  `005_game_engine_shared_platform_rls.sql` drafted (shared schema, payments,
  `pot_prizes`, `game_entries` + three thin per-mode children, standings,
  invitations, notifications). Then put through a full greenfield architectural
  review (`docs/schema-review.md`) that found real issues in the first draft —
  most seriously, `on delete cascade` on the two money-holding tables (`pot_prizes`,
  `game_entries`), which could silently destroy payout records, and an internal
  inconsistency where three different tables represented the same "gameweek- vs.
  season-scoped" concept three different ways. Findings were classified
  Critical/Required-before-launch/Recommended/Optional; every Critical and
  Required-before-launch item was applied (cascade → restrict, a unified
  `pot_scope` enum, a redundant `settled` column removed, the immutability trigger
  broadened beyond just `game_type`, missing `check` constraints added,
  `pot_prizes.updated_at` added, column-level RLS narrowing on two `update`
  policies); Recommended/Optional items (extra indexes, `redeem_invite()`'s
  `max_members`/`status` checks, removing `pots.game_type`'s default) were
  deliberately deferred, not silently applied. A re-review confirmed the changes
  were internally consistent with no new issues introduced. **Neither migration has
  been applied to the live database** — blocked by ISSUE-21 (they recreate several
  object names `supabase_admin` still owns).
- **Milestone 3** — the Game Engine framework itself, under
  `supabase/functions/_shared/game-engine/` (`types.ts`, `contracts.ts`,
  `dispatcher.ts`, `errors.ts`, `index.ts`): the `GameEngine` interface, the
  `GameEngineContext` dependency-injection boundary, and a registration/resolution
  dispatcher — deliberately zero mode-specific logic, zero scoring, zero
  settlement. Verified via a dedicated `TestGameEngine` fixture
  (`__fixtures__/test-game-engine.ts`, explicitly marked framework-verification-only,
  never imported by production code) and `framework-verification.test.ts`, proving
  registration, resolution, the unknown-engine error path, duplicate-registration
  handling, and — the one thing the earlier `dispatcher.test.ts` couldn't prove —
  that dependency injection actually carries the same object references through the
  dispatcher, not just that the types line up. **The user ran these tests locally
  and confirmed all pass.** `docs/game-engine.md` was rewritten a second time to
  incorporate the Milestone 2 review outcomes and add the sections requested as the
  document's final, authoritative form: shared services, folder structure,
  dependency boundaries, five Mermaid sequence diagrams (submission, locking,
  scoring, settlement, notifications), and ten architectural invariants.

**Result:** the repository now has a complete, reviewed, framework-verified
architecture and skeleton for the three-game-mode rebuild, entirely as
not-yet-applied migrations and not-yet-wired-in code — nothing described in this
entry is live. Two genuinely urgent, independent-of-this-rebuild issues remain fully
open on the live project: ISSUE-19 (the cron pipeline has never worked) and ISSUE-20
(a live, unauthenticated read/write exposure on money-adjacent tables), both blocked
in different ways by ISSUE-21 (the ownership split). Milestone 4 (Pick 5
implementation, as the reference implementation for the other two modes) is approved
to begin but has not started, pending a fresh `/checkpoint`-triggered review of this
entry.

---

## 2026-08-03 (4) — Repository hygiene remediation: secrets and browser-profile data removed from git tracking

**Prompted by:** user request to run `/preflight` for repository hygiene ahead of the
repo's first public push, followed by explicit approval to execute the resulting plan.

**What was found (preflight, read-only):** the bootstrap session's own commit,
`c651cf8`, had already committed a root `.env` (containing a live-looking Supabase
service-role key, anon key, and api-football key), both Playwright chrome-profile
directories (`frontend/.chrome-profile/`, `frontend/chrome-profile/`, ~113 MB
combined), a stray empty file (`frontend/src/components/entryBuilder`), a scraped
third-party HTML snapshot (`frontend/whoscored-test.html`), an empty log file
(`frontend/ws-squad-log.txt`), and six Supabase Studio SQL-editor scratch files
(`supabase/snippets/*.sql`) — all because the root `.gitignore` was a 0-byte empty
file. This meant [current-state.md](./current-state.md)'s ISSUE-5 was stating a risk
("must be fixed before the first commit") that had, in fact, already occurred by the
time it was written. No remote was configured (`git remote -v` returned nothing) and
nothing had been pushed, so a full history rewrite tool (BFG/`filter-repo`) wasn't
necessary — a local reset of the single commit was sufficient and far simpler.

**What was done (after approval):**
- `git update-ref -d refs/heads/master` to un-make the repository's only commit,
  leaving every file in place on disk and staged in the index (recoverable at any
  point via the dangling commit object `c651cf8`, until a manual `git gc` is run).
- `git rm --cached` (not `rm`) on `.env`, both chrome-profile directories,
  `frontend/ws-squad-log.txt`, `frontend/whoscored-test.html`,
  `frontend/src/components/entryBuilder`, and `supabase/snippets/` — untracked, kept
  on disk, nothing deleted.
- Replaced the empty root `.gitignore` with a comprehensive one covering env files,
  Node/Vite build output, Playwright/chrome-profile artifacts, logs, Supabase CLI
  local state, editor/OS files, and scratch files.
- Added `.env.example` with the same variable names as `.env` and placeholder values
  only.
- Re-staged everything and confirmed via `git status --short --ignored` that none of
  the excluded paths remain tracked or staged, and that no other secrets exist in any
  tracked file (scanned all tracked files for key/token/password/connection-string
  patterns — only `.env` and a third-party key embedded in the scraped
  `whoscored-test.html` snapshot matched, both now untracked).
- Updated [current-state.md](./current-state.md): moved `ISSUE-5` and `ISSUE-14` to
  [Resolved issues](./current-state.md#resolved-issues) with the full remediation
  detail and a note on the one remaining manual step (`git reflog expire` +
  `git gc --prune=now`, left for the repo owner since it's an irreversible prune).
  Updated the repository snapshot's version-control line accordingly.
- Updated [project-board.md](./project-board.md): moved the `ISSUE-5` card from Ready
  to Done, removed the standalone `ISSUE-14` Backlog card (folded into the same Done
  entry), left `Ready` empty.
- Added a [changelog.md](./changelog.md) entry.
- **No application code was changed** — scope was strictly git tracking, `.gitignore`,
  and documentation.

**Result:** the repository has a single clean local commit with no secrets or
browser-profile data in reachable history, a comprehensive `.gitignore`, and an
`.env.example` for onboarding. Still outstanding before a genuine "ready for GitHub"
sign-off: the manual `git reflog expire`/`git gc` step (irreversible, left for the
user), and the unrelated P0 verification items (`ISSUE-1` through `ISSUE-4`) that
still require live Supabase access.

---

## 2026-08-03 (3) — Project management layer: board, business rules, engineering handbook, /preflight, upgraded /checkpoint

**Prompted by:** user request to add `docs/project-board.md` (Kanban tracker),
`docs/engineering-principles.md` (coding standards handbook), a new `/preflight`
command, an explicitly project-management-capable `/checkpoint`, and
`docs/business-rules.md` (product rules, not implementation).

**What was done:**
- Created `docs/project-board.md` — Kanban board (Backlog/Ready/In
  Progress/Blocked/Testing/Done), populated from `roadmap.md` and
  `current-state.md`'s issue register. Every card links back to an `ISSUE-N` where
  one exists; two P3 items with no issue id (notifications, avatar upload) are
  labeled as net-new features instead. `ISSUE-1` through `ISSUE-4` landed in
  **Blocked** (all need live Supabase access); `ISSUE-5` landed in **Ready** (the one
  P0 item that doesn't); everything else landed in **Backlog**.
- Created `docs/business-rules.md`, covering when picks lock, what counts as a valid
  goal, how scoring works, how ties are resolved, payment rules, admin permissions,
  gameweek lifecycle, and entry eligibility — written as product rules, not
  implementation, per the user's explicit instruction.
- Writing the "How ties are resolved" and "Entry eligibility" sections surfaced two
  facts that couldn't honestly be written as settled rules, because the system
  doesn't actually enforce one:
  - **`ISSUE-17` (new):** `settle-gameweek` ranks by `picks_won` only, with no
    tie-break — added to the issue register under P1, since it affects who gets paid.
  - The existing **`ISSUE-7`** (two pick flows disagree on goalkeeper eligibility)
    was cross-referenced from `business-rules.md` rather than restated.
- Created `docs/engineering-principles.md` as a prescriptive standards handbook
  (folder structure, naming, React/Supabase/SQL conventions, error handling,
  logging, testing, security, performance, documentation and review expectations),
  grounded in the actual codebase and citing existing `ISSUE-N` entries as concrete
  examples of what each rule prevents. Writing the Logging section surfaced a second
  new issue:
  - **`ISSUE-18` (new):** `hooks/useAuth.js` logs the signed-in user's id and email
    to the console on every auth state change — added under P2 (low severity, real
    hygiene violation).
- Updated `current-state.md`: added `ISSUE-17` and `ISSUE-18` to the register, and
  added `project-board.md`, `business-rules.md`, `engineering-principles.md` to the
  "How these documents fit together" table.
- Updated `roadmap.md`: inserted action items for `ISSUE-17` (P1) and `ISSUE-18`
  (P2), renumbering the list's own reading-order numbers accordingly, and added an
  explicit note that this list's numbers are not the same sequence as `ISSUE-N` ids
  and will keep drifting apart — cross-reference by `ISSUE-N` only.
- Fixed one fragile reference in `decisions.md` (a link to "roadmap.md item 10" by
  its bare number) to use a stable section anchor instead, since the renumbering
  above would otherwise have silently broken it.
- Created `.claude/commands/preflight.md` (read-only: read `CLAUDE.md`/
  `current-state.md`/`project-board.md`, check for conflicts with open issues,
  identify affected files/APIs/DB objects, produce a plan, wait for approval).
- Rewrote `.claude/commands/checkpoint.md` to explicitly enumerate the
  project-management responsibilities the user specified (mark resolved issue ids,
  add newly discovered ones, keep `project-board.md` in sync, recommend a single
  highest-priority next task) rather than leaving them implicit in the prior,
  document-focused version.
- Verified all internal cross-document anchor links across all twelve `docs/*.md`
  files still resolve after these changes (same slug-verification approach as the
  prior session).

**Result:** the documentation set now has an explicit work-tracking layer
(`project-board.md`) and two new fixed-reference documents (`business-rules.md`,
`engineering-principles.md`) on top of the existing issue-register/roadmap
structure, plus two genuinely new issues found by the act of trying to write those
documents honestly rather than by a separate audit pass.

---

## 2026-08-03 (2) — Documentation restructure: remove duplication, add cross-references

**Prompted by:** user request to review all nine documents for five-year
maintainability, remove duplication, cross-reference related documents, and split
content by volatility (frequently-changing facts → `current-state.md`/`session-log.md`,
stable facts → elsewhere).

**What was done:**
- Read back all nine files as written in the first pass (below) and identified that
  most non-trivial findings (e.g. the pot-creation RLS conflict, the missing
  `fixture_player_status` table) were independently restated in full — with slightly
  different wording each time — in 4–6 different documents.
- Introduced a single **issue register** in [current-state.md](./current-state.md),
  assigning a stable `ISSUE-N` id to each open bug, gap, or hygiene problem (16 total,
  grouped into the same P0–P3 tiers `roadmap.md` already used). Each issue's evidence,
  mechanism, and verification status now lives in exactly one place.
- Rewrote `architecture.md`, `database.md`, `api.md`, `features.md`, `roadmap.md`, and
  `decisions.md` to reference issues by id (e.g. "see ISSUE-6") instead of
  re-explaining them, while keeping each document's own unique content (structural
  narrative, schema reference, endpoint contracts, feature inventory, the action plan,
  and the historical rationale, respectively) intact and in some cases expanded for
  precision.
- Added a "How these documents fit together" table to `current-state.md` explaining
  which document owns which kind of fact and how often each one should change, so
  future sessions have a rule to apply rather than needing to re-derive the split.
  Added matching "See also" pointers to the top of every other document.
- Added a `Resolved issues` section (currently empty) and a `Verification status`
  table to `current-state.md`, so fixing an issue has a clear place to move it to
  rather than deleting the record, and so "unverified" vs. "confirmed" isn't lost
  over time.
- No application code was changed in this session either.

**Result:** total line count across the nine documents dropped even though several
individual documents (`current-state.md`, `database.md`'s RLS section) gained detail
— the reduction came entirely from removing restatement, not from cutting analysis.

---

## 2026-08-03 (1) — Initial documentation pass

**Goal:** Convert the repo into a documented, "long-term Claude Code project" by
auditing the full codebase and populating `docs/` from scratch (it didn't exist
before this session).

**What was done:**
- Read every migration (`001_initial_schema.sql`, `002_rls_policies.sql`,
  `003_cron_jobs.sql`), the seed file, and `supabase/config.toml`.
- Read all five edge functions (`admin-actions`, `compute-deadlines`, `compute-scores`,
  `settle-gameweek`, `sync-fixtures`) and the shared CORS helper.
- Read the full frontend: `App.jsx`, every hook in `hooks/`, every store, every lib
  module, every page, and the key components involved in pot/pick flows
  (`PickSelector`, `potManager`, `AppShell`, admin table components, `entryBuilder`).
- Skimmed all six standalone Node scripts in `frontend/scripts/` (football-data.org
  syncs and WhoScored scrapers) and `frontend/src/lib/whoScored.js`.
- Checked `.gitignore` (root and frontend), `.env`/`.env.local` contents (keys only,
  values never read or written anywhere), `package.json`, `tailwind.config.js`,
  `vite.config.js`, `eslint.config.js`, and confirmed via `git status`/`git log` that
  this repo has no commit history.
- Created `docs/` and wrote all nine files requested.
- No application code was changed in this session.

**Key findings:** catalogued as ISSUE-1 through ISSUE-16 in
[current-state.md](./current-state.md) after the restructure above — see that file
for the current list rather than this entry, since several of these were re-numbered
and consolidated in the follow-up session.

**Documentation coverage note:** this pass covered the frontend (`frontend/`) and
Supabase project (`supabase/`) exhaustively file-by-file. It did not have access to
the live Supabase dashboard/database, so anywhere these docs say "unverified," that
check has not yet been performed — see
[current-state.md § Verification status](./current-state.md#verification-status).
