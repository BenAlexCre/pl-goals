// Mobile/desktop layout sweep. Usage:
//   node scripts/qa/viewport-sweep.mjs <baseUrl> <sessionJsonFile|-> <outDir> [routesCsv] [widthsCsv]
// Reports per route x width: horizontal overflow, elements extending past the
// viewport, interactive targets under 40px, console errors, failed requests,
// and time until no spinner is visible. Screenshots every combination.
import { chromium, webkit } from 'playwright'
import { readFileSync, mkdirSync } from 'node:fs'
const [base, sessFile, out, routesArg, widthsArg, engineArg] = process.argv.slice(2)
mkdirSync(out, { recursive: true })
const sess = sessFile && sessFile !== '-' ? JSON.parse(readFileSync(sessFile, 'utf8')) : null
const routes = (routesArg || '/').split(',')
const widths = (widthsArg || '320,360,375,390,430,768,1024,1440').split(',').map(Number)
const engine = engineArg === 'webkit' ? webkit : chromium
const browser = await engine.launch()
const results = []
for (const w of widths) {
  const mobile = w < 768
  const ctx = await browser.newContext({ viewport: { width: w, height: mobile ? 760 : 900 }, isMobile: mobile && engine === chromium, hasTouch: mobile, deviceScaleFactor: 1 })
  if (sess) await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v) } catch {} }, [sess.key, JSON.stringify(sess.session)])
  for (const route of routes) {
    const page = await ctx.newPage()
    const errs = [], fails = []
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)) })
    page.on('pageerror', e => errs.push('PAGEERROR ' + e.message.slice(0, 160)))
    page.on('requestfailed', r => { if (!/fontshare|favicon/.test(r.url())) fails.push(r.url().replace(base, '').slice(0, 90) + ' ' + r.failure()?.errorText) })
    page.on('response', r => { if (r.status() >= 400 && !/fontshare/.test(r.url())) fails.push(r.status() + ' ' + r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 90)) })
    const t0 = Date.now()
    await page.goto(base + route, { waitUntil: 'domcontentloaded' })
    let ready = -1
    for (let i = 0; i < 60; i++) {
      const spinning = await page.evaluate(() => !!document.querySelector('.animate-spin, [role=status][aria-busy=true]') && document.body.innerText.trim().length < 400)
      if (!spinning && await page.evaluate(() => document.body.innerText.trim().length > 0)) { ready = Date.now() - t0; break }
      await page.waitForTimeout(250)
    }
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
    await page.waitForTimeout(400)
    const m = await page.evaluate((vw) => {
      const de = document.documentElement
      const offenders = []
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        if (r.right > vw + 1) {
          // skip if clipped by a scrolling/hidden ancestor
          let p = el.parentElement, clipped = false
          while (p && p !== document.body) { const s = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) { clipped = true; break } p = p.parentElement }
          if (!clipped) offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 3).join('.')} r=${Math.round(r.right)}`)
        }
      }
      const small = []
      for (const el of document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=tab]')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        const s = getComputedStyle(el); if (s.visibility === 'hidden') continue
        if (r.height < 40 || r.width < 40) small.push(`${(el.getAttribute('aria-label') || el.innerText || el.tagName).trim().slice(0, 24).replace(/\s+/g, ' ')} ${Math.round(r.width)}x${Math.round(r.height)}`)
      }
      // A compile-error overlay or the app ErrorBoundary is a FAILURE, even
      // though the page has visible text.
      const broken = !!document.querySelector('vite-error-overlay') || /Something went wrong/.test(document.body.innerText)
      return { broken, url: location.pathname, scrollW: de.scrollWidth, overflowX: de.scrollWidth > vw, offenders: [...new Set(offenders)].slice(0, 6), smallTargets: small.length, smallSample: small.slice(0, 6), h1: document.querySelector('h1,h2')?.innerText?.slice(0, 40) }
    }, w)
    const name = `${route.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root'}-${w}`
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: false })
    results.push({ route, w, readyMs: ready, ...m, errs: [...new Set(errs)].slice(0, 4), fails: [...new Set(fails)].slice(0, 4) })
    await page.close()
  }
  await ctx.close()
}
await browser.close()
for (const r of results) {
  // An unexpected redirect (e.g. to /sign-in) means the route was NOT tested.
  const flags = [r.url !== r.route.split('?')[0] ? 'REDIRECTED' : '', r.broken ? 'BROKEN' : '', r.overflowX ? `OVERFLOW(${r.scrollW})` : '', r.readyMs < 0 ? 'NEVER-READY' : '', r.errs.length ? 'ERR' : '', r.fails.length ? 'NETFAIL' : ''].filter(Boolean).join(' ')
  console.log(`${r.route.padEnd(34)} ${String(r.w).padStart(4)} ready=${String(r.readyMs).padStart(5)} small=${String(r.smallTargets).padStart(2)} ${flags} ${r.url !== r.route ? '-> ' + r.url : ''}`)
  if (r.offenders.length) console.log('    offenders:', r.offenders.join(' | '))
  if (r.errs.length) console.log('    errs:', r.errs.join(' | '))
  if (r.fails.length) console.log('    fails:', r.fails.join(' | '))
}
console.log('\nSMALL TARGET SAMPLES (390):'); for (const r of results.filter(r => r.w === 390)) console.log(r.route, r.smallSample.join(' ; '))
