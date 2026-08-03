import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const sb = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  const { data: run } = await sb
    .from('sync_runs')
    .insert({ job_name: 'compute-scores', triggered_by: 'cron' })
    .select()
    .single()

  let processed = 0

  try {
    const { data: gameweeks } = await sb
      .from('gameweeks')
      .select('id')
      .in('status', ['upcoming', 'live'])

    for (const gw of gameweeks ?? []) {
      const { data: liveFixture } = await sb
        .from('fixtures')
        .select('id')
        .eq('gameweek_id', gw.id)
        .eq('status', 'live')
        .limit(1)

      const isLive = (liveFixture?.length ?? 0) > 0

      const { data: entries } = await sb
        .from('user_entries')
        .select('id, pot_id, user_id')
        .eq('gameweek_id', gw.id)

      for (const entry of entries ?? []) {
        const { data: payment } = await sb
          .from('entry_payments')
          .select('is_paid')
          .eq('pot_id', entry.pot_id)
          .eq('user_id', entry.user_id)
          .eq('gameweek_id', gw.id)
          .maybeSingle()

        if (!payment?.is_paid) {
          await sb.from('user_entries').update({ is_void: true }).eq('id', entry.id)
          await sb.from('user_entry_picks').update({ result: 'void' }).eq('entry_id', entry.id)
          continue
        }

        const { data: picks } = await sb
          .from('user_entry_picks')
          .select('id, player_id, goal_threshold')
          .eq('entry_id', entry.id)

        let won = 0

        for (const pick of picks ?? []) {
          const { data: goals } = await sb
            .from('player_fixture_goals')
            .select('goals')
            .eq('player_id', pick.player_id)
            .eq('gameweek_id', gw.id)

          const totalGoals = (goals ?? []).reduce((sum, g) => sum + (g.goals ?? 0), 0)
          const met = totalGoals >= pick.goal_threshold

          const result = met ? (isLive ? 'winning' : 'won') : (isLive ? 'losing' : 'lost')
          if (met) won++

          await sb.from('user_entry_picks').update({
            goals_scored: totalGoals,
            result,
          }).eq('id', pick.id)

          processed++
        }

        await sb.from('user_entries').update({
          picks_won: won,
          status: isLive ? 'locked' : 'settled',
          is_void: false,
        }).eq('id', entry.id)
      }
    }

    await sb.from('sync_runs').update({
      status: 'success',
      finished_at: new Date().toISOString(),
      records_processed: processed,
    }).eq('id', run.id)

    return new Response(JSON.stringify({ success: true, processed }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    await sb.from('sync_runs').update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      errors: { message: error.message },
    }).eq('id', run.id)

    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})