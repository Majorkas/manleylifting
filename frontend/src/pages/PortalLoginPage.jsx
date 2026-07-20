import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useLocation } from 'react-router-dom'
import PortalLayout from '../components/PortalLayout'
import { clearPortalSession, hasPortalSession, portalLogin } from '../utils/portalApi'
import usePageMeta from '../utils/usePageMeta'

function resolvePortalRedirectPath(location) {
  const queryParams = new URLSearchParams(String(location?.search || ''))
  const queryRedirect = String(queryParams.get('redirect') || '').trim()
  if (queryRedirect.startsWith('/portal')) return queryRedirect

  const stateRedirect = String(location?.state?.redirectTo || '').trim()
  if (stateRedirect.startsWith('/portal')) return stateRedirect

  const currentSearch = String(location?.search || '').trim()
  if (currentSearch && !currentSearch.startsWith('?redirect=')) return `/portal${currentSearch}`

  return '/portal'
}

export default function PortalLoginPage() {
  usePageMeta({
    title: 'Portal Login',
    description: 'Sign in to the Manley Lifting customer portal to access equipment reports and certificates.',
    noIndex: true,
  })

  const navigate = useNavigate()
  const location = useLocation()
  const redirectPath = resolvePortalRedirectPath(location)
  const sessionExpired = Boolean(location.state?.sessionExpired)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errorMessage, setErrorMessage] = useState(() =>
    sessionExpired ? 'Your session has expired. Please sign in again.' : '',
  )
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  useEffect(() => {
    if (!sessionExpired) return
    // Force explicit credentials after expiry instead of silently restoring via stale session markers.
    clearPortalSession()
  }, [sessionExpired])

  if (!sessionExpired && hasPortalSession()) {
    return <Navigate to={redirectPath} replace />
  }

  async function onSubmit(event) {
    event.preventDefault()
    if (submitting) return

    setErrorMessage('')
    setSubmitting(true)

    try {
      await portalLogin(username.trim(), password)
      navigate(redirectPath, { replace: true })
    } catch (error) {
      setErrorMessage(String(error?.message || 'Login failed. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PortalLayout>
      <section className="mx-auto w-full max-w-7xl px-6 py-14">
        <div className="grid gap-8 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm md:grid-cols-[1.1fr,0.9fr] md:p-10">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#C61F2A]">Customer Portal</p>
            <h1 className="mt-2 text-4xl font-extrabold text-[#123A7A] md:text-5xl">
              Access your equipment reports and certificates
            </h1>
            <p className="mt-4 max-w-xl text-slate-600">
              Sign in with your portal credentials to view company equipment, submitted inspections,
              and certification documents managed by Manley Lifting.
            </p>
            <div className="mt-8 rounded-xl border border-slate-200 bg-[#f8fafc] p-5 text-sm text-slate-600">
              Need help with login details? Contact our team on{' '}
              <a className="font-semibold text-[#123A7A]" href="tel:+35391363373">
                053 9136337
              </a>{' '}
              (Mon–Fri, 9am–5pm) or use the <Link className="font-semibold text-[#123A7A]" to="/contact">contact form</Link>.
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-2xl font-extrabold text-[#123A7A]">Portal Login</h2>

            {errorMessage && (
              <div className={`mt-4 rounded-lg border px-4 py-3 text-sm ${
                errorMessage.includes('expired')
                  ? 'border-amber-200 bg-amber-50 text-amber-700'
                  : 'border-red-200 bg-red-50 text-red-700'
              }`}>
                {errorMessage}
              </div>
            )}

            <form className="mt-6 space-y-4" onSubmit={onSubmit}>
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-slate-700">Username</span>
                <input
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2.5 text-slate-900 outline-none ring-0 transition focus:border-[#123A7A]"
                  required
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-slate-700">Password</span>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2.5 pr-24 text-slate-900 outline-none ring-0 transition focus:border-[#123A7A]"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700 transition hover:bg-slate-50"
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </label>

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-md bg-[#123A7A] px-4 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-[#0f3168] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {submitting ? 'Signing In...' : 'Sign In'}
              </button>
            </form>
          </div>
        </div>
      </section>
    </PortalLayout>
  )
}
