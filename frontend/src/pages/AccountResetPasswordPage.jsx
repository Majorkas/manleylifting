import { useEffect, useMemo, useState } from 'react'
import { Eye, EyeOff, LoaderCircle, ShieldCheck } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import AccountLayout from '../components/AccountLayout'
import { completeCommercePasswordReset, requestCommercePasswordReset } from '../utils/portalApi'
import usePageMeta from '../utils/usePageMeta'

function tokenFromFragment() {
  const parameters = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''))
  return String(parameters.get('token') || '').trim()
}

export default function AccountResetPasswordPage() {
  usePageMeta({ title: 'Reset Password', description: 'Reset your Manley Lifting account password.', noIndex: true })
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [token, setToken] = useState(() => tokenFromFragment())

  useEffect(() => {
    setToken(tokenFromFragment())
  }, [location.hash])

  const isCompletionMode = useMemo(() => Boolean(token), [token])

  async function handleRequestSubmit(event) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setErrorMessage('')
    setMessage('')
    try {
      await requestCommercePasswordReset(email)
      setMessage('If an account exists, a reset email will be sent.')
    } catch (error) {
      setErrorMessage(String(error?.message || 'Unable to send a reset email right now.'))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCompletionSubmit(event) {
    event.preventDefault()
    if (submitting) return
    if (!token) {
      setErrorMessage('The reset link is missing. Request a new link and try again.')
      return
    }
    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.')
      return
    }
    setSubmitting(true)
    setErrorMessage('')
    setMessage('')
    try {
      await completeCommercePasswordReset(token, password)
      setMessage('Your password has been updated. You can sign in with your new password now.')
      setPassword('')
      setConfirmPassword('')
    } catch (error) {
      setErrorMessage(String(error?.message || 'Unable to complete the reset right now.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AccountLayout
      eyebrow={isCompletionMode ? 'Password Reset' : 'Account Recovery'}
      title={isCompletionMode ? 'Choose a new password' : 'Forgot your password?'}
      intro={isCompletionMode ? 'Use the single-use link from your email to set a new password.' : 'Enter the email on your account and we’ll send a secure reset link.'}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-[#123A7A]">
        {isCompletionMode ? <ShieldCheck size={24} aria-hidden="true" /> : <LoaderCircle size={24} aria-hidden="true" />}
      </div>
      {message && <div role="status" className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}
      {errorMessage && <div role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div>}
      {isCompletionMode ? (
        <form className="mt-6 space-y-4" onSubmit={handleCompletionSubmit}>
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700" htmlFor="reset-password">New password</label>
            <div className="relative">
              <input id="reset-password" className="w-full rounded-md border border-slate-300 px-3 py-2.5 pr-12 outline-none focus:border-[#123A7A]" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
              <button className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                {showPassword ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700" htmlFor="reset-confirm-password">Confirm password</label>
            <div className="relative">
              <input id="reset-confirm-password" className="w-full rounded-md border border-slate-300 px-3 py-2.5 pr-12 outline-none focus:border-[#123A7A]" type={showConfirmPassword ? 'text' : 'password'} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
              <button className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" type="button" onClick={() => setShowConfirmPassword((current) => !current)} aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}>
                {showConfirmPassword ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
              </button>
            </div>
          </div>
          <button className="flex w-full items-center justify-center gap-2 rounded-md bg-[#123A7A] px-4 py-3 font-bold text-white disabled:opacity-60" type="submit" disabled={submitting}>
            {submitting ? 'Updating password...' : 'Update password'}
          </button>
        </form>
      ) : (
        <form className="mt-6 space-y-4" onSubmit={handleRequestSubmit}>
          <label className="block" htmlFor="reset-email">
            <span className="mb-1 block text-sm font-semibold text-slate-700">Email address</span>
            <input id="reset-email" className="w-full rounded-md border border-slate-300 px-3 py-2.5 outline-none focus:border-[#123A7A]" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <button className="flex w-full items-center justify-center gap-2 rounded-md bg-[#123A7A] px-4 py-3 font-bold text-white disabled:opacity-60" type="submit" disabled={submitting}>
            {submitting ? 'Sending reset link...' : 'Send reset link'}
          </button>
        </form>
      )}
      <div className="mt-5 flex flex-wrap gap-3 text-sm">
        <Link className="font-semibold text-[#123A7A]" to="/account/login">Back to sign in</Link>
        <Link className="font-semibold text-[#123A7A]" to="/account/resend-verification">Resend verification</Link>
      </div>
    </AccountLayout>
  )
}
