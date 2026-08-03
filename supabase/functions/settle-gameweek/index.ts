import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const sb = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  const body = await req.json().catch(() => ({}))
  const targetGameweek = body.gameweek_id ?? null

  let query = sb.from('gameweeks').select('id').neq('status', 'completed')
  if (targetGameweek) query = query.eq('id', targetGameweek)

  const { data: gameweeks } = await query

  for (const gw of gameweeks ?? []) {
    const { data: fixtures } = await sb
      .from('fixtures')
      .select('status')
      .eq('gameweek_id', gw.id)
      .not('status', 'in', '("postponed","cancelled")')

    if (!fixtures?.length) continue
    if (!fixtures.every((f) => f.status === 'finished')) continue

    await sb.from('user_entries')
      .update({ status: 'settled', settled_at: new Date().toISOString() })
      .eq('gameweek_id', gw.id)
      .neq('status', 'void')

    await sb.from('gameweeks')
      .update({ status: 'completed', is_current: false })
      .eq('id', gw.id)

    const { data: potIds } = await sb
      .from('user_entries')
      .select('pot_id')
      .eq('gameweek_id', gw.id)

    const uniquePotIds = [...new Set((potIds ?? []).map((r) => r.pot_id))]

    for (const potId of uniquePotIds) {
      const { data: rows } = await sb
        .from('user_entries')
        .select('user_id, picks_won, picks_total, is_void')
        .eq('pot_id', potId)
        .eq('gameweek_id', gw.id)
        .order('picks_won', { ascending: false })

      const sorted = [...(rows ?? [])]
        .filter((r) => !r.is_void)
        .sort((a, b) => b.picks_won - a.picks_won)

      for (let i = 0; i < sorted.length; i++) {
        const row = sorted[i]
        await sb.from('leaderboard_snapshots').upsert({
          pot_id: potId,
          gameweek_id: gw.id,
          user_id: row.user_id,
          rank: i + 1,
          picks_won: row.picks_won,
          picks_total: row.picks_total,
          entries_count: 1,
          strike_rate: row.picks_total > 0 ? Number(((row.picks_won / row.picks_total) * 100).toFixed(2)) : 0,
          is_overall: false,
          is_void: row.is_void,
        }, { onConflict: 'pot_id,gameweek_id,user_id' })
      }
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})   