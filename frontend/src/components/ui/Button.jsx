import Spinner from './Spinner'

const variants = {
  primary:   'bg-accent text-pitch-950 hover:bg-accent-muted active:scale-95 font-semibold shadow-glow',
  secondary: 'bg-surface-3 text-white hover:bg-surface-4 border border-white/10 active:scale-95',
  ghost:     'text-white/60 hover:text-white hover:bg-white/5 active:scale-95',
  danger:    'bg-red-goal/15 text-red-goal hover:bg-red-goal/25 border border-red-goal/25 active:scale-95',
  outline:   'border border-accent/40 text-accent hover:bg-accent/10 active:scale-95',
}

const sizes = {
  sm: 'px-3 py-1.5 text-xs rounded-lg  min-h-[36px]',
  md: 'px-4 py-2.5 text-sm rounded-xl  min-h-[44px]',
  lg: 'px-6 py-3   text-base rounded-xl min-h-[52px]',
}

export default function Button({
  children,
  variant  = 'primary',
  size     = 'md',
  loading  = false,
  disabled = false,
  fullWidth = false,
  className = '',
  ...props
}) {
  return (
    <button
      disabled={disabled || loading}
      className={`
        inline-flex items-center justify-center gap-2
        transition-all duration-150
        disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100
        ${sizes[size]}
        ${variants[variant]}
        ${fullWidth ? 'w-full' : ''}
        ${className}
      `}
      {...props}
    >
      {loading && <Spinner size="sm" />}
      {children}
    </button>
  )
}