import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

// Slide-in panel primitive — same Escape/backdrop/scroll-lock pattern as
// Modal.jsx, but anchored to the right edge and full-height, since the
// Match Centre/Player drawers need to feel like a distinct "detail panel"
// rather than a centered confirmation dialog. Named SlideDrawer, not
// Drawer — a differently-shaped Drawer.jsx already exists (a global,
// useUiStore-driven single-instance drawer mounted once in AppShell.jsx
// for the notification panel) and is not reused here since its props-free,
// store-content-swap API doesn't fit a component that needs many
// independent instances (one per fixture card) with per-instance props.
export default function SlideDrawer({ open, onClose, title, children, widthClass = 'max-w-md' }) {
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const closeTimeout = useRef(null)

  useEffect(() => {
    if (open) {
      clearTimeout(closeTimeout.current)
      setMounted(true)
      // Two-frame delay so the initial (off-screen) position actually
      // paints before the transform transitions to on-screen — without
      // this the panel would just appear instantly, no slide.
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)))
    } else if (mounted) {
      setVisible(false)
      closeTimeout.current = setTimeout(() => setMounted(false), 300)
    }
    return () => clearTimeout(closeTimeout.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!mounted) return null

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <div
        className={`
          absolute right-0 top-0 h-full w-full ${widthClass}
          glass border-l border-white/8 shadow-card
          overflow-y-auto
          transition-transform duration-300 ease-out
          ${visible ? 'translate-x-0' : 'translate-x-full'}
        `}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/8 bg-pitch-950/90 px-5 py-4 backdrop-blur-md">
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-white/40 transition-colors hover:text-white/80"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  )
}
