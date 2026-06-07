import { useEffect, useMemo, useState } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import './App.css'
import { getRegionPolicy } from './utils/cookieConsent'
import CookieConsentBanner from './components/CookieConsentBanner'
import LegalPage from './components/LegalPage'
import ContactPage from './components/ContactPage'

const navbarLogo = '/logo-navbar.png'
const heroLogo = '/logo-hero.png'

function HomePage() {
  const [, setCookieConsent] = useState(null)
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const regionPolicy = useMemo(() => getRegionPolicy(), [])

  useEffect(() => {
    function onScroll() {
      setIsScrolled(window.scrollY > 24)
    }

    onScroll()
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const legalLinks = [
    { label: 'Privacy Policy', to: '/privacy-policy' },
    { label: 'Cookie Policy', to: '/cookie-policy' },
    { label: 'Terms and Conditions', to: '/terms-and-conditions' },
    { label: 'Returns and Refunds', to: '/returns-and-refunds' },
    { label: 'Shipping and Delivery', to: '/shipping-and-delivery' },
    { label: 'Accessibility Statement', to: '/accessibility-statement' },
  ]

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header
        className={`site-header ${
          isScrolled || isMobileMenuOpen ? 'site-header--solid' : 'site-header--transparent'
        }`}
      >
        <div className="mx-auto w-full max-w-7xl px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src={navbarLogo} alt="Manley Lifting logo" className="h-12 w-auto" />
            </div>

            <nav className="hidden items-center gap-8 text-sm font-semibold md:flex">
              <a href="#services" className="nav-link">Services</a>
              <a href="#trust" className="nav-link">Certification</a>
              <Link to="/contact" className="nav-link">Contact</Link>
            </nav>

            <button
              type="button"
              className="menu-button md:hidden"
              aria-label="Toggle navigation menu"
              aria-expanded={isMobileMenuOpen}
              onClick={() => setIsMobileMenuOpen((prev) => !prev)}
            >
              <span className={`menu-icon ${isMobileMenuOpen ? 'open' : ''}`} />
            </button>
          </div>

          <nav className={`mobile-nav md:hidden ${isMobileMenuOpen ? 'open' : ''}`}>
            <a href="#services" onClick={() => setIsMobileMenuOpen(false)}>Services</a>
            <a href="#trust" onClick={() => setIsMobileMenuOpen(false)}>Certification</a>
            <Link to="/contact" onClick={() => setIsMobileMenuOpen(false)}>Contact</Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="hero-photo">
          <div className="hero-photo__overlay">
            <div className="mx-auto w-full max-w-7xl px-6 py-32 md:py-40">
              <div className="fade-up max-w-3xl">
                <img src={heroLogo} alt="Manley Lifting" className="mb-8 h-20 w-auto md:h-24" />

                <p className="max-w-2xl text-base leading-relaxed text-white/95 md:text-lg">
                  Manley Lifting is a family-run business led by Michael Manley, working alongside his wife Jackie, and proudly based in Oulart, Co. Wexford. With years of hands-on industry experience, we deliver safe, dependable lifting and handling support tailored to each customer.
                </p>

                <div className="mt-8 flex flex-wrap gap-4">
                  <Link
                    to="/contact"
                    className="rounded-md bg-[#123A7A] px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-[#0f3168]"
                  >
                    Request a Quote
                  </Link>
                  <a
                    href="#services"
                    className="rounded-md border-2 border-white px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-white hover:text-[#123A7A]"
                  >
                    Explore Services
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="services" className="border-b border-slate-200 bg-white">
          <div className="mx-auto w-full max-w-7xl px-6 py-16">
            <div className="mb-10">
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#C61F2A]">Services</p>
              <h2 className="mt-2 text-3xl font-extrabold text-[#123A7A] md:text-4xl">
                Trusted Lifting Support from Oulart, Co. Wexford
              </h2>
              <p className="mt-4 max-w-3xl text-slate-600">
                As a local family business, we combine practical expertise with personal service across inspection, training, supply, and installation.
              </p>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
              <article className="rounded-xl border border-slate-200 p-6 shadow-sm">
                <h3 className="text-xl font-bold text-[#123A7A]">Inspection, Testing and Certification</h3>
                <p className="mt-3 text-slate-600">
                  We arrange complete inspection, testing, and certification for lifting equipment to keep your operations compliant and safe.
                </p>
              </article>

              <article className="rounded-xl border border-slate-200 p-6 shadow-sm">
                <h3 className="text-xl font-bold text-[#123A7A]">Training Courses</h3>
                <p className="mt-3 text-slate-600">
                  Practical training for the safe use of cranes and lifting equipment, delivered by experienced specialists.
                </p>
              </article>

              <article className="rounded-xl border border-slate-200 p-6 shadow-sm">
                <h3 className="text-xl font-bold text-[#123A7A]">Supply and Installation</h3>
                <p className="mt-3 text-slate-600">
                  We supply and fit cranes, hoists, monorails, and jib cranes, plus chain and web slings, shackles, eyebolts, and load restraining equipment.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section id="trust" className="bg-[#f8fafc]">
          <div className="mx-auto grid w-full max-w-7xl gap-10 px-6 py-16 md:grid-cols-2 md:items-start">
            <div className="fade-up">
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#C61F2A]">Trust and Compliance</p>
              <h2 className="mt-2 text-3xl font-extrabold text-[#123A7A] md:text-4xl">
                Family Values. Professional Standards.
              </h2>
              <p className="mt-4 text-slate-600">
                At Manley Lifting, Michael and Jackie Manley have built the business on reliability, honest advice, and safety-first delivery. From our base in Oulart, Co. Wexford, we support industrial clients with certified processes and practical, site-ready knowledge.
              </p>
            </div>

            <div className="fade-up delay-1 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <ul className="space-y-4 text-slate-700">
                <li className="flex gap-3">
                  <span className="mt-2 h-2 w-2 rounded-full bg-[#C61F2A]" />
                  Owner-led service from Michael and Jackie Manley
                </li>
                <li className="flex gap-3">
                  <span className="mt-2 h-2 w-2 rounded-full bg-[#123A7A]" />
                  Certified inspection and testing workflows
                </li>
                <li className="flex gap-3">
                  <span className="mt-2 h-2 w-2 rounded-full bg-[#C61F2A]" />
                  Specialist support for cranes, hoists, monorails, and jib cranes
                </li>
                <li className="flex gap-3">
                  <span className="mt-2 h-2 w-2 rounded-full bg-[#123A7A]" />
                  Supply of slings, shackles, eyebolts, and load restraint equipment
                </li>
              </ul>
            </div>
          </div>
        </section>

        <section id="contact" className="border-t border-slate-200 bg-white">
          <div className="mx-auto w-full max-w-7xl px-6 py-16">
            <div className="rounded-2xl border border-slate-200 bg-[#123A7A] px-8 py-10 text-white">
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#fca5a5]">Ready to Start</p>
              <h2 className="mt-2 text-3xl font-extrabold md:text-4xl">
                Need Reliable Lifting Support for Your Next Project?
              </h2>
              <p className="mt-4 max-w-3xl text-slate-100">
                Speak directly with Michael and Jackie about your project requirements. From our base in Oulart, Co. Wexford, we provide responsive, professional support for inspections, certification, training, supply, and installation.
              </p>
              <div className="mt-8 flex flex-wrap gap-4">
                <Link
                  to="/contact"
                  className="rounded-md bg-[#C61F2A] px-6 py-3 text-sm font-bold uppercase tracking-wide text-white hover:bg-[#b41c25]"
                >
                  Contact Manley Lifting
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto w-full max-w-7xl px-6 py-12">
          <div className="grid gap-10 md:grid-cols-3">
            <div>
              <h3 className="text-lg font-extrabold text-[#123A7A]">Manley Lifting</h3>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">
                Family-run and based in Oulart, Co. Wexford, Manley Lifting provides trusted inspection, certification, training, and equipment support to the crane and lifting industry.
              </p>
            </div>

            <div>
              <h4 className="text-sm font-bold uppercase tracking-[0.12em] text-[#C61F2A]">Legal</h4>
              <ul className="mt-3 space-y-2 text-sm text-slate-700">
                {legalLinks.map((link) => (
                  <li key={link.label}>
                    <Link to={link.to} className="footer-link">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="text-sm font-bold uppercase tracking-[0.12em] text-[#C61F2A]">Company Details</h4>
              <ul className="mt-3 space-y-2 text-sm text-slate-700">
                <li>Family Business: Michael Manley and Jackie Manley</li>
                <li>Location: Oulart, Co. Wexford, Ireland</li>
                <li>Email: info@manleylifting.ie</li>
              </ul>
            </div>
          </div>

          <div className="mt-10 border-t border-slate-200 pt-6 text-xs text-slate-500">
            <p>
              Copyright {new Date().getFullYear()} Manley Lifting. All rights reserved.
            </p>
          </div>
        </div>
      </footer>

      <CookieConsentBanner
        regionPolicy={regionPolicy}
        onConsentChange={setCookieConsent}
      />
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/contact" element={<ContactPage />} />
      <Route path="/privacy-policy" element={<LegalPage title="Privacy Policy" />} />
      <Route path="/cookie-policy" element={<LegalPage title="Cookie Policy" />} />
      <Route path="/terms-and-conditions" element={<LegalPage title="Terms and Conditions" />} />
      <Route path="/returns-and-refunds" element={<LegalPage title="Returns and Refunds" />} />
      <Route path="/shipping-and-delivery" element={<LegalPage title="Shipping and Delivery" />} />
      <Route path="/accessibility-statement" element={<LegalPage title="Accessibility Statement" />} />
    </Routes>
  )
}
