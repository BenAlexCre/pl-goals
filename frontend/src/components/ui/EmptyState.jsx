export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className = '',
}) {
  return (
    <div className={`
      flex flex-col items-center justify-center text-center
      py-16 px-8 gap-4
      ${className}
    `}>
      {Icon && (
        <div className="w-14 h-14 rounded-2xl bg-surface-3 flex items-center justify-center text-white/20">
          <Icon size={28} />
        </div>
      )}
      <div className="space-y-1 max-w-xs">
        <h3 className="text-white font-semibold text-base">{title}</h3>
        {description && (
          <p className="text-sm text-white/40 leading-relaxed">{description}</p>
        )}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}