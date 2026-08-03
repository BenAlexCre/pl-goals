import { initials } from '../../utils/format'

export default function Avatar({ user, size = 'md', className = '' }) {
  const sizes = {
    xs:  'w-6 h-6 text-xs',
    sm:  'w-8 h-8 text-xs',
    md:  'w-10 h-10 text-sm',
    lg:  'w-14 h-14 text-lg',
  }
  const letters = initials(user?.display_name ?? user?.username ?? '?')

  if (user?.avatar_url) {
    return (
      <img
        src={user.avatar_url}
        alt={user.display_name ?? 'Avatar'}
        className={`rounded-full object-cover flex-shrink-0 ${sizes[size]} ${className}`}
        loading="lazy"
      />
    )
  }

  return (
    <div className={`
      rounded-full flex-shrink-0 flex items-center justify-center
      bg-surface-3 text-accent font-semibold border border-white/10
      ${sizes[size]} ${className}
    `}>
      {letters}
    </div>
  )
}