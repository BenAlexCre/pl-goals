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
  as: Component = 'button',
  children,
  variant  = 'primary',
  size     = 'md',
  loading  = false,
  disabled = false,
  fullWidth = false,
  className = '',
  ...props
}) {
  // Remediation (Phase 11 accessibility audit) — every `<Link to="..."><Button>`
  // call site nested a real <button> inside a real <a>, which is invalid
  // HTML content model (interactive content inside interactive content) and
  // confirmed live to produce two separate, redundant Tab stops for what
  // reads as one control. `as` lets a call site render Button's styling on
  // react-router's <Link> directly instead — one element, one tab stop,
  // valid semantics. Defaults to 'button' so every existing plain-button
  // usage (the vast majority) is unaffected. `disabled` only makes sense on
  // an actual <button>; a Link has no disabled semantics of its own.
  const isPlainButton = Component === 'button'

  return (
    <Component
      {...(isPlainButton ? { disabled: disabled || loading } : {})}
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
    </Component>
  )
}