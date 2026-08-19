import { Link } from 'react-router-dom'
import PortalEntryLink from './PortalEntryLink'

export default function HeroSection({ heroLogo }) {
  return (
    <section aria-labelledby="home-heading" className="hero-photo">
      <div className="hero-photo__overlay">
        <div className="mx-auto w-full max-w-7xl px-6 py-32 md:py-40">
          <div className="fade-up max-w-3xl">
            <img
              src={heroLogo}
              alt="Manley Lifting"
              fetchPriority="high"
              decoding="async"
              className="mb-8 h-20 w-auto md:h-24"
            />

            <h1 id="home-heading" className="sr-only">Manley Lifting</h1>

            <p className="max-w-2xl text-base leading-relaxed text-white/95 md:text-lg">
              Inspection, certification, training, and lifting equipment support for industrial teams across Ireland. Clear documentation, practical expertise, and safety-first delivery from planning through completion.
            </p>

            <div className="mt-8 flex flex-wrap gap-4">
              <PortalEntryLink
                className="rounded-md bg-white px-6 py-3 text-sm font-bold uppercase tracking-wide text-[#123A7A] transition hover:bg-slate-100"
              >
                Open customer portal
              </PortalEntryLink>
              <Link
                to="/contact"
                className="rounded-md bg-[#123A7A] px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-[#0f3168]"
              >
                Talk to our team
              </Link>
              <a
                href="#services"
                className="rounded-md border-2 border-white/70 px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-white hover:text-[#123A7A]"
              >
                See our services
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
