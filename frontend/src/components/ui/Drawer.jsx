import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useUiStore } from '../../store/uiStore'

export default function Drawer() {
  const { drawerOpen, drawerContent, closeDrawer } = useUiStore()

  useEffect(() => {
    if (!drawerOpen) return
    const handleKey = (e) => { if (e.key === 'Escape') closeDrawer() }
    document.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  }, [drawerOpen, closeDrawer])

  if (!drawerOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={closeDrawer}
      />
      <div className={`
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
          className="absolute top-3 right-4 text-white/40 hover:text-white/70 p-1"
          aria-label="Close drawer"
        >
          <X size={18} />
        </button>
        <div className="overflow-y-auto flex-1 px-4 pb-6 pt-2">
          {drawerContent}
        </div>
      </div>
    </div>
  )
}