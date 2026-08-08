import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { classifyBulkPaymentRows, type BulkPaymentRow } from './bulkPayments.ts'

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

  // Production hardening sprint, 2026-08-06: a malformed/empty body used to
  // throw here uncaught, surfacing as a bare 500 with no error detail
  // (verified live). Falling back to {} lets the existing
  // authorization/action-switch logic below handle it the same way it
  // already handles any other missing-field request (403/400), rather than
  // crashing before ever reaching that logic.
  const body = await req.json().catch(() => ({}))
  const { action, pot_id } = body
  const isAppAdmin = userData.user.app_metadata?.role === 'app_admin'

  // bulk_verify_payments can span more than one pot (a CSV import isn't
  // scoped to a single pot_id the way every other action is), so it can't
  // use the single-pot_id gate below — it does its own per-resolved-pot
  // authorization instead, inside handleBulkVerifyPayments(). Every other
  // action's behavior below is unchanged.
  if (action === 'bulk_verify_payments') {
    try {
      const result = await handleBulkVerifyPayments(adminClient, userData.user.id, isAppAdmin, body)
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
  }

  const { data: member } = await adminClient
    .from('pot_members')
    .select('role')
    .eq('pot_id', pot_id)
    .eq('user_id', userData.user.id)
    .maybeSingle()

  const isPotAdmin = member?.role === 'admin'

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
    // Pre-existing `error.message` here didn't type-check under strict mode
    // (`error` is `unknown` in a catch clause) — this file was never run
    // through `deno check` before this change. Fixed minimally, same
    // pattern already used in compute-deadlines/compute-scores, so this
    // file's own new code can be verified cleanly; not a behavior change.
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

// business-rules.md § Payment verification rules: validate every row before
// touching any data, preview every change, report every error up front,
// apply only confirmed rows, never partially import without confirmation.
// dry_run: true (the default) does every resolution/validation step and
// returns the same result shape a real apply would, without writing
// anything — that's the preview. The caller re-invokes with dry_run: false,
// normally with the exact same rows the preview was shown for, to apply.
async function handleBulkVerifyPayments(
  adminClient: SupabaseClient,
  callerId: string,
  isAppAdmin: boolean,
  body: { gameweek_id?: number; rows?: BulkPaymentRow[]; dry_run?: boolean }
) {
  const { gameweek_id: gameweekId, rows, dry_run: dryRun = true } = body

  if (typeof gameweekId !== 'number' || !Number.isInteger(gameweekId)) {
    throw new Error('gameweek_id is required')
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('rows must be a non-empty array')
  }

  // --- resolve every distinct pot name referenced in this batch, once ---
  // (pots.name has no unique constraint — potsByName may map to more than
  // one id, which classifyBulkPaymentRows() reports as "ambiguous")
  const potNames = [...new Set(rows.map((r) => (r.pot ?? '').trim()).filter(Boolean))]
  const potsByName = new Map<string, string[]>()
  let resolvedPotIds: string[] = []

  if (potNames.length > 0) {
    const { data: potRows, error: potsError } = await adminClient.from('pots').select('id, name').in('name', potNames)
    if (potsError) throw new Error(`Failed to look up pots: ${potsError.message}`)
    for (const p of (potRows ?? []) as { id: string; name: string }[]) {
      const existing = potsByName.get(p.name) ?? []
      existing.push(p.id)
      potsByName.set(p.name, existing)
    }
    resolvedPotIds = [...new Set((potRows ?? []).map((p: { id: string }) => p.id))]
  }

  // --- authorization: which of the resolved pots may this caller act on? ---
  let authorizedPotIds: Set<string>
  if (isAppAdmin) {
    authorizedPotIds = new Set(resolvedPotIds)
  } else if (resolvedPotIds.length > 0) {
    const { data: adminRows, error: adminRowsError } = await adminClient
      .from('pot_members')
      .select('pot_id')
      .eq('user_id', callerId)
      .eq('role', 'admin')
      .in('pot_id', resolvedPotIds)
    if (adminRowsError) throw new Error(`Failed to check pot admin status: ${adminRowsError.message}`)
    authorizedPotIds = new Set((adminRows ?? []).map((r: { pot_id: string }) => r.pot_id))
  } else {
    authorizedPotIds = new Set()
  }

  // --- resolve every user referenced by email/phone, via the Admin Auth API ---
  // entry_payments' canonical identity is auth.users, which no client-
  // reachable table exposes at all (profiles has no email/phone column) —
  // this can only be resolved with the service-role client's Admin Auth
  // API, not a plain RLS-gated table query. This is why no schema change
  // was needed for identifier resolution: the capability already existed.
  // Phone matching is exact-string only (beyond stripping a leading '+' —
  // see bulkPayments.ts, confirmed live that GoTrue itself stores phone
  // numbers digits-only, E.164 in without the '+'), deliberately — this
  // codebase has no phone-auth UI anywhere (sign-up is email/password
  // only), so no user currently has auth.users.phone populated by any
  // normal flow; a phone row will correctly resolve to "unknown user"
  // until a phone number is set some other way. Further normalization
  // (spacing, leading zeros, local-format-to-E.164 guessing) is out of
  // scope — not a case this app's data can exercise today.
  const usersByEmail = new Map<string, string>()
  const usersByPhone = new Map<string, string>()
  let page = 1
  const perPage = 1000
  while (true) {
    const { data: pageData, error: listError } = await adminClient.auth.admin.listUsers({ page, perPage })
    if (listError) throw new Error(`Failed to look up users: ${listError.message}`)
    for (const u of pageData.users) {
      if (u.email) usersByEmail.set(u.email.toLowerCase(), u.id)
      if (u.phone) usersByPhone.set(u.phone, u.id)
    }
    if (pageData.users.length < perPage) break
    page++
  }

  // --- pot membership + existing entry_payments state for the resolved pots ---
  let potMemberships = new Set<string>()
  let existingPayments = new Map<string, boolean>()

  if (resolvedPotIds.length > 0) {
    const { data: memberRows, error: memberRowsError } = await adminClient
      .from('pot_members')
      .select('pot_id, user_id')
      .in('pot_id', resolvedPotIds)
    if (memberRowsError) throw new Error(`Failed to look up pot members: ${memberRowsError.message}`)
    potMemberships = new Set(
      (memberRows ?? []).map((r: { pot_id: string; user_id: string }) => `${r.pot_id}:${r.user_id}`)
    )

    const { data: existingRows, error: existingRowsError } = await adminClient
      .from('entry_payments')
      .select('pot_id, user_id, is_paid')
      .eq('gameweek_id', gameweekId)
      .eq('scope', 'gameweek')
      .in('pot_id', resolvedPotIds)
    if (existingRowsError) throw new Error(`Failed to look up existing payments: ${existingRowsError.message}`)
    existingPayments = new Map(
      (existingRows ?? []).map((r: { pot_id: string; user_id: string; is_paid: boolean }) => [
        `${r.pot_id}:${r.user_id}`,
        r.is_paid,
      ])
    )
  }

  const { results, toWrite, summary } = classifyBulkPaymentRows(rows, {
    usersByEmail,
    usersByPhone,
    potsByName,
    authorizedPotIds,
    potMemberships,
    existingPayments,
  })

  if (!dryRun && toWrite.length > 0) {
    const now = new Date().toISOString()
    const { error: writeError } = await adminClient.from('entry_payments').upsert(
      toWrite.map((w) => ({
        pot_id: w.pot_id,
        user_id: w.user_id,
        gameweek_id: gameweekId,
        scope: 'gameweek',
        is_paid: w.is_paid,
        notes: w.notes,
        marked_by: callerId,
        marked_at: now,
      })),
      { onConflict: 'pot_id,user_id,gameweek_id' }
    )
    if (writeError) throw new Error(`Failed to write payment verifications: ${writeError.message}`)
  }

  return { success: true, dry_run: dryRun, summary, results }
}