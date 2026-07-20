import { Link } from 'react-router-dom'

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
    <section id="portal-platform" className="border-b border-slate-200 bg-white">
      <div className="mx-auto w-full max-w-7xl px-6 py-16">
        <div className="grid gap-8 md:grid-cols-[1.1fr,0.9fr] md:items-start">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#C61F2A]">Customer Portal</p>
            <h2 className="mt-2 text-3xl font-extrabold text-[#123A7A] md:text-4xl">
              A Full Digital Workspace for Compliance and Inspection Operations
            </h2>
            <p className="mt-4 max-w-3xl text-slate-600">
              The Manley Lifting portal gives your team a professional environment to manage inspection activity,
              monitor equipment readiness, and keep certification records organized and accessible.
            </p>
            <div className="mt-6">
              <Link
                to="/portal/login"
                className="rounded-md bg-[#123A7A] px-5 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-[#0f3168]"
              >
                Open Customer Portal
              </Link>
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
