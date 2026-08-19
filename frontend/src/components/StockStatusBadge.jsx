const toneClasses = {
  positive: '!border-emerald-200 !bg-emerald-50 !text-emerald-800',
  caution: '!border-amber-200 !bg-amber-50 !text-amber-900',
  negative: '!border-rose-200 !bg-rose-50 !text-rose-800',
}

export default function StockStatusBadge({ status, compact = false, className = '' }) {
  if (!status) return null

  return (
    <div
      className={`inline-flex items-center gap-2 border px-3 py-2 text-sm font-semibold ${
        compact ? 'rounded-md' : 'rounded-lg'
      } ${toneClasses[status.tone] || toneClasses.positive} ${className}`}
      role="status"
      aria-label={`${status.label}: ${status.detail}`}
    >
      <span
        className="h-2 w-2 rounded-full bg-current"
        aria-hidden="true"
      />
      <span>{status.label}</span>
      <span className="font-normal opacity-80">{status.detail}</span>
    </div>
  )
}