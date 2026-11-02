import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const [base, sessFile, out, w] = process.argv.slice(2)
const sess = JSON.parse(readFileSync(sessFile, 'utf8'))
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: +w, height: 700 }, isMobile: true, hasTouch: true })
await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [sess.key, JSON.stringify(sess.session)])
const p = await ctx.newPage(); await p.goto(base + '/pots'); await p.waitForLoadState('networkidle')
await p.locator('button[aria-expanded]').filter({ hasText: 'Create pot' }).click(); await p.waitForTimeout(500)
for (const mode of ['Pick 5', 'Last Man Standing', 'Score Predictor']) {
  await p.getByText(mode, { exact: true }).first().click().catch(() => {}); await p.waitForTimeout(300)
  const r = await p.evaluate((vw) => {
    const off = []; for (const el of document.querySelectorAll('main *')) { const r = el.getBoundingClientRect(); if (r.width && r.right > vw + 1) off.push(el.tagName + '.' + String(el.className).slice(0, 50) + ' r=' + Math.round(r.right)) }
    const small = [...document.querySelectorAll('main input, main select, main button')].filter(e => { const r = e.getBoundingClientRect(); return r.height && r.height < 40 }).map(e => (e.name || e.type || e.innerText || '').slice(0, 20) + ' ' + Math.round(e.getBoundingClientRect().height))
    return { overflowX: document.documentElement.scrollWidth > vw, off: off.slice(0, 4), small: small.slice(0, 8) }
  }, +w)
  console.log(mode.padEnd(18), JSON.stringify(r))
}
await p.screenshot({ path: `${out}/create-pot-${w}.png`, fullPage: true }); await b.close()
