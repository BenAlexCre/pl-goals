# Deployment Checklist — ISSUE-19 / ISSUE-20 / ISSUE-21

Last reviewed: 2026-08-03. Status: **not yet executed** — this is the plan, approved
with one architectural change from the original remediation plan: prototype objects
are isolated, not deleted, until the production schema is deployed and verified.
Deletion is the final cleanup step, not the first deployment step.

See also: [current-state.md](./current-state.md) (ISSUE-19/20/21), [game-engine.md](./game-engine.md)
(what `004`/`005` implement), [schema-review.md](./schema-review.md) (why `004`/`005`
look the way they do), `session-log.md` (the original remediation plan this refines).

## Key finding that shapes this checklist

Checked every object `004_game_engine_shared_platform.sql` creates against every
prototype object's exact name. **Only two objects collide**: the `game_type` and
`predictor_cycle_mode` enum types (both `supabase_admin`-owned). None of the 7
prototype tables, the 11 functions, or `gameweek_deadline_debug` share a name with
anything the new migration creates — `pot_prizes` ≠ `gameweek_pots`,
`game_entries` ≠ `lms_entries`/`predictor_entries`, `lms_competitive_status` (the new
type) was deliberately named to avoid colliding with the prototype's `lms_status`.
This means isolating the prototype, rather than deleting it, is cheap: only the two
colliding enum types need to move out of the way for `004`/`005` to apply. Everything
else can simply be left alone until final cleanup — it doesn't block anything.

## Phase 0 — Pre-flight

- [ ] Re-run the live verification queries from the remediation plan (RLS status on
      the 7 tables, cron job status, ownership of `pots`/`gameweek_pots`/`settle_gameweek`)
      immediately before starting, to confirm nothing has changed since this checklist
      was written.
- [ ] Confirm `supabase/migrations/004_game_engine_shared_platform.sql` and `005_*_rls.sql`
      are the reviewed, approved versions (match `schema-review.md`'s applied findings).
- [ ] Obtain the production project's `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
      from a safe source (Supabase Dashboard → Settings → API) — **not** from `.env`/
      `frontend/.env.local`, which currently point at the local dev stack, not
      production. Do not paste the service-role key into chat; either run the
      commands below yourself or provide it through a channel that isn't logged in
      this conversation.
- [ ] Confirm the repo's git working tree is clean and this checklist itself is
      committed before any live change is made, so there's a fixed reference point.

## Phase 1 — ISSUE-19 (independent of everything else; do this regardless of Phase 2+ timing)

- [ ] `alter database postgres set app.settings.supabase_url = '<production URL>';`
- [ ] `alter database postgres set app.settings.service_role_key = '<production service role key>';`
- [ ] `select cron.unschedule('sync-live-events-every-5-min');` (redundant, differently-broken duplicate of job 2 — remove rather than fix)
- [ ] **Verify:** `select current_setting('app.settings.supabase_url'), current_setting('app.settings.service_role_key') is not null;` — no longer errors.
- [ ] **Verify:** wait for the next tick of `compute-deadlines-hourly` / `compute-scores-every-3-min` / `settle-gameweek-every-30-min`, then check `cron.job_run_details` — `status = 'succeeded'`.
- [ ] **Verify:** manually invoke `sync-fixtures` (`POST /functions/v1/sync-fixtures` with a service-role bearer token) rather than waiting for its daily 05:00 UTC slot; check the response and the resulting `sync_runs` row.
- [ ] **Rollback if needed:** `alter database postgres reset app.settings.supabase_url; alter database postgres reset app.settings.service_role_key;` — instant, no data implications.

### Phase 1b — the third ISSUE-19 layer, found after Phase 1 (independent of everything else, including Phase 2+)

- [x] Apply `006_fix_cron_job_headers.sql` — adds the `apikey` header Kong requires, to the 5 jobs that call an Edge Function. **Applied 2026-08-03.**
- [x] **Verify:** `compute-scores-every-3-min` confirmed `200` on its first post-fix run (`net._http_response`). `sync-live-events-every-2-min` confirmed `404` (ISSUE-4, expected). `compute-deadlines-hourly`/`settle-gameweek-every-30-min` rescheduled identically, awaiting their next tick to independently confirm. `sync-fixtures-daily` awaits its 05:00 UTC slot.
- [ ] **Partial miss, folded into Track B:** the redundant `sync-live-events-every-5-min` duplicate was **not** removed — it's `supabase_admin`-owned (confirmed via `cron.job.username`), so `postgres` couldn't unschedule it. Still failing on its own pre-existing Vault error every 5 minutes; low severity, no data/security impact. Remove it as part of Track B, not as a separate action.
- [ ] **Rollback if needed:** re-run the equivalent `cron.unschedule`/`cron.schedule` pairs from `003_cron_jobs.sql`'s original definitions (Authorization-only headers) — reverts to the pre-`006` behavior, same low-risk, instantly-reversible shape as Phase 1 itself.

## Phase 2 — ISSUE-20 immediate stopgap (parallel to Phase 1; does not conflict with "don't delete yet")

Enabling RLS is protection, not deletion — fully consistent with the "isolate, don't
remove" instruction, and closes the live exposure without waiting on anything else in
this checklist.

- [ ] Attempt, via the Supabase Dashboard's Table Editor, to enable RLS on the 7
      exposed tables (`fixture_player_status`, `gameweek_pots`, `lms_entries`,
      `lms_picks`, `predictor_entries`, `predictor_picks`,
      `whoscored_fixture_map_staging`). If the Table Editor's RLS toggle is reachable,
      use it — no policies need to be added yet (RLS-enabled-with-zero-policies is a
      safe default-deny, strictly better than RLS-disabled).
- [ ] **Verify:** `select relname, relrowsecurity from pg_class where relname in (<the 7 names>);` — all `true`.
- [ ] **Verify:** re-check `information_schema.role_table_grants` for `anon`/`authenticated` on these tables — the grants will likely still show (RLS doesn't remove grants, it gates them), but with RLS on and no policies, `anon`/`authenticated` can no longer read or write any row. Confirm this holds by attempting a read as the anon role if practical.
- [ ] If the Table Editor's RLS toggle isn't reachable within a few minutes, don't chase it further — move on; Phase 5's migration deploy closes this permanently regardless.

## Phase 3 — Backup every prototype object (schema only, before touching anything in Phase 4)

**Not formally performed as a separate step.** Phase 4 turned out to only need the
two enum type renames (reversible by design, not a destructive operation) and 4
column drops on already-default values (also fully reconstructable from this
file's Phase 4 rollback notes) — neither genuinely needed a backup file to be safe.
**Still applies in full to Phase 8**, which is a real deletion of the 7 tables/11
functions/1 view — do not skip Phase 3 when Phase 8 is actually executed.

- [ ] Generate a schema-only reference file covering: all 7 tables' column definitions, all 11 functions' full `pg_get_functiondef()` output, the `gameweek_deadline_debug` view definition, and the 4 enum types' labels. (All of this data was already captured during this session's investigation and can be reconstructed from it plus a fresh live re-check — no data rows exist to back up, every table is confirmed empty.)
- [ ] Save it to `docs/archive/prototype-schema-backup-2026-08-03.sql`, clearly headed as reference-only, never to be applied as a migration.
- [ ] **Verify:** the file exists, is non-empty, and covers all 19 objects (7 tables + 11 functions + 1 view + 4 types is 23 — wait, cross-check the exact count against the live objects at execution time rather than trusting this number blind).

## Phase 4 — Isolate the two colliding objects (the only ones that block deployment)

**Completed, 2026-08-03.** Track B done via the Supabase Dashboard (types renamed
to `*_prototype_deprecated`); Track A done immediately after via SQL (4 columns
dropped, zero data loss, confirmed). Both verified live.

**Confirmed by a real execution attempt (2026-08-03): Track A and Track B below
CANNOT be combined into one transaction.** The original version of this checklist
presented all six changes as a single `begin`/`commit` block; running it failed
immediately on the first statement (`must be owner of type game_type`) and rolled
back everything, including the four column drops that would otherwise have
succeeded on their own. Run them as two separate operations.

**Track B — needs Dashboard/support privilege, do this first:**
- [ ] Rename (via whichever Dashboard/SQL path actually has the privilege — try SQL Editor first since it's zero-effort, then the Table Editor / Database Types page, then a support request if neither works) the prototype's `game_type` enum type to `game_type_prototype_deprecated`.
- [ ] Rename the prototype's `predictor_cycle_mode` enum type to `predictor_cycle_mode_prototype_deprecated`.
- [ ] **Verify:** `select typname from pg_type where typname in ('game_type', 'predictor_cycle_mode');` returns nothing (both renamed away).

**Track A — plain `postgres`-privileged, run only after Track B succeeds** (the
column drops don't strictly require the types to be renamed first, but doing them
in this order means `pots` never sits in a half-migrated state if Track B stalls):
```sql
alter table public.pots
  drop column game_type,
  drop column entry_fee,
  drop column end_gameweek_id,
  drop column predictor_cycle_mode;
```
- [ ] **Verify:** `\d pots` no longer shows the 4 dropped columns.

- [ ] Everything else — the 7 tables, 11 functions, the debug view — is left exactly as-is. They don't block `004`/`005` and aren't touched in this phase.

## Phase 5 — Apply the production migrations

**Completed, 2026-08-03.**

- [x] Apply `004_game_engine_shared_platform.sql`. — Applied, zero errors across every statement.
- [x] Apply `005_game_engine_shared_platform_rls.sql`. — Applied, zero errors across every statement.
- [x] **Verify — no errors:** confirmed, no "already exists"/"must be owner" errors.

## Phase 6 — Verify: production schema, RLS, ownership, cron, Game Engine compatibility

- [x] **Schema:** all 7 new tables confirmed present with correct columns/constraints.
- [x] **RLS:** all 7 new tables `relrowsecurity = true`; 10 policies present, matching `005` exactly.
- [x] **Ownership:** all 7 new tables + the 3 relevant functions confirmed `postgres`-owned.
- [x] **Cron:** re-confirmed `app.settings.supabase_url` still `http://kong:8000` post-migration — no regression.
- [x] **Game Engine compatibility:** verified field-by-field against the live schema — `Pot`, `GameEntry`, `StandingsRow`, `NotificationEvent` all match exactly (correct columns, correct nullability, `GameEntry` correctly has no `settled` boolean). No changes needed to `types.ts`.
- [x] Existing table row counts confirmed unchanged: `pots`=2, `pot_members`=1, `entry_payments`=1, `user_entries`=1, `user_entry_picks`=5.

## Phase 7 — Run `/drift`

- [ ] Run `/drift`.
- [ ] Confirm the only remaining drift is **expected**: the still-present, still-isolated prototype objects (7 tables, 11 functions, 1 view, the 2 renamed-and-deprecated types), which are known, tracked, and intentionally not yet removed. Any *other* drift — a new table, a changed policy, a new function — is a red flag and must be understood before proceeding to Phase 8, not dismissed as noise.

## Phase 8 — Final cleanup: remove the isolated prototype objects

Only after Phase 6 and Phase 7 are both clean.

- [ ] Drop the 7 renamed-away/isolated prototype tables.
- [ ] Drop the 11 prototype functions.
- [ ] Drop `gameweek_deadline_debug`.
- [ ] Drop `game_type_prototype_deprecated`, `predictor_cycle_mode_prototype_deprecated`, and the two non-colliding prototype types (`lms_status`, `player_match_status`), now unreferenced.
- [ ] **Verify:** `select count(*) from pg_tables where schemaname='public' and tablename in (<the 7 original names>);` → 0. Same pattern for functions and types.
- [ ] Run `/drift` once more — should now show materially less drift than Phase 7 (the prototype's footprint is gone), with only whatever pre-existing, out-of-scope drift items were already known (handle_new_user() behavior, provider_name defaults, duplicate RLS policies on the original 16 tables, etc. — none of which are in scope for ISSUE-19/20/21).

## Rollback plan, by phase

| Phase | Rollback |
|---|---|
| 1 (ISSUE-19) | `alter database postgres reset app.settings.*` — instant |
| 2 (RLS stopgap) | `alter table <t> disable row level security;` — reverts to prior (insecure) state; only do this if the toggle caused an unexpected app-breaking issue, and re-enable as soon as that's diagnosed |
| 3 (backup) | No rollback needed — read-only |
| 4 (isolate) | Rename the types back; re-add the 4 `pots` columns with their original defaults (values are recoverable — both rows were confirmed at-default) |
| 5 (apply migrations) | Each migration file runs as a single transaction (neither uses `CREATE INDEX CONCURRENTLY` or anything else that can't be transactional) — a failure mid-file rolls back automatically, no manual step needed. If a problem is found *after* successful apply, roll back by hand: drop everything `004`/`005` created, then reverse Phase 4 |
| 6–7 (verification) | No rollback — these phases don't change anything, only inspect |
| 8 (final cleanup) | This is the one genuinely hard-to-reverse phase — the backup from Phase 3 is the rollback path. This is exactly why it's last, gated behind two full rounds of verification, not first |

## Post-deployment validation (after Phase 8, before declaring this done)

- [ ] All three issues' verification checklists (above) pass.
- [ ] `/drift` is clean of anything beyond already-known, out-of-scope items.
- [ ] `current-state.md` updated: ISSUE-19/20/21 moved to Resolved with dates and evidence.
- [ ] `project-board.md` updated: the three issues moved out of Blocked.
- [ ] A `/checkpoint` run to capture the deployment itself in `session-log.md` and generate a commit message for the migration application (note: applying a migration to the live database isn't a git change by itself — the migration files are already committed; this checkpoint documents that they're now *applied*, which is a fact about the live project, not the repo).

## Milestone 4

Does not begin until every box above is checked and Phase 8's post-deployment
validation is clean. Not started yet.
