// Cold-load a public URL under mobile network + CPU throttling (Chromium CDP)
// and report paint timings and resource weights.
import { chromium, devices } from 'playwright'
const [url, profile = '4g'] = process.argv.slice(2)
const net = { '4g': { latency: 150, down: 1.6e6 / 8, up: 750e3 / 8 }, '3g': { latency: 400, down: 400e3 / 8, up: 400e3 / 8 } }[profile]
const b = await chromium.launch(); const ctx = await b.newContext({ ...devices['Pixel 7'] }); const p = await ctx.newPage()
const cdp = await ctx.newCDPSession(p)
await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: net.latency, downloadThroughput: net.down, uploadThroughput: net.up })
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
const t0 = Date.now()
await p.goto(url, { waitUntil: 'load', timeout: 120000 })
const loadMs = Date.now() - t0
await p.waitForFunction(() => document.body.innerText.trim().length > 50, null, { timeout: 120000 })
const contentMs = Date.now() - t0
const perf = await p.evaluate(() => {
  const paint = Object.fromEntries(performance.getEntriesByType('paint').map(e => [e.name, Math.round(e.startTime)]))
  const res = performance.getEntriesByType('resource').map(r => ({ n: r.name.split('/').pop().slice(0, 40) || r.name.slice(0, 40), kb: Math.round(r.transferSize / 1024), ms: Math.round(r.duration), blocking: r.renderBlockingStatus }))
  return { paint, res: res.sort((a, b) => b.ms - a.ms).slice(0, 8) }
})
console.log(JSON.stringify({ url, profile, loadMs, contentVisibleMs: contentMs, ...perf }, null, 1))
await b.close()
