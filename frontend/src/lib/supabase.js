import { createClient, FunctionsHttpError } from '@supabase/supabase-js'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnon) {
  throw new Error('Missing Supabase env vars. Check your .env.local file.')
}

export const supabase = createClient(supabaseUrl, supabaseAnon, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
})

// supabase-js's functions.invoke() throws a FunctionsHttpError on any
// non-2xx response whose own .message is always the generic "Edge Function
// returned a non-2xx status code" — the Edge Function's actual JSON body
// (e.g. { error: "Entry is locked, not pending — picks can no longer be
// changed" }) is only reachable via error.context (the raw Response),
// which the caller has to parse itself. Every Edge Function invocation in
// this codebase wants the real message, so this wraps that extraction once
// instead of repeating it at each call site. Returns a plain Error either
// way, so callers can keep writing `throw` without knowing which shape.
export async function extractFunctionError(error) {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json()
      if (body?.error) return new Error(body.error)
    } catch {
      // Response body wasn't JSON (or already consumed) — fall through to
      // the generic message rather than throwing a second, unrelated error.
    }
  }
  return error instanceof Error ? error : new Error(String(error))
}