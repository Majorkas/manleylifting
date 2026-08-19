import { Link } from 'react-router-dom'

export default function ContactCtaSection() {
  return (
    <section id="contact" aria-labelledby="contact-heading" className="border-t border-slate-200 bg-white">
      <div className="mx-auto w-full max-w-7xl px-6 py-16">
        <div className="rounded-2xl border border-slate-200 bg-[#123A7A] px-8 py-10 text-white">
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#fca5a5]">Ready to Start</p>
          <h2 id="contact-heading" className="mt-2 text-balance text-3xl font-extrabold md:text-4xl">
            Plan your next inspection or lifting project
          </h2>
          <p className="mt-4 max-w-3xl text-slate-100">
            Tell us what your site needs. We can help with inspections, certification, training, equipment supply, and installation.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Link
              to="/contact"
              className="rounded-md bg-[#C61F2A] px-6 py-3 text-sm font-bold uppercase tracking-wide text-white hover:bg-[#b41c25]"
            >
              Talk to our team
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
