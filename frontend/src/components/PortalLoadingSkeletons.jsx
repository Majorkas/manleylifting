function PulseBlock({ className = '' }) {
  return <div className={`animate-pulse rounded bg-slate-200 ${className}`.trim()} aria-hidden="true" />
}

export function CustomerStatsSkeleton() {
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading customer stats">
      {Array.from({ length: 3 }).map((_, index) => (
        <article key={index} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <PulseBlock className="h-3 w-28" />
          <PulseBlock className="mt-3 h-10 w-16" />
          <PulseBlock className="mt-3 h-3 w-40" />
        </article>
      ))}
    </div>
  )
}

export function CustomerCardGridSkeleton({ count = 6 }) {
  return (
    <div className="mt-6 grid gap-4 md:grid-cols-2" aria-label="Loading customers">
      {Array.from({ length: count }).map((_, index) => (
        <article key={index} className="rounded-xl border border-slate-200 p-4">
          <div className="flex items-start justify-between gap-3">
            <PulseBlock className="h-6 w-44" />
            <div className="flex flex-col items-end gap-1">
              <PulseBlock className="h-6 w-24 rounded-full" />
              <PulseBlock className="h-6 w-20 rounded-full" />
            </div>
          </div>
          <PulseBlock className="mt-3 h-4 w-64" />
          <PulseBlock className="mt-2 h-4 w-40" />
          <div className="mt-4 flex flex-wrap gap-2">
            <PulseBlock className="h-9 w-40 rounded-md" />
            <PulseBlock className="h-9 w-28 rounded-md" />
          </div>
        </article>
      ))}
    </div>
  )
}

export function EmployeeAssignmentsSkeleton({ count = 4 }) {
  return (
    <div className="mt-4 space-y-3" aria-label="Loading employee assignments">
      {Array.from({ length: count }).map((_, index) => (
        <article key={index} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <PulseBlock className="h-5 w-44" />
              <PulseBlock className="mt-2 h-4 w-56" />
              <PulseBlock className="mt-2 h-4 w-48" />
            </div>
            <div className="flex items-center gap-2">
              <PulseBlock className="h-8 w-20 rounded-full" />
              <PulseBlock className="h-8 w-20 rounded-full" />
            </div>
          </div>
          <div className="mt-4 rounded-md border border-slate-200 bg-white px-3 py-2">
            <PulseBlock className="h-3 w-28" />
            <PulseBlock className="mt-2 h-4 w-64" />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <PulseBlock className="h-8 w-28 rounded-md" />
          </div>
        </article>
      ))}
    </div>
  )
}

export function EquipmentTableSkeleton({ rows = 6 }) {
  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-slate-200" aria-label="Loading equipment">
      <div className="flex items-end gap-1 border-b border-slate-300 bg-slate-50 px-3 pt-2 pb-0.5">
        <PulseBlock className="h-10 w-40 rounded-t-lg" />
        <PulseBlock className="h-10 w-52 rounded-t-lg" />
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[920px] border-collapse text-left text-sm">
          <thead className="bg-[#123A7A] text-white">
            <tr>
              {Array.from({ length: 8 }).map((_, index) => (
                <th key={index} className="px-4 py-3 font-semibold">
                  <PulseBlock className="h-4 w-20 bg-white/40" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, rowIndex) => (
              <tr key={rowIndex} className="border-t border-slate-200 odd:bg-white even:bg-slate-50/60">
                {Array.from({ length: 8 }).map((_, colIndex) => (
                  <td key={colIndex} className="px-4 py-3">
                    <PulseBlock className={colIndex === 0 ? 'h-4 w-36' : 'h-4 w-24'} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 p-3 md:hidden">
        {Array.from({ length: 4 }).map((_, index) => (
          <article key={index} className="rounded-lg border border-slate-200 bg-white p-3">
            <PulseBlock className="h-5 w-36" />
            <PulseBlock className="mt-2 h-3 w-24" />
            <PulseBlock className="mt-2 h-3 w-44" />
            <PulseBlock className="mt-3 h-8 w-28 rounded-md" />
          </article>
        ))}
      </div>
    </div>
  )
}

export function InlineListSkeleton({ count = 3 }) {
  return (
    <div className="space-y-2" aria-label="Loading list">
      {Array.from({ length: count }).map((_, index) => (
        <article key={index} className="rounded border border-slate-200 bg-white p-2.5">
          <PulseBlock className="h-4 w-44" />
          <PulseBlock className="mt-2 h-3 w-56" />
          <PulseBlock className="mt-2 h-3 w-32" />
        </article>
      ))}
    </div>
  )
}

export function PendingApprovalsSkeleton({ count = 3 }) {
  return (
    <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Loading pending approvals">
      {Array.from({ length: count }).map((_, index) => (
        <article key={index} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <PulseBlock className="h-5 w-44" />
              <PulseBlock className="mt-2 h-4 w-56" />
            </div>
            <PulseBlock className="h-6 w-20 rounded-full" />
          </div>
          <div className="mt-3 space-y-2">
            <PulseBlock className="h-4 w-40" />
            <PulseBlock className="h-4 w-32" />
            <PulseBlock className="h-4 w-full" />
          </div>
          <PulseBlock className="mt-4 h-9 w-32 rounded-md" />
        </article>
      ))}
    </div>
  )
}

export function CertificatesSkeleton({ count = 3 }) {
  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-slate-200" aria-label="Loading certificates">
      <div className="bg-slate-50 px-4 py-3">
        <PulseBlock className="h-5 w-48" />
        <PulseBlock className="mt-2 h-4 w-72" />
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[680px] border-collapse text-left text-sm">
          <thead className="bg-[#123A7A] text-white">
            <tr>
              {Array.from({ length: 5 }).map((_, i) => (
                <th key={i} className="px-4 py-3 font-semibold">
                  <PulseBlock className="h-4 w-24 bg-white/40" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: count }).map((_, idx) => (
              <tr key={idx} className="border-t border-slate-200 odd:bg-white even:bg-slate-50/60">
                {Array.from({ length: 5 }).map((_, col) => (
                  <td key={col} className="px-4 py-3">
                    <PulseBlock className="h-4 w-32" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 p-3 md:hidden">
        {Array.from({ length: 3 }).map((_, index) => (
          <article key={index} className="rounded-lg border border-slate-200 bg-white p-3">
            <PulseBlock className="h-4 w-40" />
            <PulseBlock className="mt-2 h-3 w-56" />
            <PulseBlock className="mt-3 h-8 w-24 rounded-md" />
          </article>
        ))}
      </div>
    </div>
  )
}

export function ReportsSkeleton({ count = 4 }) {
  return (
    <div className="mt-6 space-y-4" aria-label="Loading reports">
      {Array.from({ length: count }).map((_, index) => (
        <article key={index} className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <PulseBlock className="h-5 w-56" />
              <PulseBlock className="mt-2 h-4 w-44" />
              <div className="mt-3 flex flex-wrap gap-2">
                <PulseBlock className="h-6 w-20 rounded-full" />
                <PulseBlock className="h-6 w-24 rounded-full" />
              </div>
            </div>
            <PulseBlock className="h-8 w-28 rounded-md" />
          </div>
          <PulseBlock className="mt-4 h-16 w-full" />
        </article>
      ))}
    </div>
  )
}

export function EquipmentActivitySkeleton({ count = 5 }) {
  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-slate-200" aria-label="Loading equipment activity">
      <div className="flex items-center justify-between gap-3 bg-slate-50 px-4 py-3">
        <PulseBlock className="h-5 w-40" />
        <div className="flex gap-2">
          <PulseBlock className="h-6 w-32 rounded-full" />
          <PulseBlock className="h-6 w-40 rounded-full" />
        </div>
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-[#123A7A] text-white">
            <tr>
              {Array.from({ length: 5 }).map((_, i) => (
                <th key={i} className="px-4 py-3 font-semibold">
                  <PulseBlock className="h-4 w-20 bg-white/40" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: count }).map((_, idx) => (
              <tr key={idx} className="border-t border-slate-200 odd:bg-white even:bg-slate-50/60">
                {Array.from({ length: 5 }).map((_, col) => (
                  <td key={col} className="px-4 py-3">
                    <PulseBlock className={col === 0 ? 'h-4 w-32' : 'h-4 w-28'} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 p-3 md:hidden">
        {Array.from({ length: 4 }).map((_, index) => (
          <article key={index} className="rounded-lg border border-slate-200 bg-white p-3">
            <PulseBlock className="h-4 w-32" />
            <PulseBlock className="mt-2 h-3 w-40" />
            <PulseBlock className="mt-2 h-3 w-36" />
            <PulseBlock className="mt-3 h-8 w-20 rounded-md" />
          </article>
        ))}
      </div>
    </div>
  )
}

export function CompanyProfileSkeleton() {
  return (
    <article className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" aria-label="Loading company profile">
      <div className="flex flex-wrap items-start gap-5">
        <PulseBlock className="h-20 w-20 rounded-xl" />
        <div className="min-w-[240px] flex-1">
          <PulseBlock className="h-8 w-48" />
          <PulseBlock className="mt-3 h-4 w-32" />
          <div className="mt-3 grid gap-2">
            <PulseBlock className="h-4 w-full" />
            <PulseBlock className="h-4 w-5/6" />
            <PulseBlock className="mt-2 h-4 w-full" />
          </div>
          <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <PulseBlock className="h-5 w-20" />
            <div className="mt-4 flex flex-wrap gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <PulseBlock key={i} className="h-10 w-24 rounded-full" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}
