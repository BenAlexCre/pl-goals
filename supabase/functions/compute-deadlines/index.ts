import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const sb = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  const { data: gws } = await sb.from('gameweeks').select('id').in('status', ['upcoming', 'live'])
  let updated = 0

  for (const gw of gws ?? []) {
    const { data: fixtures } = await sb
      .from('fixtures')
      .select('kickoff_utc')
      .eq('gameweek_id', gw.id)
      .not('status', 'in', '("postponed","cancelled")')

    if (!fixtures?.length) continue

    const earliest = new Date(Math.min(...fixtures.map((f) => new Date(f.kickoff_utc).getTime())))
    const deadline = new Date(earliest.getTime() - 30 * 60 * 1000)

    await sb.from('gameweeks').update({
      earliest_kickoff_utc: earliest.toISOString(),
      deadline_utc: deadline.toISOString(),
    }).eq('id', gw.id)

    updated++
  }

  return new Response(JSON.stringify({ success: true, updated }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})