import { Shield } from 'lucide-react'

// A single pick, styled like a real player card rather than a plain list
// row. `crestUrl` is optional — teams.crest_url is nullable and not every
// synced team has one, so this always falls back to a plain shield icon
// rather than a broken image.
export default function PickCard({ position, displayName, teamName, crestUrl, pickNumber, onRemove }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/8 bg-surface-1 p-4 transition-all duration-200 hover:border-accent/25 hover:bg-surface-2">
      <div className="flex items-start justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-white/25">
          Pick {pickNumber}
        </span>
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove pick ${pickNumber}: ${displayName}`}
            className="rounded-lg px-2 py-0.5 text-[11px] font-medium text-white/35 opacity-0 transition-opacity hover:bg-white/8 hover:text-white group-hover:opacity-100 focus-visible:opacity-100"
          >
            Remove
          </button>
        ) : null}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-3">
          {crestUrl ? (
            <img src={crestUrl} alt="" className="h-8 w-8 object-contain" loading="lazy" />
          ) : (
            <Shield size={20} className="text-white/25" />
          )}
        </div>

        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-white">{displayName}</p>
          <p className="truncate text-sm text-white/45">
            {teamName || 'Unknown team'}{position ? ` · ${position}` : ''}
          </p>
        </div>
      </div>
    </div>
  )
}
