// Route-level Suspense fallbacks. These render before a page chunk loads, so they
// stay markup-only to keep the entry bundle within the performance budget.

function Bar({ className = '' }) {
  return <div className={`rounded bg-slate-200 ${className}`} aria-hidden="true" />
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-white" role="status" aria-label="Loading page" aria-live="polite">
      <div className="animate-pulse" data-testid="page-loading-skeleton">
        <div className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-6 py-4">
            <Bar className="h-12 w-44" />
            <div className="hidden items-center gap-8 md:flex">
              <Bar className="h-4 w-16" />
              <Bar className="h-4 w-16" />
              <Bar className="h-4 w-16" />
              <Bar className="h-4 w-20" />
            </div>
            <Bar className="h-10 w-10 rounded-full md:hidden" />
          </div>
        </div>
        <div className="bg-[#f8fafc] pb-16">{children}</div>
      </div>
    </div>
  )
}

function Container({ children, className = '' }) {
  return <div className={`mx-auto w-full max-w-7xl px-6 ${className}`}>{children}</div>
}

function Heading({ action = true }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-6 pt-10">
      <div className="space-y-3">
        <Bar className="h-3 w-32" />
        <Bar className="h-9 w-72 max-w-full" />
        <Bar className="h-4 w-96 max-w-full" />
      </div>
      {action && <Bar className="h-11 w-32 rounded-md" />}
    </div>
  )
}

function Panel({ children }) {
  return <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">{children}</section>
}

function PanelHeading() {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
      <div className="space-y-3">
        <Bar className="h-7 w-48" />
        <Bar className="h-4 w-72 max-w-full" />
      </div>
      <Bar className="h-11 w-32 rounded-md" />
    </div>
  )
}

function CardGrid({ count = 3, height = 'h-56' }) {
  return (
    <div className="mt-8 grid gap-6 md:grid-cols-3">
      {Array.from({ length: count }).map((_, index) => (
        <Bar key={index} className={`${height} rounded-xl`} />
      ))}
    </div>
  )
}

function Rows({ count = 5 }) {
  return (
    <div className="mt-6 space-y-3">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="flex items-center justify-between gap-4 border-b border-slate-100 py-4">
          <div className="flex items-center gap-3">
            <Bar className="h-12 w-12 rounded-md" />
            <div className="space-y-2">
              <Bar className="h-5 w-44" />
              <Bar className="h-3 w-28" />
            </div>
          </div>
          <Bar className="h-9 w-24 rounded-md" />
        </div>
      ))}
    </div>
  )
}

export function HomeFallback() {
  return (
    <Shell>
      <div className="bg-slate-200 py-24">
        <Container className="space-y-4">
          <Bar className="h-4 w-40 bg-slate-300" />
          <Bar className="h-14 w-3/4 max-w-3xl bg-slate-300" />
          <Bar className="h-4 w-full max-w-2xl bg-slate-300" />
          <div className="flex gap-4 pt-2">
            <Bar className="h-12 w-44 rounded-md bg-slate-300" />
            <Bar className="h-12 w-44 rounded-md bg-slate-300" />
          </div>
        </Container>
      </div>
      <Container>
        <CardGrid />
        <CardGrid count={3} height="h-40" />
      </Container>
    </Shell>
  )
}

export function ShopFallback() {
  return (
    <Shell>
      <Container className="border-b border-slate-200 py-12">
        <Bar className="h-3 w-24" />
        <Bar className="mt-3 h-12 w-2/3 max-w-2xl" />
        <Bar className="mt-4 h-4 w-full max-w-xl" />
      </Container>
      <Container>
        <CardGrid count={3} height="h-44" />
        <CardGrid count={3} height="h-80" />
      </Container>
    </Shell>
  )
}

export function ProductFallback() {
  return (
    <Shell>
      <Container className="pt-10">
        <div className="grid gap-8 md:grid-cols-[1.1fr_0.9fr] lg:gap-14">
          <Bar className="h-[26rem] rounded-2xl" />
          <div className="space-y-5 md:pt-3">
            <Bar className="h-3 w-24" />
            <Bar className="h-12 w-3/4" />
            <Bar className="h-8 w-32" />
            <Bar className="h-4 w-full" />
            <Bar className="h-4 w-5/6" />
            <Bar className="h-32 w-full rounded-xl" />
          </div>
        </div>
      </Container>
    </Shell>
  )
}

export function CartFallback() {
  return (
    <Shell>
      <Container>
        <Heading action={false} />
        <div className="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <Panel>
            <Rows count={3} />
          </Panel>
          <Panel>
            <PanelHeading />
            <Bar className="mt-6 h-12 w-full rounded-md" />
          </Panel>
        </div>
      </Container>
    </Shell>
  )
}

export function CheckoutFallback() {
  return (
    <Shell>
      <Container>
        <Heading action={false} />
        <div className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <Panel>
            <PanelHeading />
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <Bar key={index} className="h-11 w-full rounded-md" />
              ))}
            </div>
            <Bar className="mt-6 h-40 w-full rounded-xl" />
          </Panel>
          <Panel>
            <PanelHeading />
            <Rows count={2} />
          </Panel>
        </div>
      </Container>
    </Shell>
  )
}

export function AccountFallback() {
  return (
    <Shell>
      <Container>
        <Heading />
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <Bar className="h-52 rounded-2xl" />
          <Bar className="h-52 rounded-2xl" />
        </div>
        <Panel>
          <PanelHeading />
          <Rows count={3} />
        </Panel>
      </Container>
    </Shell>
  )
}

export function AuthFormFallback() {
  return (
    <Shell>
      <div className="mx-auto w-full max-w-md px-6 pt-16">
        <Panel>
          <div className="space-y-3">
            <Bar className="h-3 w-24" />
            <Bar className="h-8 w-52" />
            <Bar className="h-4 w-full" />
          </div>
          <div className="mt-6 space-y-4">
            <Bar className="h-11 w-full rounded-md" />
            <Bar className="h-11 w-full rounded-md" />
            <Bar className="h-11 w-full rounded-md" />
          </div>
        </Panel>
      </div>
    </Shell>
  )
}

export function PortalFallback() {
  return (
    <Shell>
      <Container>
        <Heading />
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Bar key={index} className="h-28 rounded-xl" />
          ))}
        </div>
        <Panel>
          <PanelHeading />
          <Rows />
        </Panel>
      </Container>
    </Shell>
  )
}

export function ShopManagementFallback() {
  return (
    <Shell>
      <Container>
        <Heading />
        <Panel>
          <PanelHeading />
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Bar key={index} className="h-32 rounded-lg" />
            ))}
          </div>
        </Panel>
        <Panel>
          <PanelHeading />
          <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_12rem_auto]">
            <Bar className="h-11 w-full rounded-md" />
            <Bar className="h-11 w-full rounded-md" />
            <Bar className="h-5 w-28 self-end" />
          </div>
          <Rows count={4} />
        </Panel>
      </Container>
    </Shell>
  )
}

export function FulfillmentFallback() {
  return (
    <Shell>
      <Container>
        <Heading />
        <Panel>
          <PanelHeading />
          <div className="mt-5 flex flex-wrap gap-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <Bar key={index} className="h-11 w-44 rounded-md" />
            ))}
          </div>
          <div className="mt-6 overflow-hidden rounded-xl border border-slate-200">
            <div className="grid grid-cols-6 gap-4 bg-[#123A7A] px-4 py-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <Bar key={index} className="h-4 w-20 bg-white/40" />
              ))}
            </div>
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="grid grid-cols-6 gap-4 border-t border-slate-200 px-4 py-4">
                {Array.from({ length: 6 }).map((__, cell) => (
                  <Bar key={cell} className="h-4 w-24" />
                ))}
              </div>
            ))}
          </div>
        </Panel>
      </Container>
    </Shell>
  )
}

export function ContentFallback() {
  return (
    <Shell>
      <Container>
        <Heading action={false} />
        <Panel>
          <div className="space-y-4">
            {Array.from({ length: 10 }).map((_, index) => (
              <Bar key={index} className={index % 4 === 0 ? 'h-6 w-64' : 'h-4 w-full'} />
            ))}
          </div>
        </Panel>
      </Container>
    </Shell>
  )
}
