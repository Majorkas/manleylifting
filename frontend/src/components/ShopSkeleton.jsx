export function CollectionGridSkeleton({ count = 3 }) {
  return (
    <div className="grid gap-6 md:grid-cols-3">
      {Array.from({ length: count }).map((_, index) => (
        <article key={index} className="rounded-xl border border-slate-200 p-6 shadow-sm">
          <div className="h-5 w-32 animate-pulse rounded bg-slate-200" />
          <div className="mt-3 h-4 w-full animate-pulse rounded bg-slate-200" />
          <div className="mt-2 h-4 w-5/6 animate-pulse rounded bg-slate-200" />
        </article>
      ))}
    </div>
  )
}

export function ProductGridSkeleton({ count = 3 }) {
  return (
    <div className="grid gap-6 md:grid-cols-3">
      {Array.from({ length: count }).map((_, index) => (
        <article key={index} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="aspect-[4/3] animate-pulse rounded-lg bg-slate-200" />
          <div className="mt-5 h-6 w-3/4 animate-pulse rounded bg-slate-200" />
          <div className="mt-3 h-5 w-1/3 animate-pulse rounded bg-slate-200" />
          <div className="mt-3 h-4 w-full animate-pulse rounded bg-slate-200" />
          <div className="mt-2 h-4 w-5/6 animate-pulse rounded bg-slate-200" />
          <div className="mt-6 h-10 w-full animate-pulse rounded-md bg-slate-200" />
        </article>
      ))}
    </div>
  )
}

export function ProductDetailSkeleton() {
  return (
    <div className="grid gap-10 md:grid-cols-2 md:items-start">
      <div className="aspect-[4/3] animate-pulse rounded-2xl bg-slate-200" />
      <div>
        <div className="h-4 w-28 animate-pulse rounded bg-slate-200" />
        <div className="mt-4 h-12 w-5/6 animate-pulse rounded bg-slate-200" />
        <div className="mt-6 h-8 w-32 animate-pulse rounded bg-slate-200" />
        <div className="mt-6 space-y-3">
          <div className="h-4 w-full animate-pulse rounded bg-slate-200" />
          <div className="h-4 w-11/12 animate-pulse rounded bg-slate-200" />
          <div className="h-4 w-10/12 animate-pulse rounded bg-slate-200" />
        </div>
        <div className="mt-8 h-10 w-full animate-pulse rounded-md bg-slate-200" />
        <div className="mt-6 h-12 w-48 animate-pulse rounded-md bg-slate-200" />
      </div>
    </div>
  )
}
