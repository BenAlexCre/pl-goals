export default function Card({ children, className = '', onClick, hover = false }) {
  const base = `
    bg-surface-1 border border-white/6 rounded-2xl
    ${hover || onClick ? 'hover:bg-surface-2 hover:border-white/10 transition-colors cursor-pointer card-glow' : ''}
    ${className}
  `
  if (onClick) {
    return (
      <button className={`${base} w-full text-left`} onClick={onClick}>
        {children}
      </button>
    )
  }
  return <div className={base}>{children}</div>
}