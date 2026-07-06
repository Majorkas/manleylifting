export default function PaginationControls({
  page,
  totalPages,
  onPrevious,
  onNext,
  buttonClassName = 'rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-700 disabled:opacity-50',
  labelClassName = 'text-xs font-semibold uppercase tracking-wide text-slate-600',
  className = 'flex items-center gap-2',
}) {
  return (
    <div className={className}>
      <button type="button" onClick={onPrevious} disabled={page === 1} className={buttonClassName}>
        Previous
      </button>
      <span className={labelClassName}>
        Page {page} of {totalPages}
      </span>
      <button type="button" onClick={onNext} disabled={page === totalPages} className={buttonClassName}>
        Next
      </button>
    </div>
  )
}
