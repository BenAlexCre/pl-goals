import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing auth header' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  )

  const { data: userData, error: authError } = await userClient.auth.getUser()
  if (authError || !userData.user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const body = await req.json()
  const { action, pot_id } = body

  const { data: member } = await adminClient
    .from('pot_members')
    .select('role')
    .eq('pot_id', pot_id)
    .eq('user_id', userData.user.id)
    .maybeSingle()

  const isPotAdmin = member?.role === 'admin'
  const isAppAdmin = userData.user.app_metadata?.role === 'app_admin'

  if (!isPotAdmin && !isAppAdmin) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    switch (action) {
      case 'mark_paid': {
        const { user_id, gameweek_id } = body
        await adminClient.from('entry_payments').upsert({
          pot_id,
          user_id,
          gameweek_id,
          is_paid: true,
          marked_by: userData.user.id,
          marked_at: new Date().toISOString(),
        }, { onConflict: 'pot_id,user_id,gameweek_id' })
        break
      }

      case 'mark_unpaid': {
        const { user_id, gameweek_id } = body
        await adminClient.from('entry_payments').upsert({
          pot_id,
          user_id,
          gameweek_id,
          is_paid: false,
          marked_by: userData.user.id,
          marked_at: new Date().toISOString(),
        }, { onConflict: 'pot_id,user_id,gameweek_id' })
        await adminClient.from('user_entries')
          .update({ is_void: true, status: 'void' })
          .eq('pot_id', pot_id)
          .eq('user_id', user_id)
          .eq('gameweek_id', gameweek_id)
        break
      }

      case 'add_member': {
        const { invite_user_id } = body
        await adminClient.from('pot_members').upsert({
          pot_id,
          user_id: invite_user_id,
          role: 'member',
        }, { onConflict: 'pot_id,user_id' })
        break
      }

      case 'remove_member': {
        const { remove_user_id } = body
        await adminClient.from('pot_members')
          .delete()
          .eq('pot_id', pot_id)
          .eq('user_id', remove_user_id)
        break
      }

      default:
        return new Response(JSON.stringify({ error: 'Unknown action' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})