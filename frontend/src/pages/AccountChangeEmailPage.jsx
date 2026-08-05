import { useEffect, useRef, useState } from 'react'
import { CircleAlert, LoaderCircle, MailCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import AccountLayout from '../components/AccountLayout'
import { completeAccountEmailChange } from '../utils/portalApi'
import usePageMeta from '../utils/usePageMeta'

function tokenFromFragment() {
  const parameters = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''))
  return String(parameters.get('token') || '').trim()
}

export default function AccountChangeEmailPage() {
  usePageMeta({ title: 'Change Email', description: 'Confirm your new Manley Lifting email address.', noIndex: true })
  const [verification] = useState(() => ({ token: tokenFromFragment(), initialState: tokenFromFragment() ? 'verifying' : 'missing' }))
  const [state, setState] = useState(verification.initialState)
  const startedRef = useRef(false)

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
  return (
    <AccountLayout
      eyebrow="Email Change"
      title={pending ? 'Confirming your new email' : successful ? 'Email updated' : 'Confirmation unavailable'}
      intro={pending ? 'Keep this page open while we confirm the one-time email-change link.' : successful ? 'Your account email has been updated. Sign in again if needed.' : 'The link is missing, expired, or has already been used.'}
    >
      <div className={`flex h-12 w-12 items-center justify-center rounded-full ${successful ? 'bg-emerald-100 text-emerald-700' : pending ? 'bg-blue-100 text-[#123A7A]' : 'bg-red-100 text-red-700'}`}>
        {successful ? <MailCheck size={24} aria-hidden="true" /> : pending ? <LoaderCircle className="animate-spin" size={24} aria-hidden="true" /> : <CircleAlert size={24} aria-hidden="true" />}
      </div>
      <h2 className="mt-5 text-2xl font-extrabold text-[#123A7A]">{successful ? 'Email change confirmed' : pending ? 'Checking link' : 'Try again'}</h2>
      {!pending && (
        <div className="mt-7 flex flex-wrap gap-3">
          {successful && <Link className="rounded-md bg-[#123A7A] px-4 py-2.5 font-semibold text-white" to="/account/login">Sign in</Link>}
          {!successful && <Link className="rounded-md border border-slate-300 px-4 py-2.5 font-semibold text-[#123A7A]" to="/account">Back to account</Link>}
          <Link className="rounded-md border border-slate-300 px-4 py-2.5 font-semibold text-[#123A7A]" to="/">Home</Link>
        </div>
      )}
    </AccountLayout>
  )
}
