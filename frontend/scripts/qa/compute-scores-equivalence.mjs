// LOCAL ONLY. ISSUE-83 equivalence + idempotency test for compute-scores.
//
// 1. Snapshot every table the scoring engines write (into a scratch schema).
// 2. Run compute-scores with {full_scan:true} (old behaviour: dispatch every
//    upcoming/live gameweek) and fingerprint the scoring tables.
// 3. Restore the snapshot, run the default (selective) path, fingerprint.
// 4. Run the default path again and fingerprint (idempotency).
// Passes only if all three fingerprints are identical. updated_at columns are
// excluded (bumped by triggers on every upsert, by design).
//
// Usage: node scripts/qa/compute-scores-equivalence.mjs <service-role-key-file>
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const FN_URL = 'http://127.0.0.1:54321/functions/v1/compute-scores'
const DB_CONTAINER = 'supabase_db_pl-goals'
if (!FN_URL.startsWith('http://127.0.0.1')) throw new Error('local only')
const sr = readFileSync(process.argv[2], 'utf8').trim()

// gameweeks is snapshotted too: the scenario below edits deadlines.
const TABLES = ['gameweeks', 'pick5_picks', 'game_entry_pick5', 'lms_team_picks', 'game_entry_lms',
  'predictor_fixture_picks', 'game_entry_predictor', 'game_entries']

// supabase_admin: restoring with triggers disabled needs session_replication_role.
const psql = (sql) => execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'supabase_admin', '-h', 'localhost', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA'],
  { input: sql, encoding: 'utf8' }).trim()

const fingerprint = () => psql(TABLES.map((t) =>
  `select '${t}', count(*), coalesce(md5(string_agg((to_jsonb(x) - 'updated_at')::text, '|' order by (to_jsonb(x)->>'id'))), '-') from public.${t} x;`).join('\n'))

async function invoke(body) {
  const t0 = Date.now()
  const res = await fetch(FN_URL, { method: 'POST', headers: { Authorization: `Bearer ${sr}`, apikey: sr, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json()
  if (!res.ok || !json.success) throw new Error(`compute-scores failed: ${res.status} ${JSON.stringify(json)}`)
  return { ms: Date.now() - t0, ...json }
}

const snapshot = () => psql(`drop schema if exists qa_snapshot cascade; create schema qa_snapshot;\n` +
  TABLES.map((t) => `create table qa_snapshot.${t} as table public.${t};`).join('\n'))
// Restore with triggers disabled so restoring doesn't itself fire scoring side effects.
const restore = () => psql(`begin; set local session_replication_role = replica;\n` +
  [...TABLES].reverse().map((t) => `delete from public.${t};`).join('\n') + '\n' +
  TABLES.map((t) => `insert into public.${t} select * from qa_snapshot.${t};`).join('\n') + '\ncommit;')

// Production shape (2026-11-02): most upcoming gameweeks have FUTURE deadlines
// and no activity. Local seed data has NULL deadlines instead, which the
// selector never skips — so build the production shape inside the snapshot
// boundary: future deadlines for those gameweeks, plus the riskiest case — a
// gameweek WITH locked Pick 5 entries given a future deadline (must still be
// scored). Restored afterwards.
// A fixed base time (not now()) so re-applying the scenario after a restore is
// byte-identical — otherwise the fingerprints could never match.
const BASE = new Date(Date.now() + 60 * 60 * 1000).toISOString()
const scenario = () => psql(`
  update public.gameweeks g set deadline_utc = '${BASE}'::timestamptz + (interval '7 days' * x.rn)
  from (select id, row_number() over (order by id) rn from public.gameweeks
        where status in ('upcoming','live') and deadline_utc is null) x where x.id = g.id;
  update public.gameweeks set deadline_utc = '${BASE}'::timestamptz + interval '2 days'
  where id = (select gameweek_id from public.game_entries where status = 'locked' and gameweek_id is not null
              group by gameweek_id order by count(*) desc limit 1);
  -- Stale scores: without these, an already-converged state would hide a wrongly
  -- skipped gameweek (nothing to write either way). Every computed column is reset,
  -- so the full scan has real work and the selective path must reproduce it exactly.
  update public.pick5_picks set goals_scored = 0, result = 'pending';
  update public.game_entry_pick5 set picks_won = 0;
  update public.lms_team_picks set result = 'pending';
  update public.game_entry_lms set competitive_status = 'alive', eliminated_gameweek_id = null;
  update public.predictor_fixture_picks set points_awarded = null, is_exact_score = false, scorer_bonus_awarded = false;
  update public.game_entry_predictor set total_points = 0, exact_score_count = 0, correct_scorer_count = 0;
  select 'scenario: future-deadline gws=' || count(*) filter (where deadline_utc > now()) ||
         ', of which with locked entries=' || count(*) filter (where deadline_utc > now() and id in (select gameweek_id from public.game_entries where status='locked'))
  from public.gameweeks where status in ('upcoming','live');`)

snapshot()
console.log(scenario())
const before = fingerprint()
let restoredOk = false
try {
  const full = await invoke({ triggered_by: 'qa', full_scan: true })
  const fpFull = fingerprint()
  restore(); scenario()
  if (fingerprint() !== before) throw new Error('restore did not reproduce the starting state')
  const sel = await invoke({ triggered_by: 'qa' })
  const fpSel = fingerprint()
  const sel2 = await invoke({ triggered_by: 'qa' })
  const fpSel2 = fingerprint()

  console.log(`full scan : ${full.gameEngineDispatches} dispatches, ${full.ms} ms`)
  console.log(`selective : ${sel.gameEngineDispatches} dispatches (${sel.gameweeksSkipped}/${sel.gameweeksConsidered} gameweeks skipped), ${sel.ms} ms`)
  console.log(`selective again (idempotency): ${sel2.gameEngineDispatches} dispatches, ${sel2.ms} ms`)
  const changed = fpFull !== before
  console.log(`scoring state changed by the full scan: ${changed ? 'yes' : 'NO — test is not meaningful'}`)
  const equivalent = fpFull === fpSel
  const idempotent = fpSel === fpSel2
  console.log(`EQUIVALENT (full == selective): ${equivalent}`)
  console.log(`IDEMPOTENT (selective == selective again): ${idempotent}`)
  if (!equivalent) { console.log('--- full\n' + fpFull + '\n--- selective\n' + fpSel) }
  process.exitCode = equivalent && idempotent && changed ? 0 : 1
  restore(); restoredOk = true
  console.log('local data restored to its pre-test state')
} finally {
  // Keep the snapshot if restoring failed, so the data can be recovered by hand.
  if (restoredOk) psql('drop schema if exists qa_snapshot cascade;')
  else console.error('NOT RESTORED — snapshot kept in schema qa_snapshot')
}
