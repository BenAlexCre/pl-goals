import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function Modal({ open, onClose, title, children, size = 'md' }) {
  const ref = useRef(null)

  // Phase 11 (accessibility audit) — CONFIRMED live via keyboard-only
  // testing: this dialog had role="dialog"/aria-modal="true" and Escape
  // already worked, but nothing moved focus INTO it on open, trapped Tab
  // WITHIN it while open, or restored focus on close. A keyboard user
  // tabbing past an open modal reached whatever was behind the backdrop
  // instead of the modal's own controls, and closing it (e.g. after
  // "Remove member") dropped focus back to the top of the document —
  // both violate the standard dialog pattern (WAI-ARIA APG) every
  // Modal instance in this app relies on (RenameModal, ActivateModal,
  // "Remove member" confirm, etc.).
  useEffect(() => {
    if (!open) return

    const previouslyFocused = document.activeElement

    const focusables = () => [...ref.current?.querySelectorAll(FOCUSABLE_SELECTOR) ?? []]
    const first = focusables()[0]
    ;(first ?? ref.current)?.focus()

    function handleKey(e) {
      if (e.key === 'Escape') {
        onClose()
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
  }, [open, onClose])

  if (!open) return null

  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Panel */}
      <div
        ref={ref}
        tabIndex={-1}
        className={`
          relative z-10 w-full ${sizes[size]}
          glass rounded-2xl border border-white/8
          animate-slide-up shadow-card
          flex max-h-[calc(100dvh-2rem)] flex-col
        `}
      >
        {/* Mobile audit (2026-11-02) — the panel is height-capped and its
            body scrolls. Previously a modal taller than the screen (the body
            is scroll-locked while open) left its lower content and action
            buttons unreachable on a phone. */}
        <div className="flex shrink-0 items-center justify-between gap-3 px-5 pt-4 pb-2">
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <button
            onClick={onClose}
            className="-mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white/40 hover:text-white/80 transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-5 pb-5">{children}</div>
      </div>
    </div>
  )
}