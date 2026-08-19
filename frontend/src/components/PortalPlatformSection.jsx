import PortalEntryLink from './PortalEntryLink'

const portalFeatures = [
  {
    title: 'Asset Visibility',
    description:
      'Track equipment status, inspection timelines, and due dates across your company from one secure dashboard.',
  },
  {
    title: 'Report Management',
    description:
      'Create, review, and approve inspection reports with structured checklist records, notes, and supporting images.',
  },
  {
    title: 'Certificate Access',
    description:
      'View and retrieve up-to-date certification outputs quickly, with clear status indicators and compliance context.',
  },
]

export default function PortalPlatformSection() {
  return (
    <section id="portal-platform" aria-labelledby="portal-platform-heading" className="border-b border-slate-200 bg-white">
      <div className="mx-auto w-full max-w-7xl px-6 py-16">
        <div className="grid gap-8 md:grid-cols-[1.1fr,0.9fr] md:items-start">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#C61F2A]">Customer Portal</p>
            <h2 id="portal-platform-heading" className="mt-2 text-balance text-3xl font-extrabold text-[#123A7A] md:text-4xl">
              Keep your inspection work in one secure workspace
            </h2>
            <p className="mt-4 max-w-3xl text-slate-600">
              Track equipment, review reports, and retrieve certification records without chasing paperwork or email threads.
            </p>
            <div className="mt-6">
              <PortalEntryLink
                className="rounded-md bg-[#123A7A] px-5 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-[#0f3168]"
              >
                Open customer portal
              </PortalEntryLink>
            </div>
          </div>

          <div className="grid gap-4">
            {portalFeatures.map((feature) => (
              <article key={feature.title} className="rounded-xl border border-slate-200 bg-[#f8fafc] p-5 shadow-sm">
                <h3 className="text-lg font-bold text-[#123A7A]">{feature.title}</h3>
                <p className="mt-2 text-sm text-slate-600">{feature.description}</p>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
