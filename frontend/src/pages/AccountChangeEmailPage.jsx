import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, CircleAlert, LoaderCircle, MailCheck } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import AccountLayout from '../components/AccountLayout'
import { completeAccountEmailChange, requestAccountEmailChange } from '../utils/portalApi'
import usePageMeta from '../utils/usePageMeta'

function tokenFromFragment() {
  const parameters = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''))
  return String(parameters.get('token') || '').trim()
}

function safeRedirectPath(search) {
  const params = new URLSearchParams(String(search || ''))
  const candidate = String(params.get('redirect') || '').trim()
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) return '/account'
  const allowedRoots = ['/account', '/shop', '/cart', '/checkout', '/portal']
  return allowedRoots.some((root) => candidate === root || candidate.startsWith(`${root}/`))
    ? candidate
    : '/account'
}

export default function AccountChangeEmailPage() {
  usePageMeta({ title: 'Change Email', description: 'Confirm your new Manley Lifting email address.', noIndex: true })
  const location = useLocation()
  const [verification] = useState(() => ({ token: tokenFromFragment(), initialState: tokenFromFragment() ? 'verifying' : 'missing' }))
  const [state, setState] = useState(verification.initialState)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [requestMessage, setRequestMessage] = useState('')
  const [requestError, setRequestError] = useState('')
  const startedRef = useRef(false)
  const redirectTo = safeRedirectPath(location.search)
  const loginWithRedirect = `/account/login?redirect=${encodeURIComponent(redirectTo)}`

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    if (!verification.token) return

    completeAccountEmailChange(verification.token)
      .then(() => setState('verified'))
      .catch(() => setState('invalid'))
  }, [verification])

  const successful = state === 'verified'
  const pending = state === 'verifying'

  async function handleRequestSubmit(event) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setRequestMessage('')
    setRequestError('')

    try {
      await requestAccountEmailChange({
        currentPassword,
        newEmail,
      })
      setRequestMessage('We sent a confirmation link to your new email address. Open that email to complete the change.')
      setCurrentPassword('')
      setNewEmail('')
    } catch (error) {
      setRequestError(String(error?.message || 'Unable to start email change right now.'))
    } finally {
      setSubmitting(false)
    }
  }

  if (!verification.token) {
    return (
      <AccountLayout
        eyebrow="Email Change"
        title="Change your email"
        intro="Confirm your current password and enter the new email you want to use for sign in."
      >
        <h2 className="text-2xl font-extrabold text-[#123A7A]">Request email change</h2>
        {requestMessage && <div role="status" className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{requestMessage}</div>}
        {requestError && <div role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{requestError}</div>}

        <form className="mt-6 space-y-4" onSubmit={handleRequestSubmit}>
          <label className="block" htmlFor="account-change-email-current-password">
            <span className="mb-1 block text-sm font-semibold text-slate-700">Current password</span>
            <input
              id="account-change-email-current-password"
              className="w-full rounded-md border border-slate-300 px-3 py-2.5 outline-none focus:border-[#123A7A]"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
          </label>

          <label className="block" htmlFor="account-change-email-new-email">
            <span className="mb-1 block text-sm font-semibold text-slate-700">New email</span>
            <input
              id="account-change-email-new-email"
              className="w-full rounded-md border border-slate-300 px-3 py-2.5 outline-none focus:border-[#123A7A]"
              type="email"
              autoComplete="email"
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
              required
            />
          </label>

          <button className="rounded-md bg-[#123A7A] px-4 py-2.5 font-semibold text-white disabled:opacity-60" type="submit" disabled={submitting}>
            {submitting ? 'Sending confirmation...' : 'Send confirmation email'}
          </button>
        </form>

        <div className="mt-6">
          <Link className="font-semibold text-[#123A7A]" to="/account/security">Back to security</Link>
        </div>
      </AccountLayout>
    )
  }

  return (
    <AccountLayout
      eyebrow="Email Change"
      title={pending ? 'Confirming your new email' : successful ? 'Email updated' : 'Confirmation unavailable'}
      intro={pending ? 'Keep this page open while we confirm the one-time email-change link.' : successful ? 'Your account email has been updated. Sign in again if needed.' : 'The link is missing, expired, or has already been used.'}
      headerAction={(
        <Link to="/account" className="inline-flex items-center gap-2 text-sm font-semibold text-[#123A7A]">
          <ArrowLeft size={16} aria-hidden="true" /> Back to account
        </Link>
      )}
    >
      <div className={`flex h-12 w-12 items-center justify-center rounded-full ${successful ? 'bg-emerald-100 text-emerald-700' : pending ? 'bg-blue-100 text-[#123A7A]' : 'bg-red-100 text-red-700'}`}>
        {successful ? <MailCheck size={24} aria-hidden="true" /> : pending ? <LoaderCircle className="animate-spin" size={24} aria-hidden="true" /> : <CircleAlert size={24} aria-hidden="true" />}
      </div>
      <h2 className="mt-5 text-2xl font-extrabold text-[#123A7A]">{successful ? 'Email change confirmed' : pending ? 'Checking link' : 'Try again'}</h2>
      {!pending && (
        <div className="mt-7 flex flex-wrap gap-3">
          {successful && <Link className="rounded-md bg-[#123A7A] px-4 py-2.5 font-semibold text-white" to={loginWithRedirect}>Sign in</Link>}
          <Link className="rounded-md border border-slate-300 px-4 py-2.5 font-semibold text-[#123A7A]" to="/">Home</Link>
        </div>
      )}
    </AccountLayout>
  )
}
