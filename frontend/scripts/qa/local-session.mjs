// LOCAL DEV ONLY. Mints a session for an existing local user via the local
// GoTrue admin API (magic link -> verify), without following the redirect.
// Prints the supabase-js storage key + session JSON for injection into a test
// browser context. Never point this at a hosted project.
import { readFileSync } from 'node:fs'
const [email, srPath] = process.argv.slice(2)
const base = 'http://127.0.0.1:54321'
if (!base.startsWith('http://127.0.0.1')) throw new Error('local only')
const sr = readFileSync(srPath, 'utf8').trim()
const gl = await fetch(`${base}/auth/v1/admin/generate_link`, {
  method: 'POST', headers: { apikey: sr, Authorization: `Bearer ${sr}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'magiclink', email }),
}).then(r => r.json())
const r = await fetch(gl.action_link, { redirect: 'manual' })
const hash = new URL(r.headers.get('location')).hash.slice(1)
const p = new URLSearchParams(hash)
const user = await fetch(`${base}/auth/v1/user`, { headers: { apikey: sr, Authorization: `Bearer ${p.get('access_token')}` } }).then(r => r.json())
const session = { access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), token_type: 'bearer',
  expires_in: +p.get('expires_in'), expires_at: +p.get('expires_at'), user }
process.stdout.write(JSON.stringify({ key: 'sb-127-auth-token', session }))
