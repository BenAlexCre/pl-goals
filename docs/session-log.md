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
