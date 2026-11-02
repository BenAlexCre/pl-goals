import { lazy } from 'react'

// Route-level code splitting (mobile performance audit, 2026-11-02).
//
// React.lazy() alone introduces one new failure mode: a tab opened before a
// deploy still references the OLD hashed chunk filenames, which the new
// deploy no longer serves. The dynamic import then rejects ("Failed to fetch
// dynamically imported module" / "Importing a module script failed" on
// Safari) and the ErrorBoundary takes over. Phones keep tabs alive for days,
// so this is the common case, not an edge case.
//
// On such a failure we reload the page once — which fetches the new
// index.html and the new chunk names — guarded by a sessionStorage flag so a
// genuinely broken chunk (or an offline device) can't cause a reload loop;
// the second failure surfaces to the ErrorBoundary as before.
const RELOAD_FLAG = 'pl-goals:chunk-reload'

function isChunkLoadError(err) {
  const msg = String(err?.message ?? err)
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk .* failed/i.test(msg)
}

function safeSession(fn) {
  try { return fn(window.sessionStorage) } catch { return null }
}

// The import wrapper on its own, so the reload policy is testable without
// going through React.lazy internals.
export function withChunkReload(importer) {
  return async () => {
    try {
      const mod = await importer()
      safeSession((s) => s.removeItem(RELOAD_FLAG))
      return mod
    } catch (err) {
      const alreadyReloaded = safeSession((s) => s.getItem(RELOAD_FLAG)) === '1'
      if (isChunkLoadError(err) && !alreadyReloaded) {
        safeSession((s) => s.setItem(RELOAD_FLAG, '1'))
        window.location.reload()
        // Keep Suspense showing its fallback while the reload happens.
        return new Promise(() => {})
      }
      throw err
    }
  }
}

export function lazyRoute(importer) {
  return lazy(withChunkReload(importer))
}

export { isChunkLoadError }
