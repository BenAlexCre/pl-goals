// Ad-hoc: open a route as a session at a width and run an expression.
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const [base, sessFile, route, w, expr] = process.argv.slice(2)
const sess = JSON.parse(readFileSync(sessFile, 'utf8'))
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: +w, height: 760 }, isMobile: +w < 768, hasTouch: +w < 768 })
await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [sess.key, JSON.stringify(sess.session)])
const p = await ctx.newPage(); await p.goto(base + route); await p.waitForLoadState('networkidle').catch(()=>{}); await p.waitForTimeout(800)
console.log(JSON.stringify(await p.evaluate(expr), null, 1)); await b.close()
