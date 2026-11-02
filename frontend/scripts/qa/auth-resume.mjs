// Measures auth behaviour on (a) cold load with an expired access token and
// (b) a tab returning to the foreground. Counts GoTrue /token calls.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const [base, sessFile, route, expire] = process.argv.slice(2)
const sess = JSON.parse(readFileSync(sessFile, 'utf8'))
if (expire === 'expired') sess.session.expires_at = Math.floor(Date.now() / 1000) - 60
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 760 }, isMobile: true, hasTouch: true })
await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [sess.key, JSON.stringify(sess.session)])
const p = await ctx.newPage()
let tokenCalls = [], errs = []
p.on('request', r => { if (r.url().includes('/auth/v1/token')) tokenCalls.push(Date.now()) })
p.on('response', r => { if (r.url().includes('/auth/v1/') && r.status() >= 400) errs.push(r.status() + ' ' + r.url().split('/auth/v1/')[1].slice(0, 40)) })
const t0 = Date.now()
await p.goto(base + route); await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(1000)
console.log('cold load: url=', new URL(p.url()).pathname, 'token calls=', tokenCalls.length, 'ms=', Date.now() - t0)
for (let i = 1; i <= 3; i++) {
  tokenCalls = []
  // simulate the phone backgrounding and foregrounding the tab
  await p.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange'))
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
  })
  await p.waitForTimeout(2500)
  console.log(`resume #${i}: token refresh calls=${tokenCalls.length}`)
}
console.log('auth errors:', errs.slice(0, 5))
await b.close()
