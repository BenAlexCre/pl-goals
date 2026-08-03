import { Search, X } from 'lucide-react'
import { useState } from 'react'

export default function PlayerSearch({ value, onChange, placeholder = 'Search players...' }) {
  const [focused, setFocused] = useState(false)

  return (
    <div className={`
      flex items-center gap-2 px-3 py-2 rounded-xl
      bg-surface-1 border border-white/8
      ${focused ? 'border-accent/40 bg-surface-2' : ''}
    `}>
      <Search size={16} className="text-white/30 flex-shrink-0" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        className="flex-1 bg-transparent outline-none text-sm text-white placeholder:text-white/25"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="text-white/30 hover:text-white/70 transition-colors p-1"
          aria-label="Clear search"
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}