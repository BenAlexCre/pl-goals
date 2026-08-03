function SkeletonBox({ className = '' }) {
  return (
    <div className={`
      bg-surface-3 rounded-lg animate-pulse
      ${className}
    `} />
  )
}

export function SkeletonText({ lines = 3, className = '' }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonBox
          key={i}
          className={`h-4 ${i === lines - 1 ? 'w-3/5' : 'w-full'}`}
        />
      ))}
    </div>
  )
}

export function SkeletonCard({ className = '' }) {
  return (
    <div className={`bg-surface-1 border border-white/6 rounded-2xl p-4 space-y-3 ${className}`}>
      <div className="flex items-center gap-3">
        <SkeletonBox className="w-10 h-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <SkeletonBox className="h-4 w-1/2" />
          <SkeletonBox className="h-3 w-1/3" />
        </div>
      </div>
      <SkeletonText lines={2} />
    </div>
  )
}

export function SkeletonPickSlot() {
  return (
    <div className="bg-surface-1 border border-white/6 rounded-xl p-3 flex items-center gap-3">
      <SkeletonBox className="w-8 h-8 rounded-full" />
      <div className="flex-1 space-y-1.5">
        <SkeletonBox className="h-4 w-2/3" />
        <SkeletonBox className="h-3 w-1/3" />
      </div>
      <SkeletonBox className="w-16 h-6 rounded-full" />
    </div>
  )
}

export default SkeletonBox