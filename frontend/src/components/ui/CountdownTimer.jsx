import { useState, useEffect } from 'react'
import { getCountdownParts } from '../../utils/time'
import { Clock } from 'lucide-react'

export default function CountdownTimer({ deadlineUtc, onExpire, className = '' }) {
  const [parts, setParts] = useState(() => getCountdownParts(deadlineUtc))

  useEffect(() => {
    if (!deadlineUtc) return
    const id = setInterval(() => {
      const p = getCountdownParts(deadlineUtc)
      setParts(p)
      if (!p) {
        clearInterval(id)
        onExpire?.()
      }
    }, 1000)
    return () => clearInterval(id)
  }, [deadlineUtc, onExpire])

  if (!parts) {
    return (
      <span className={`inline-flex items-center gap-1.5 text-red-goal font-semibold text-sm ${className}`}>
        🔒 Locked
      </span>
    )
  }

  const isUrgent  = parts.total < 60 * 60 * 1000        // under 1 hour
  const isWarning = parts.total < 3  * 60 * 60 * 1000   // under 3 hours

  const colour = isUrgent
    ? 'text-red-goal'
    : isWarning
    ? 'text-amber'
    : 'text-accent'

  const pad = (n) => String(n).padStart(2, '0')

  return (
    <span className={`inline-flex items-center gap-1.5 font-mono tabular ${colour} ${className}`}>
      <Clock size={14} className="flex-shrink-0" />
      {parts.h > 0 && <span>{parts.h}h </span>}
      <span>{pad(parts.m)}m </span>
      <span>{pad(parts.s)}s</span>
    </span>
  )
}