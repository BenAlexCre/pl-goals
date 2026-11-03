// LOCAL ONLY. ISSUE-86 / ISSUE-85 live check against the local stack.
//
// Inside a snapshot/restore boundary:
//   1. nobody is marked paid (the production situation behind ISSUE-86);
//   2. entries in pots WITH a fee are made active again, so settlement has
//      something it SHOULD void — proving settlement really ran;
//   3. the gameweek holding the locked Pick 5 entries is made ready to settle
//      (all fixtures finished), so settle-gameweek actually dispatches.
// Then the real settle-gameweek and compute-scores Edge Functions run.
//
// Passes only if: settlement dispatched (> 0), unmarked entries in pots with a
// fee were voided (> 0), NO entry in a free pot was voided, free pots'
// entry_payments are unchanged, and no Pick 5 pick reads "lost" without a
// finished fixture for its player. The data is then restored and compared.
//
// Usage: node scripts/qa/settlement-live-check.mjs <service-role-key-file>
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const BASE = 'http://127.0.0.1:54321/functions/v1'
if (!BASE.startsWith('http://127.0.0.1')) throw new Error('local only')
const sr = readFileSync(process.argv[2], 'utf8').trim()
const TABLES = ['game_entries', 'entry_payments', 'pick5_picks', 'game_entry_pick5', 'lms_team_picks', 'game_entry_lms',
  'predictor_fixture_picks', 'game_entry_predictor', 'pot_standings_snapshots', 'pot_prizes', 'notifications',
  'gameweeks', 'fixtures']

const psql = (sql) => execFileSync('docker', ['exec', '-i', 'supabase_db_pl-goals', 'psql', '-U', 'supabase_admin', '-h', 'localhost', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA'],
  { input: sql, encoding: 'utf8' }).trim()
const fingerprint = () => psql(TABLES.map((t) => `select '${t}', count(*), coalesce(md5(string_agg(to_jsonb(x)::text, '|' order by to_jsonb(x)::text)), '-') from public.${t} x;`).join('\n'))
// Generated columns (e.g. pot_prizes.net_amount) can't be inserted, so restore uses explicit column lists.
const cols = (t) => psql(`select string_agg(quote_ident(column_name), ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = '${t}' and is_generated <> 'ALWAYS'`)
const restore = () => {
  const lists = Object.fromEntries(TABLES.map((t) => [t, cols(t)]))
  psql('begin; set local session_replication_role = replica;\n' +
    [...TABLES].reverse().map((t) => `delete from public.${t};`).join('\n') + '\n' +
    TABLES.map((t) => `insert into public.${t} (${lists[t]}) select ${lists[t]} from qa_settle.${t};`).join('\n') + '\ncommit;')
}
const call = async (fn) => {
  const res = await fetch(`${BASE}/${fn}`, { method: 'POST', headers: { Authorization: `Bearer ${sr}`, apikey: sr, 'Content-Type': 'application/json' }, body: '{"triggered_by":"qa"}' })
  return { status: res.status, body: await res.json().catch(() => null) }
}
const report = (label) => psql(`
  select '${label}' || ' | ' || case when p.entry_fee = 0 then 'FREE pot' else 'pot WITH fee' end || ' | ' || p.game_type || ' | ' || e.status || ' | ' || count(*)
  from public.game_entries e join public.pots p on p.id = e.pot_id
  group by p.entry_fee = 0, p.game_type, e.status order by 1;`)
const freePayments = () => psql(`select count(*) || ' rows, ' || count(*) filter (where is_paid) || ' paid' from public.entry_payments where pot_id in (select id from public.pots where entry_fee = 0)`)

const before = fingerprint()
psql('drop schema if exists qa_settle cascade; create schema qa_settle;\n' + TABLES.map((t) => `create table qa_settle.${t} as table public.${t};`).join('\n'))
try {
  psql(`
    update public.entry_payments set is_paid = false;
    update public.game_entries e set status = (case when e.gameweek_id is null then 'pending' else 'locked' end)::public.entry_status
      from public.pots p where p.id = e.pot_id and p.entry_fee > 0;
    with gw as (select gameweek_id id from public.game_entries where status = 'locked' and gameweek_id is not null limit 1)
    update public.fixtures set status = 'finished', home_goals = coalesce(home_goals, 0), away_goals = coalesce(away_goals, 0)
      where gameweek_id = (select id from gw);
    with gw as (select gameweek_id id from public.game_entries where status = 'locked' and gameweek_id is not null limit 1)
    update public.gameweeks set status = 'live' where id = (select id from gw);
    -- Migration 048: postpone ONE picked player's fixture (the gameweek stays
    -- ready to settle, because postponed fixtures are excluded from completion).
    update public.fixtures set status = 'postponed' where id = (
      select f.id from public.pick5_picks pk
        join public.game_entries e on e.id = pk.game_entry_id and e.status = 'locked'
        join public.gameweeks g on g.id = e.gameweek_id
        join public.player_team_history h on h.player_id = pk.player_id and h.is_active and h.season_id = g.season_id
        join public.fixtures f on f.gameweek_id = g.id and (f.home_team_id = h.team_id or f.away_team_id = h.team_id)
      order by pk.id limit 1);
    select 1;`)
  const paymentsBefore = freePayments()
  console.log(report('before'))
  // Score first (settled entries are not re-scored), then check the postponed pick.
  const firstScores = await call('compute-scores')
  console.log(`compute-scores (pre-settle) -> HTTP ${firstScores.status}`)
  const postponedPicks = Number(psql(`select count(*) from public.pick5_picks where result = 'postponed'`))
  const postponedWon = Number(psql(`select count(*) from public.pick5_picks pk join public.fixtures f on f.status = 'postponed'
    join public.game_entries e on e.id = pk.game_entry_id join public.gameweeks g on g.id = e.gameweek_id and f.gameweek_id = g.id
    join public.player_team_history h on h.player_id = pk.player_id and h.is_active and h.season_id = g.season_id and (f.home_team_id = h.team_id or f.away_team_id = h.team_id)
    where pk.result in ('won','winning')`))
  console.log(`picks marked "postponed" by the real compute-scores: ${postponedPicks}  (must be > 0)`)
  const settle = await call('settle-gameweek')
  console.log(`settle-gameweek -> HTTP ${settle.status} ${JSON.stringify(settle.body).slice(0, 140)}`)
  const scores = await call('compute-scores')
  console.log(`compute-scores  -> HTTP ${scores.status} ${JSON.stringify(scores.body).slice(0, 140)}`)
  console.log(report('after '))

  const paymentsAfter = freePayments()
  const freeVoided = Number(psql(`select count(*) from public.game_entries e join public.pots p on p.id = e.pot_id
    join qa_settle.game_entries s on s.id = e.id where p.entry_fee = 0 and e.status = 'void' and s.status <> 'void'`))
  const paidPotVoided = Number(psql(`select count(*) from public.game_entries e join public.pots p on p.id = e.pot_id where p.entry_fee > 0 and e.status = 'void'`))
  const prematureLost = Number(psql(`
    select count(*) from public.pick5_picks pk
      join public.game_entries e on e.id = pk.game_entry_id
      join public.gameweeks g on g.id = e.gameweek_id
      join public.player_team_history h on h.player_id = pk.player_id and h.is_active and h.season_id = g.season_id
    where pk.result = 'lost' and not exists (
      select 1 from public.fixtures f where f.gameweek_id = g.id and (f.home_team_id = h.team_id or f.away_team_id = h.team_id) and f.status = 'finished')`))
  const dispatches = settle.body?.gameEngineDispatches ?? 0

  console.log(`settle-gameweek dispatches: ${dispatches}  (must be > 0, or the test proves nothing)`)
  console.log(`unmarked entries in pots WITH a fee voided: ${paidPotVoided}  (must be > 0 — shows settlement ran)`)
  console.log(`entries newly voided in FREE pots: ${freeVoided}  (must be 0)`)
  console.log(`free-pot entry_payments before: ${paymentsBefore}  after: ${paymentsAfter}  (must be identical)`)
  console.log(`Pick 5 picks shown "lost" without a finished fixture: ${prematureLost}  (must be 0)`)
  console.log(`postponed picks counted as wins: ${postponedWon}  (must be 0)`)
  process.exitCode = (firstScores.status === 200 && postponedPicks > 0 && postponedWon === 0 && settle.status === 200 && scores.status === 200 && dispatches > 0 && paidPotVoided > 0 &&
    freeVoided === 0 && paymentsBefore === paymentsAfter && prematureLost === 0) ? 0 : 1
} finally {
  let restored = false
  try { restore(); restored = fingerprint() === before } catch (e) { console.error('restore failed:', e.message.split('\n')[0]) }
  console.log(`local data restored byte-identical: ${restored}`)
  if (restored) psql('drop schema qa_settle cascade;')
  else { console.error('NOT RESTORED — snapshot kept in schema qa_settle'); process.exitCode = 1 }
}
