# Changelog

This is the record of **what shipped** — features, fixes, migrations — with a date.
For the record of *what happened in a work session* (including investigation that
didn't result in a shipped change), see [session-log.md](./session-log.md). For the
current status of any bug or gap mentioned below, see
[current-state.md](./current-state.md) — an entry here is a historical fact ("this
was fixed on this date") and won't be updated retroactively if the fix later regresses;
that would be a new entry.

This changelog starts from 2026-08-03, when this documentation set was created. There
is no earlier changelog to backfill: the repository has no git history at all
([current-state.md ISSUE-5](./current-state.md#issue-5--repository-has-no-git-history-secrets-arent-excluded-from-version-control)),
so there is no commit log, no tags, and no prior release notes to reconstruct entries
from. Everything before this date is undated, un-versioned "current state" — described
in [current-state.md](./current-state.md) and [features.md](./features.md) rather
than as changelog entries, because there's no reliable way to say *when* any given
feature was added or by whom.

From this point forward, add an entry here whenever a significant feature ships, a
bug is fixed, or a schema migration is applied — per `CLAUDE.md`'s instruction to keep
documentation current. Suggested format:

```
## YYYY-MM-DD
- Added/Changed/Fixed: <what>, in <file(s)/migration>. Why, if not obvious.
  If this closes an ISSUE-N, move it to current-state.md's Resolved issues section
  and reference the commit/PR here.
```

---

## 2026-08-03 (2)
- Fixed: repository hygiene — the repo's only commit had already committed a
  root `.env` (Supabase service-role key, anon key, api-football key) and two
  Playwright chrome-profile directories, because the root `.gitignore` was empty.
  Since no remote existed and nothing had been pushed, the fix was a local history
  reset (`git update-ref -d`, not a filter-branch/BFG rewrite) followed by a clean
  re-commit with these paths untracked (kept on disk, not deleted) and excluded by a
  new, comprehensive root `.gitignore`. Closes `ISSUE-5` and `ISSUE-14` — see
  [current-state.md § Resolved issues](./current-state.md#resolved-issues).
- Added: `.env.example` documenting every required environment variable name with a
  placeholder value, no real secrets.
- No application code was changed.

## 2026-08-03 (1)
- Added: full documentation set under `docs/` (`architecture.md`, `current-state.md`,
  `database.md`, `api.md`, `features.md`, `roadmap.md`, `decisions.md`, this file, and
  `session-log.md`), created by auditing the existing frontend, edge functions, and
  migrations from scratch. No application code was changed in this pass. Sixteen open
  issues were catalogued in [current-state.md](./current-state.md) (ISSUE-1 through
  ISSUE-16), including several likely bugs that should be triaged next — see
  [roadmap.md](./roadmap.md) for the prioritized plan.
- Changed: reorganized the initial draft of these same nine documents to remove
  duplication — each fact now has exactly one canonical home (mostly
  [current-state.md](./current-state.md) for anything that can change without a code
  change) and every other document cross-references it by `ISSUE-N` id instead of
  restating it. See [session-log.md](./session-log.md) for what prompted this pass.
- Added: `docs/project-board.md` (Kanban work tracker, cards reference `ISSUE-N`),
  `docs/business-rules.md` (product rules, not implementation), and
  `docs/engineering-principles.md` (coding standards handbook) — plus a new
  `.claude/commands/preflight.md` and an upgraded `.claude/commands/checkpoint.md`
  with explicit project-management responsibilities (mark resolved issues, add
  newly discovered ones, keep the board in sync). Two new issues were found while
  writing `business-rules.md`/`engineering-principles.md` and added to
  [current-state.md](./current-state.md)'s register: `ISSUE-17` (leaderboard has no
  tie-break rule) and `ISSUE-18` (`useAuth.js` logs the user's email to the
  console). No application code was changed. See
  [session-log.md](./session-log.md#2026-08-03-3--project-management-layer-board-business-rules-engineering-handbook-preflight-upgraded-checkpoint)
  for the full breakdown.
