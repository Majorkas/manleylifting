import { useState, useEffect } from 'react'
import emailjs from '@emailjs/browser'
import { Link } from 'react-router-dom'
import usePageMeta from '../utils/usePageMeta'

export default function ContactPage() {
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  usePageMeta({
    title: 'Contact',
    description:
      'Contact Manley Lifting for lifting equipment inspections, servicing, certification, and product enquiries.',
  })

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    message: '',
  })
  const [status, setStatus] = useState({ type: '', text: '' })
  const [isSubmitting, setIsSubmitting] = useState(false)

  function onChange(event) {
    const { name, value } = event.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  async function onSubmit(event) {
    event.preventDefault()
    setStatus({ type: '', text: '' })
    setIsSubmitting(true)

    try {
      const publicKey = import.meta.env.VITE_EMAILJS_PUBLIC_KEY
      const serviceId = import.meta.env.VITE_EMAILJS_SERVICE_ID
      const internalTemplateId = import.meta.env.VITE_EMAILJS_TEMPLATE_ID
      const autoReplyTemplateId = import.meta.env.VITE_EMAILJS_AUTOREPLY_TEMPLATE_ID

      if (!publicKey || !serviceId || !internalTemplateId || !autoReplyTemplateId) {
        throw new Error('Missing one or more EmailJS environment variables')
      }

      const templateParams = {
        from_name: form.name,
        from_email: form.email,
        phone: form.phone || 'Not provided',
        company: form.company || 'Not provided',
        message: form.message,
      }

      await emailjs.send(serviceId, internalTemplateId, templateParams, { publicKey })
      await emailjs.send(serviceId, autoReplyTemplateId, templateParams, { publicKey })

      setStatus({
        type: 'success',
        text: 'Message sent successfully. Thank you for contacting Manley Lifting. A member of our team will be in touch shortly.',
      })

      setForm({
        name: '',
        email: '',
        phone: '',
        company: '',
        message: '',
      })
    } catch (error) {
      console.error('EmailJS dual-send failed:', error)
      setStatus({
        type: 'error',
        text: 'Your message could not be sent right now. Please try again in a moment.',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-4">
          <Link to="/" aria-label="Go to homepage">
            <img
              src="/logo-navbar.png"
              alt="Manley Lifting logo"
              className="h-12 w-auto md:h-14"
            />
          </Link>

          <Link to="/" className="text-sm font-semibold text-[#123A7A] hover:text-[#C61F2A]">
            Back to Home
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-6 py-12">
        <section className="rounded-2xl border border-slate-200 bg-gradient-to-r from-[#123A7A] to-[#1e4d99] p-8 text-white shadow-sm md:p-10">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-red-200">New Customer Enquiry</p>
          <h1 className="mt-2 text-3xl font-extrabold md:text-4xl">Get Your Lifting Operations Inspection-Ready</h1>
          <p className="mt-3 max-w-3xl text-slate-100">
            Tell us about your project. Whether you need equipment inspections, certification, training, or supply,
            our specialist team will respond with a tailored plan and timeline. No pressure—just practical advice.
          </p>
          <div className="mt-6 flex flex-wrap gap-3 text-xs font-semibold uppercase tracking-wide">
            <span className="rounded-full border border-white/30 bg-white/10 px-3 py-1.5">✓ Same-week Response</span>
            <span className="rounded-full border border-white/30 bg-white/10 px-3 py-1.5">✓ No Hidden Costs</span>
            <span className="rounded-full border border-white/30 bg-white/10 px-3 py-1.5">✓ Proven Track Record</span>
          </div>
        </section>

        <section className="mt-8 grid gap-6 md:grid-cols-3">
          <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="font-bold text-[#123A7A]">Equipment Inspections</h3>
            <p className="mt-2 text-xs text-slate-600">Certified testing and compliance documentation for cranes, hoists, monorails, and jib cranes.</p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="font-bold text-[#123A7A]">Training & Certification</h3>
            <p className="mt-2 text-xs text-slate-600">Practical courses for safe equipment operation, delivered by experienced specialists.</p>
          </article>
          <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="font-bold text-[#123A7A]">Supply & Installation</h3>
            <p className="mt-2 text-xs text-slate-600">Full sourcing and fit of lifting equipment, slings, shackles, and load restraint systems.</p>
          </article>
        </section>

        <section className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-6 md:p-8">
          <p className="text-sm font-bold uppercase tracking-wide text-amber-900">Why Choose Manley Lifting</p>
          <h2 className="mt-2 text-2xl font-extrabold text-amber-900">Specialist Team. Transparent Process. Real Results.</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="flex gap-3">
              <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-amber-700" />
              <p className="text-sm text-amber-800"><strong>Responsive:</strong> Reply within hours, not days.</p>
            </div>
            <div className="flex gap-3">
              <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-amber-700" />
              <p className="text-sm text-amber-800"><strong>Compliant:</strong> Full certified inspection workflows and documentation.</p>
            </div>
            <div className="flex gap-3">
              <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-amber-700" />
              <p className="text-sm text-amber-800"><strong>Nationwide:</strong> Based in Oulart, serving industrial clients across Ireland.</p>
            </div>
            <div className="flex gap-3">
              <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-amber-700" />
              <p className="text-sm text-amber-800"><strong>Your Data:</strong> Customer portal gives you full access and transparency.</p>
            </div>
          </div>
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-[1.25fr,0.75fr]">
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <h2 className="text-2xl font-extrabold text-[#123A7A]">Start a Conversation</h2>
            <p className="mt-2 text-slate-600">
              Tell us about your project. Include timelines, location, equipment details, and any compliance context.
            </p>

            <form className="mt-8 space-y-5" onSubmit={onSubmit}>
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Full Name</label>
                <input
                  name="name"
                  value={form.name}
                  onChange={onChange}
                  required
                  className="w-full rounded-md border border-slate-300 px-4 py-3 text-slate-900 outline-none transition focus:border-[#123A7A] focus:ring-2 focus:ring-[#123A7A]/20"
                />
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">Email</label>
                  <input
                    type="email"
                    name="email"
                    value={form.email}
                    onChange={onChange}
                    required
                    className="w-full rounded-md border border-slate-300 px-4 py-3 text-slate-900 outline-none transition focus:border-[#123A7A] focus:ring-2 focus:ring-[#123A7A]/20"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">Phone</label>
                  <input
                    name="phone"
                    value={form.phone}
                    onChange={onChange}
                    className="w-full rounded-md border border-slate-300 px-4 py-3 text-slate-900 outline-none transition focus:border-[#123A7A] focus:ring-2 focus:ring-[#123A7A]/20"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Company</label>
                <input
                  name="company"
                  value={form.company}
                  onChange={onChange}
                  className="w-full rounded-md border border-slate-300 px-4 py-3 text-slate-900 outline-none transition focus:border-[#123A7A] focus:ring-2 focus:ring-[#123A7A]/20"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Message</label>
                <textarea
                  name="message"
                  value={form.message}
                  onChange={onChange}
                  rows={6}
                  required
                  className="w-full rounded-md border border-slate-300 px-4 py-3 text-slate-900 outline-none transition focus:border-[#123A7A] focus:ring-2 focus:ring-[#123A7A]/20"
                />
              </div>

              {status.text ? (
                <p
                  className={
                    status.type === 'success'
                      ? 'text-sm font-medium text-green-700'
                      : 'text-sm font-medium text-red-700'
                  }
                >
                  {status.text}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-md bg-[#C61F2A] px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-[#b41c25] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isSubmitting ? 'Sending...' : 'Send Enquiry'}
              </button>
            </form>
          </div>

          <aside className="space-y-4">
            <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-bold text-[#123A7A]">Direct Contact</h3>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Email</p>
              <p className="mt-1 text-sm font-medium text-[#123A7A]">michael@manleylifting.ie</p>
              <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Phone</p>
              <p className="mt-1 text-sm font-medium text-[#123A7A]">053 9136337</p>
              <p className="mt-1 text-xs text-slate-500">Mon–Fri, 9am–5pm</p>
              <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Based</p>
              <p className="mt-1 text-sm text-slate-600">Oulart, Co. Wexford, Ireland</p>
            </article>

            <article className="rounded-2xl border border-blue-200 bg-blue-50 p-6 shadow-sm">
              <h3 className="text-lg font-bold text-[#123A7A]">Help Us Help You</h3>
              <ul className="mt-3 space-y-2 text-xs text-slate-700">
                <li>✓ Site/company location</li>
                <li>✓ Equipment type (cranes, hoists, etc.)</li>
                <li>✓ What you need (inspection, certification, supply, training)</li>
                <li>✓ Your timeline</li>
              </ul>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-gradient-to-br from-[#123A7A] to-[#0f3168] p-6 text-white shadow-sm">
              <h3 className="font-bold">Already Working With Us?</h3>
              <p className="mt-2 text-xs text-slate-100">
                Access your inspection reports, certificates, and equipment status with full transparency.
              </p>
              <Link
                to="/portal/login"
                className="mt-4 inline-flex w-full justify-center rounded-md border border-white bg-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/30"
              >
                Customer Portal
              </Link>
            </article>
          </aside>
        </section>
      </main>
    </div>
  )
}
