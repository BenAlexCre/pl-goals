// Read-only probe: load a public URL under mobile device emulation and
// report console errors, failed requests, overflow, and timing.
import { chromium, webkit, devices } from 'playwright'
const url = process.argv[2]
const out = process.argv[3]
for (const [name, engine, dev] of [['iphone13', webkit, devices['iPhone 13']], ['pixel7', chromium, devices['Pixel 7']]]) {
  let browser
  try { browser = await engine.launch() } catch (e) { console.log(name, 'launch failed:', e.message.split('\n')[0]); continue }
  const ctx = await browser.newContext({ ...dev })
  const page = await ctx.newPage()
  const errs = [], fails = []
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) })
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message.slice(0, 200)))
  page.on('requestfailed', r => fails.push(r.url().slice(0, 120) + ' ' + r.failure()?.errorText))
  const t0 = Date.now()
  const resp = await page.goto(url, { waitUntil: 'load', timeout: 45000 }).catch(e => ({ err: e.message }))
  await page.waitForTimeout(3000)
  const info = await page.evaluate(() => ({
    finalUrl: location.href, title: document.title,
    rootChildren: document.getElementById('root')?.children.length ?? -1,
    textLen: document.body.innerText.length,
    scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
    scripts: [...document.scripts].map(s => s.src.split('/').pop()),
  }))
  console.log(JSON.stringify({ name, status: resp?.status?.() ?? resp?.err, ms: Date.now() - t0, ...info, errs, fails }, null, 1))
  await page.screenshot({ path: `${out}/${name}-prod-landing.png` })
  await browser.close()
}
