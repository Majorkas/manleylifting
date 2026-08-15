import { useEffect, useState } from 'react'
import { Eye, EyeOff, LogIn } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import AccountLayout from '../components/AccountLayout'
import { getAccountBootstrap, hasPortalSession, portalLogin } from '../utils/portalApi'
import usePageMeta from '../utils/usePageMeta'

function safeRedirect(search) {
  const candidate = String(new URLSearchParams(search).get('redirect') || '').trim()
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) return ''
  const allowedRoots = ['/account', '/shop', '/cart', '/checkout', '/portal']
  return allowedRoots.some((root) => candidate === root || candidate.startsWith(`${root}/`))
    ? candidate
    : ''
}

export default function AccountLoginPage() {
  usePageMeta({ title: 'Account Sign In', description: 'Sign in to your Manley Lifting account.', noIndex: true })
  const location = useLocation()
  const navigate = useNavigate()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (!hasPortalSession()) return undefined

    let cancelled = false
    getAccountBootstrap()
      .then(() => {
        if (!cancelled) navigate('/account', { replace: true })
      })
      .catch(() => {
        // A failed refresh clears the session and leaves the sign-in form available.
      })

    return () => {
      cancelled = true
    }
  }, [navigate])

  async function onSubmit(event) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setErrorMessage('')
    const normalizedIdentifier = identifier.trim()
    const requestedRedirect = safeRedirect(location.search)
    try {
      await portalLogin(normalizedIdentifier, password)
      await getAccountBootstrap()
      const defaultRedirect = '/account'
      navigate(requestedRedirect || defaultRedirect, { replace: true })
    } catch (error) {
      const detail = String(error?.body?.detail || error?.message || '').toLowerCase()
      if (detail.includes('multi-factor authentication code is required')) {
        navigate('/account/login/mfa', {
          replace: true,
          state: {
            identifier: normalizedIdentifier,
            password,
            redirectTo: requestedRedirect || '/account',
          },
        })
        return
      }
      setErrorMessage(String(error?.message || 'Sign in failed. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AccountLayout
      eyebrow="Shared Account"
      title="Sign in once"
      intro="Use the same secure identity for online orders and any portal access assigned to you."
      aside={<>New customer? <Link className="font-bold text-[#123A7A]" to="/account/register">Create an account</Link>.</>}
    >
      <h2 className="text-2xl font-extrabold text-[#123A7A]">Account sign in</h2>
      {errorMessage && <div role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div>}
      <form className="mt-6 space-y-4" onSubmit={onSubmit}>
        <label className="block" htmlFor="account-identifier">
          <span className="mb-1 block text-sm font-semibold text-slate-700">Email or portal username</span>
          <input id="account-identifier" className="w-full rounded-md border border-slate-300 px-3 py-2.5 outline-none focus:border-[#123A7A]" autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} required />
        </label>
        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-700" htmlFor="account-password">Password</label>
          <div className="relative">
            <input id="account-password" className="w-full rounded-md border border-slate-300 px-3 py-2.5 pr-12 outline-none focus:border-[#123A7A]" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            <button className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? 'Hide password' : 'Show password'} title={showPassword ? 'Hide password' : 'Show password'}>
              {showPassword ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
            </button>
          </div>
        </div>
        <button className="flex w-full items-center justify-center gap-2 rounded-md bg-[#123A7A] px-4 py-3 font-bold text-white disabled:opacity-60" type="submit" disabled={submitting}>
          <LogIn size={19} aria-hidden="true" />
          {submitting ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
      <div className="mt-5 flex flex-wrap justify-between gap-3 text-sm">
        <Link className="font-semibold text-[#123A7A]" to="/account/reset-password">Forgot password?</Link>
        <Link className="font-semibold text-[#123A7A]" to="/account/resend-verification">Resend verification</Link>
        <Link className="font-semibold text-[#123A7A]" to="/contact">Need help?</Link>
      </div>
    </AccountLayout>
  )
}
