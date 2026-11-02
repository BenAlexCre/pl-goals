import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useUiStore } from '../../store/uiStore'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function Drawer() {
  const { drawerOpen, drawerContent, closeDrawer } = useUiStore()
  const panelRef = useRef(null)

  // Static accessibility review — same focus-trap gap as Modal.jsx (see
  // that file's own note): Escape/backdrop/scroll-lock already worked, but
  // nothing moved focus in on open, trapped Tab within the drawer, or
  // restored focus on close. This is the global notification drawer
  // (mounted once in AppShell, content swapped via useUiStore), so it gets
  // the same fix independently rather than sharing Modal's implementation.
  useEffect(() => {
    if (!drawerOpen) return

    const previouslyFocused = document.activeElement
    const focusables = () => [...panelRef.current?.querySelectorAll(FOCUSABLE_SELECTOR) ?? []]
    const first = focusables()[0]
    ;(first ?? panelRef.current)?.focus()

    function handleKey(e) {
      if (e.key === 'Escape') {
        closeDrawer()
        return
      }
      if (e.key !== 'Tab') return

      const els = focusables()
      if (!els.length) {
        e.preventDefault()
        return
      }

      const firstEl = els[0]
      const lastEl = els[els.length - 1]

      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    document.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus()
    }
  }, [drawerOpen, closeDrawer])

  if (!drawerOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Notifications">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={closeDrawer}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`
        relative z-10 w-full max-w-lg
        glass rounded-t-2xl border-t border-x border-white/8
        animate-slide-up max-h-[85dvh] flex flex-col
      `}>
        {/* Handle */}
        <div className="flex items-center justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>
        <button
          onClick={closeDrawer}
          className="absolute top-1 right-2 inline-flex h-11 w-11 items-center justify-center rounded-xl text-white/40 hover:text-white/70"
          aria-label="Close drawer"
        >
          <X size={18} />
        </button>
        <div className="overflow-y-auto overscroll-contain flex-1 px-4 pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          {drawerContent}
        </div>
      </div>
    </div>
  )
}