// Phase 13 — ISSUE-55. Shown for two confirmed-live failure shapes:
// (1) a request that resolves as `{ error }` with no response at all
// (DNS failure, connection refused — auth-js wraps this as
// `AuthRetryableFetchError`, status 0), and (2) any other non-AuthError
// exception the auth-js call rethrows instead of resolving (its own
// `catch` block only swallows genuine `AuthError`s — see
// node_modules/@supabase/auth-js/dist/main/lib/GoTrueClient.js). Both are
// the request never completing, not a wrong password or an unverified
// account — GoTrue always resolves those normally.
export const AUTH_NETWORK_ERROR_MESSAGE = 'Unable to reach the server right now. Please check your connection and try again.'

// GoTrue's own `AuthApiError`/`AuthError` carries a machine-readable
// `.code` (confirmed in @supabase/auth-js's own source) — pattern-match
// on that instead of the raw `.message` string, an internal
// implementation detail GoTrue could reword at any time. Every message
// here is written for the person signing in, never a raw database/HTTP
// error.
export function humanizeAuthError(error) {
  if (!error) return ''
  // Confirmed live by intercepting the token request and forcing exactly
  // this failure: status 0 / AuthRetryableFetchError, not a `.code`.
  if (error.name === 'AuthRetryableFetchError' || error.status === 0) {
    return AUTH_NETWORK_ERROR_MESSAGE
  }
  switch (error.code) {
    case 'invalid_credentials':
      return 'Incorrect email or password.'
    case 'email_not_confirmed':
      return 'Your email address has not been verified yet. Check your inbox for the verification link.'
    case 'user_banned':
      return 'Your account has been suspended.'
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
    case 'over_sms_send_rate_limit':
      return 'Too many attempts. Please wait a moment and try again.'
    case 'weak_password':
      return 'That password is too weak. Use at least 6 characters.'
    case 'user_already_exists':
      return 'An account with that email already exists.'
    default:
      // A real, structured GoTrue error with no specific copy of our own
      // yet — GoTrue never puts internal/database details in these
      // messages, so it's still safe to show as-is rather than hiding it
      // behind a generic fallback.
      return error.message || 'Something went wrong. Please try again.'
  }
}
