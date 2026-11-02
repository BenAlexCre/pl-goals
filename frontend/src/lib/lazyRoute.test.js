import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withChunkReload, isChunkLoadError } from './lazyRoute'

describe('isChunkLoadError', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://x/assets/Dashboard-abc.js', // Chromium
    'Importing a module script failed.', // Safari
    'error loading dynamically imported module', // Firefox
    'Loading chunk 12 failed.',
  ])('recognises %s', (msg) => {
    expect(isChunkLoadError(new Error(msg))).toBe(true)
  })

  it('ignores ordinary errors', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false)
  })
})

describe('withChunkReload', () => {
  const reload = vi.fn()
  const originalLocation = window.location
  const chunkError = () => new Error('Failed to fetch dynamically imported module')
  const pending = Symbol('pending')
  // The reload path returns a never-settling promise (Suspense keeps showing
  // its fallback while the page reloads); race it against a tick to observe.
  const settle = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r(pending), 20))])

  beforeEach(() => {
    sessionStorage.clear()
    reload.mockReset()
    Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, reload } })
  })
  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
  })

  it('returns the module and clears any previous reload flag on success', async () => {
    sessionStorage.setItem('pl-goals:chunk-reload', '1')
    const mod = { default: () => null }
    await expect(withChunkReload(() => Promise.resolve(mod))()).resolves.toBe(mod)
    expect(sessionStorage.getItem('pl-goals:chunk-reload')).toBeNull()
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads the page once on a stale-deploy chunk failure', async () => {
    const result = await settle(withChunkReload(() => Promise.reject(chunkError()))())
    expect(result).toBe(pending)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('pl-goals:chunk-reload')).toBe('1')
  })

  it('does not reload again if the chunk still fails after a reload (no loop)', async () => {
    sessionStorage.setItem('pl-goals:chunk-reload', '1')
    await expect(withChunkReload(() => Promise.reject(chunkError()))()).rejects.toThrow(/dynamically imported/)
    expect(reload).not.toHaveBeenCalled()
  })

  it('never reloads for an ordinary error inside the module', async () => {
    await expect(withChunkReload(() => Promise.reject(new TypeError('boom')))()).rejects.toThrow('boom')
    expect(reload).not.toHaveBeenCalled()
  })
})
