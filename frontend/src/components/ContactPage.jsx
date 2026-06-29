import { useState } from 'react'
import emailjs from '@emailjs/browser'
import { Link } from 'react-router-dom'

export default function ContactPage() {
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
        text: 'Message sent successfully. Thank you for contacting Manley Lifting. Michael, Jackie, or a member of our team will be in touch shortly.',
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

      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h2 className="text-2xl font-extrabold text-[#123A7A]">Send Us an Enquiry</h2>
          <p className="mt-2 text-slate-600">
            Tell us about your lifting equipment requirements and a member of our family team in
            Oulart, Co. Wexford will get back to you promptly.
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
              className="rounded-md bg-[#C61F2A] px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-[#b41c25] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSubmitting ? 'Sending...' : 'Send Message'}
            </button>
          </form>
        </div>
      </main>
    </div>
  )
}
