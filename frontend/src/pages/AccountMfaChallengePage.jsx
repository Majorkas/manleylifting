import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import AccountLayout from '../components/AccountLayout'
import { getAccountBootstrap, portalLogin } from '../utils/portalApi'
import usePageMeta from '../utils/usePageMeta'

function safeRedirectPath(path) {
  const candidate = String(path || '').trim()
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) return '/account'
  const allowedRoots = ['/account', '/shop', '/cart', '/checkout', '/portal']
  return allowedRoots.some((root) => candidate === root || candidate.startsWith(`${root}/`))
    ? candidate
    : '/account'
}

export default function AccountMfaChallengePage() {
  usePageMeta({ title: 'MFA Verification', description: 'Complete multi-factor verification to sign in.', noIndex: true })
  const navigate = useNavigate()
  const location = useLocation()
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const identifier = String(location.state?.identifier || '').trim()
  const password = String(location.state?.password || '')
  const redirectTo = safeRedirectPath(location.state?.redirectTo)

  if (!identifier || !password) {
    return (
      <AccountLayout
        eyebrow="Shared Account"
        title="MFA verification"
        intro="Sign in again to continue with multi-factor authentication."
      >
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Your sign-in session expired. Please return to login and try again.
        </div>
        <div className="mt-4">
          <Link className="font-semibold text-[#123A7A]" to="/account/login">Back to sign in</Link>
        </div>
      </AccountLayout>
    )
  }

  async function onSubmit(event) {
    event.preventDefault()
    if (submitting) return

    const trimmedCode = String(code || '').trim()
    if (!trimmedCode) {
      setErrorMessage('Enter the code from your authenticator app.')
      return
    }

    setSubmitting(true)
    setErrorMessage('')

    try {
      await portalLogin(identifier, password, trimmedCode)
      await getAccountBootstrap()
      navigate(redirectTo, { replace: true })
    } catch (error) {
      setErrorMessage(String(error?.message || 'Unable to verify the code. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AccountLayout
      eyebrow="Shared Account"
      title="MFA verification"
      intro="Enter your authenticator code to finish signing in."
      aside={<>Wrong account? <Link className="font-bold text-[#123A7A]" to="/account/login">Back to sign in</Link>.</>}
    >
      <h2 className="text-2xl font-extrabold text-[#123A7A]">Enter security code</h2>
      <p className="mt-2 text-sm text-slate-600">Use the 6-digit code from your authenticator app or an active recovery code.</p>
      {errorMessage && <div role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div>}
      <form className="mt-6 space-y-4" onSubmit={onSubmit}>
        <label className="block" htmlFor="account-mfa-code">
          <span className="mb-1 block text-sm font-semibold text-slate-700">MFA code</span>
          <input
            id="account-mfa-code"
            className="w-full rounded-md border border-slate-300 px-3 py-2.5 outline-none focus:border-[#123A7A]"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            required
          />
        </label>
        <button className="w-full rounded-md bg-[#123A7A] px-4 py-3 font-bold text-white disabled:opacity-60" type="submit" disabled={submitting}>
          {submitting ? 'Verifying...' : 'Verify and continue'}
        </button>
      </form>
      <div className="mt-5 text-sm">
        <Link className="font-semibold text-[#123A7A]" to="/account/login">Back to sign in</Link>
      </div>
    </AccountLayout>
  )
}
