import { useState } from 'react'
import { Mail, Send } from 'lucide-react'
import { Link } from 'react-router-dom'
import AccountLayout from '../components/AccountLayout'
import TurnstileWidget from '../components/TurnstileWidget'
import { resendCommerceVerification } from '../utils/portalApi'
import usePageMeta from '../utils/usePageMeta'

const turnstileSiteKey = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || '').trim()

export default function AccountResendVerificationPage() {
  usePageMeta({ title: 'Resend Verification', description: 'Request a new account verification link.', noIndex: true })
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileError, setTurnstileError] = useState('')

  async function onSubmit(event) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setErrorMessage('')
    try {
      if (turnstileSiteKey && !turnstileToken) {
        setErrorMessage('Complete the security check before requesting a new link.')
        return
      }
      await resendCommerceVerification(email, turnstileToken)
      setSent(true)
    } catch (error) {
      setErrorMessage(String(error?.message || 'The request could not be completed.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AccountLayout eyebrow="Email Verification" title="Request a new link" intro="Enter the email used for your customer account.">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-[#123A7A]"><Mail size={24} aria-hidden="true" /></div>
      <h2 className="mt-5 text-2xl font-extrabold text-[#123A7A]">Verification email</h2>
      {sent ? (
        <>
          <p className="mt-3 leading-6 text-slate-600">If an unverified account exists for that address, a new link will arrive shortly.</p>
          <Link className="mt-7 inline-flex rounded-md bg-[#123A7A] px-4 py-2.5 font-semibold text-white" to="/account/login">Back to sign in</Link>
        </>
      ) : (
        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          {errorMessage && <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div>}
          <label className="block" htmlFor="resend-email">
            <span className="mb-1 block text-sm font-semibold text-slate-700">Email</span>
            <input id="resend-email" className="w-full rounded-md border border-slate-300 px-3 py-2.5 outline-none focus:border-[#123A7A]" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          {turnstileSiteKey && (
            <div>
              <TurnstileWidget siteKey={turnstileSiteKey} onTokenChange={(token) => { setTurnstileToken(token); setTurnstileError('') }} onError={() => setTurnstileError('The security check could not load. Refresh and try again.')} />
              {turnstileError && <p className="mt-2 text-sm text-red-700">{turnstileError}</p>}
            </div>
          )}
          <button className="flex w-full items-center justify-center gap-2 rounded-md bg-[#123A7A] px-4 py-3 font-bold text-white disabled:opacity-60" type="submit" disabled={submitting || Boolean(turnstileSiteKey && !turnstileToken)}>
            <Send size={18} aria-hidden="true" />
            {submitting ? 'Sending...' : 'Send verification link'}
          </button>
        </form>
      )}
    </AccountLayout>
  )
}
