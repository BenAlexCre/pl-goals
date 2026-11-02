// Opens the main overlays at a small phone size and checks that the last
// interactive control inside each is reachable (scrolled into the viewport).
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const [base, sessFile, out] = process.argv.slice(2)
const sess = JSON.parse(readFileSync(sessFile, 'utf8'))
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true })
await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [sess.key, JSON.stringify(sess.session)])
const p = await ctx.newPage(); const errs = []
p.on('pageerror', e => errs.push(e.message))
async function check(name) {
  await p.waitForTimeout(600)
  const r = await p.evaluate(async () => {
    const dlg = [...document.querySelectorAll('[role=dialog]')].pop()
    if (!dlg) return { open: false }
    const ctrls = [...dlg.querySelectorAll('button, input, select, textarea, a[href]')].filter(e => e.getBoundingClientRect().height > 0)
    const last = ctrls[ctrls.length - 1]
    last?.scrollIntoView({ block: 'end' }); await new Promise(r => setTimeout(r, 300))
    const lr = last?.getBoundingClientRect()
    return { open: true, controls: ctrls.length, last: (last?.innerText || last?.getAttribute('aria-label') || last?.tagName || '').trim().slice(0, 30), lastBottom: Math.round(lr?.bottom ?? -1), vh: innerHeight, reachable: !!lr && lr.bottom <= innerHeight + 1 && lr.top >= 0, docOverflowX: document.documentElement.scrollWidth > innerWidth }
  })
  await p.screenshot({ path: `${out}/overlay-${name}.png` })
  console.log(name.padEnd(14), JSON.stringify(r))
}
await p.goto(base + '/pots'); await p.waitForLoadState('networkidle')
await p.getByRole('button', { name: /create pot/i }).first().click().catch(e => console.log('no create btn', e.message.slice(0, 80)))
await check('create-pot')
await p.keyboard.press('Escape')
await p.goto(base + '/dashboard'); await p.waitForLoadState('networkidle')
await p.getByRole('button', { name: /notifications/i }).click(); await check('notifications')
await p.keyboard.press('Escape')
await p.goto(base + '/pot/379a1783-73d9-4fdf-b282-a715a3a95848/gameweek/1'); await p.waitForLoadState('networkidle')
await p.locator('button.group').first().click(); await check('match-centre')
console.log('pageerrors:', errs)
await b.close()
