import { Link } from 'react-router-dom'
import PortalLayout from '../components/PortalLayout'
import usePageMeta from '../utils/usePageMeta'

export default function StoreWorkInProgressPage() {
  usePageMeta({
    title: 'Store Updates In Progress',
    description: 'Our online store is being improved. Please check back shortly.',
    noIndex: true,
  })

  return (
    <PortalLayout>
      <section className="mx-auto w-full max-w-4xl px-6 py-14 md:py-16">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm md:p-10">
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#C61F2A]">Store Update</p>
          <h1 className="mt-2 text-3xl font-extrabold text-[#123A7A] md:text-4xl">
            Online Store Work In Progress
          </h1>
          <p className="mt-4 text-slate-600">
            We are currently improving the store experience to make ordering faster and more reliable.
            Thank you for your patience while this work is completed.
          </p>
          <p className="mt-2 text-slate-600">
            If you need assistance with products or a quote in the meantime, our team is ready to help.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/"
              className="rounded-md bg-[#123A7A] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f3168]"
            >
              Back to Home
            </Link>
            <Link
              to="/contact"
              className="rounded-md border border-[#123A7A] bg-white px-4 py-2 text-sm font-semibold text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
            >
              Contact Us
            </Link>
          </div>
        </div>
      </section>
    </PortalLayout>
  )
}
