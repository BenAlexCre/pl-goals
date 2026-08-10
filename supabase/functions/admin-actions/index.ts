import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { classifyBulkPaymentRows, type BulkPaymentRow } from './bulkPayments.ts'
import { handleReinstateEntry } from './reinstate.ts'
import { handleRecordPayment } from './recordPayment.ts'

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
        await upsertEntryPayment(adminClient, { pot_id, user_id, gameweek_id: gameweek_id ?? null, is_paid: true, marked_by: userData.user.id })
        break
      }

      case 'mark_unpaid': {
        const { user_id, gameweek_id } = body
        await upsertEntryPayment(adminClient, { pot_id, user_id, gameweek_id: gameweek_id ?? null, is_paid: false, marked_by: userData.user.id })
        await adminClient.from('user_entries')
          .update({ is_void: true, status: 'void' })
          .eq('pot_id', pot_id)
          .eq('user_id', user_id)
          .eq('gameweek_id', gameweek_id)
        break
      }

      case 'reinstate_entry': {
        const result = await handleReinstateEntry(adminClient, userData.user.id, pot_id, body)
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      case 'record_payment': {
        const result = await handleRecordPayment(adminClient, userData.user.id, pot_id, body)
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
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

// Prerequisite correction (before Milestone 6 Slice 6): mark_paid/
// mark_unpaid previously upserted entry_payments with
// `onConflict: 'pot_id,user_id,gameweek_id'` unconditionally. That target
// matches the full 3-column unique constraint
// (entry_payments_pot_id_user_id_gameweek_id_key) — correct for Pick 5's
// scope='gameweek' rows, but season-scoped rows (LMS/Predictor,
// gameweek_id null) are actually deduplicated by a different, *partial*
// unique index, entry_payments_pot_user_season_key (unique on
// (pot_id, user_id) WHERE gameweek_id IS NULL) — Postgres's ON CONFLICT
// only routes to an index whose columns match the specified target
// exactly, so this never engaged that partial index at all. Confirmed
// live, not theoretical: a second write to the same season-scoped
// (pot_id, user_id) key hard-failed with
// `duplicate key value violates unique constraint
// "entry_payments_pot_user_season_key"` — meaning marking a season-scoped
// entry paid/unpaid more than once (routine — correcting a mistake, or
// exactly the mark-paid-then-reinstate sequence this correction's own new
// feature depends on) was completely broken for LMS/Predictor. Found
// during the review this prerequisite correction's own task explicitly
// required ("review admin-actions: mark_paid/mark_unpaid/
// bulk_verify_payments"), not a pre-existing finding carried over from
// elsewhere — corrects docs/game-engine.md § GE-4.3's own prior claim
// ("No Payment Verification code changes of any kind are needed for
// LMS"), which asserted this without ever exercising a second write.
//
// Fixed with the same get-or-create-by-id workaround this codebase
// already uses for other partial-unique-index tables
// (pot_standings_snapshots, pot_prizes — see docs/game-engine.md §
// GE-4.6): look up the existing row by its natural key first, then
// UPDATE by id if found or INSERT if not, rather than relying on
// PostgREST's upsert(onConflict) to route to an index it structurally
// cannot target. bulk_verify_payments is unaffected — gameweek_id is a
// required, non-null parameter there (always scope='gameweek'), so it
// never reaches the partial index at all.
async function upsertEntryPayment(
  adminClient: SupabaseClient,
  params: { pot_id: string; user_id: string; gameweek_id: number | null; is_paid: boolean; marked_by: string }
): Promise<void> {
  const { pot_id, user_id, gameweek_id, is_paid, marked_by } = params
  const scope = gameweek_id !== null ? 'gameweek' : 'season'

  let existingQuery = adminClient.from('entry_payments').select('id').eq('pot_id', pot_id).eq('user_id', user_id)
  existingQuery = gameweek_id !== null ? existingQuery.eq('gameweek_id', gameweek_id) : existingQuery.is('gameweek_id', null)
  const { data: existing, error: lookupError } = await existingQuery.maybeSingle()
  if (lookupError) {
    throw new Error(`Failed to look up existing payment record: ${lookupError.message}`)
  }

  const patch = { pot_id, user_id, gameweek_id, scope, is_paid, marked_by, marked_at: new Date().toISOString() }

  if (existing) {
    const { error: updateError } = await adminClient.from('entry_payments').update(patch).eq('id', existing.id)
    if (updateError) throw new Error(`Failed to update payment record: ${updateError.message}`)
  } else {
    const { error: insertError } = await adminClient.from('entry_payments').insert(patch)
    if (insertError) throw new Error(`Failed to create payment record: ${insertError.message}`)
  }
}

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