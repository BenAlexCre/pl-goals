---
description: Mandatory pre-release check — compare live PostgreSQL, migrations, and documentation; report drift by category (read-only)
allowed-tools: Read, Glob, Grep, Bash
---

# /drift

Purpose

Run before every release. Nothing ships on an assumption about the state of the
database that hasn't been checked against the database itself.

Compare, three-way

Live PostgreSQL (tables, columns, enums, views, materialized views, functions,
triggers, RLS policies, indexes, extensions, grants)

against

`supabase/migrations/` (what the repo believes exists)

against

`docs/` (what's described as current — `database.md`, `api.md`, `architecture.md`,
`current-state.md`, `business-rules.md`)

Report, in this order, one section per category, every section present even if empty:

Schema Drift
Tables, columns, enums, or indexes present live but absent from migrations, or
declared in migrations but absent live.

Documentation Drift
Facts stated in `docs/` that live evidence contradicts, or that the migrations no
longer support.

Policy Drift
RLS policies present live but not in migrations, or vice versa. Duplicate or
overlapping policies on the same table and operation. A policy whose logic has
diverged from what a sibling table's equivalent policy does.

Function Drift
Functions present live but not in migrations, or vice versa. A live function
definition that no longer matches its migration's definition. A function that
references a table, column, or other function that doesn't exist.

Trigger Drift
Triggers present live but not in migrations, or vice versa. A trigger attached to a
table or function whose shape has since changed.

Migration Drift
Whether `supabase/migrations/`, applied in order on an empty database, would actually
produce the live schema. Any gap that means the migration history can no longer be
trusted as the source of truth.

RLS Drift
A table with RLS disabled that the migrations expect enabled, or vice versa.
Anonymous or authenticated grants inconsistent with the intended access model. A
table with RLS enabled but zero policies (silent full lockout). A table with RLS
disabled and open grants (silent full exposure).

For every item found

State the object name, what's live, what's expected (migration and/or doc), and flag
which side you'd treat as authoritative until a human overrides it. Do not assume the
live database is wrong. Do not assume the repo is wrong. State the discrepancy and
let the user decide — this command reports, it does not resolve.

If a category has nothing to report, say so explicitly. Do not omit the section.

Do not modify the database.
Do not modify migrations.
Do not modify documentation.
Do not generate migrations.

If any category is non-empty, stop. That is the signal to the user that a release
decision is needed — reconcile now, or explicitly accept the drift and ship anyway.
Never proceed to `/release` on your own judgement.
