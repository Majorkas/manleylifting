import { Link } from 'react-router-dom'

export default function HeroSection({ heroLogo }) {
  return (
    <section className="hero-photo">
      <div className="hero-photo__overlay">
        <div className="mx-auto w-full max-w-7xl px-6 py-32 md:py-40">
          <div className="fade-up max-w-3xl">
            <img src={heroLogo} alt="Manley Lifting" className="mb-8 h-20 w-auto md:h-24" />

            <p className="max-w-2xl text-base leading-relaxed text-white/95 md:text-lg">
              Manley Lifting is a specialist team delivering inspection, certification, and lifting support for industrial clients across Ireland. We combine technical expertise, clear communication, and safety-first execution on every project.
            </p>

            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                to="/portal/login"
                className="rounded-md bg-white px-6 py-3 text-sm font-bold uppercase tracking-wide text-[#123A7A] transition hover:bg-slate-100"
              >
                Customer Portal
              </Link>
              <Link
                to="/contact"
                className="rounded-md bg-[#123A7A] px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-[#0f3168]"
              >
                Request a Quote
              </Link>
              <a
                href="#services"
                className="rounded-md border-2 border-white/70 px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-white hover:text-[#123A7A]"
              >
                Explore Services
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
