---
description: Complete platform health check before starting a development session (read-only)
allowed-tools: Read, Glob, Grep, Bash
---

# /health

Purpose

Run before starting any development session, or any time the platform's state is in
doubt. Read-only — never fixes anything itself, only reports.

Check

Docker containers — every `*_pl-goals` container's status; flag anything not `Up`/
`healthy` other than the known, non-blocking `vector`/analytics restart loop
(documented Windows/Docker-Desktop limitation).

Supabase status — `supabase status`; confirm every service the project actually
depends on is reachable (Studio, REST, Auth, Storage, Edge Functions).

PostgreSQL — connect and confirm `postgres` owns the database it's connecting to;
confirm the two `app.settings.*` GUCs are set and non-empty; do not assume a prior
session's fix is still in effect — this is a fresh check every time.

Kong — confirm `/functions/v1/*` actually routes correctly with the headers the
project's own cron jobs send today, not just with a manually-correct request. A
request that only succeeds with headers the cron jobs don't actually send is not
a passing check.

Edge Runtime — confirm the container is up and at least one known function
responds (a 401/200, not a connection error).

Cron jobs — every job in `cron.job`: name, schedule, most recent
`cron.job_run_details` status. Also check `net._http_response` for the same
recent window — a cron job reporting `succeeded` only proves the SQL statement
didn't error, not that the downstream HTTP call actually reached anything; check
both.

RLS — every table in `public`: `relrowsecurity`, and whether it has at least one
policy. A table with RLS enabled and zero policies is a silent full lockout; a
table with RLS disabled is a silent full exposure. Flag both explicitly, don't
conflate them.

MCP connectivity — confirm the Postgres MCP connection resolves to the database
this session actually intends to work against (never assume; a wrong assumption
here has already cost a full session's worth of re-verification once — see
`session-log.md`).

Git status — clean or dirty; ahead/behind the tracked remote branch; any untracked
files that look like they should be committed or gitignored.

Outstanding blockers — cross-reference `current-state.md`'s open `ISSUE-N`
register and `project-board.md`'s Blocked column; list what's still open.

Output format

```
Platform Health

Infrastructure: <✅|⚠️|❌>
Database: <✅|⚠️|❌>
Edge Runtime: <✅|⚠️|❌>
Cron: <✅|⚠️|❌>
Security: <✅|⚠️|❌>
Architecture: <✅|⚠️|❌>
Docs: <✅|⚠️|❌>
Git: <Clean|Dirty — N files>

<one line per ⚠️/❌ item, naming the exact finding, not just the category>

Recommended next task: <the single highest-priority item, referencing an ISSUE-N
or milestone/slice where one exists>
```

Do not modify anything. Do not start or stop containers, change configuration, or
apply migrations — this command observes and reports. If something's broken, that's
a finding for this report, not a task for this command to fix.
