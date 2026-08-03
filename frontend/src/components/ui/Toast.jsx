import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react'
import { useUiStore } from '../../store/uiStore'

const configs = {
  success: { icon: CheckCircle,   colour: 'text-accent',    bg: 'border-accent/20'    },
  error:   { icon: AlertCircle,   colour: 'text-red-goal',  bg: 'border-red-goal/20'  },
  warning: { icon: AlertTriangle, colour: 'text-amber',      bg: 'border-amber/20'     },
  info:    { icon: Info,          colour: 'text-white/60',  bg: 'border-white/10'     },
}

export default function Toast({ id, type = 'info', message }) {
  const removeToast = useUiStore((s) => s.removeToast)
  const { icon: Icon, colour, bg } = configs[type] ?? configs.info

  return (
    <div className={`
      flex items-start gap-3 px-4 py-3
      glass rounded-xl border ${bg}
      shadow-card animate-slide-up
      max-w-sm w-full
    `}>
      <Icon size={18} className={`flex-shrink-0 mt-0.5 ${colour}`} />
      <p className="flex-1 text-sm text-white/80 leading-snug">{message}</p>
      <button
        onClick={() => removeToast(id)}
        className="flex-shrink-0 text-white/30 hover:text-white/60 transition-colors p-0.5"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  )
}