import { useState } from 'react'
import { Eye, EyeOff, MailCheck, UserPlus } from 'lucide-react'
import { Link } from 'react-router-dom'
import AccountLayout from '../components/AccountLayout'
import TurnstileWidget from '../components/TurnstileWidget'
import { registerCommerceAccount } from '../utils/portalApi'
import usePageMeta from '../utils/usePageMeta'

const turnstileSiteKey = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || '').trim()

export default function AccountRegisterPage() {
  usePageMeta({
    title: 'Create Account',
    description: 'Create a Manley Lifting customer account for secure online ordering.',
    noIndex: true,
  })
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
    acceptTerms: false,
    acceptPrivacy: false,
  })
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileError, setTurnstileError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [submitted, setSubmitted] = useState(false)

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function onSubmit(event) {
    event.preventDefault()
    if (submitting) return
    if (form.password !== form.confirmPassword) {
      setErrorMessage('Passwords do not match. Enter the same password in both fields.')
      return
    }
    if (turnstileSiteKey && !turnstileToken) {
      setErrorMessage('Complete the security check before creating your account.')
      return
    }

    setErrorMessage('')
    setSubmitting(true)
    try {
      await registerCommerceAccount({ ...form, turnstileToken })
      setSubmitted(true)
    } catch (error) {
      setErrorMessage(String(error?.message || 'Account creation failed. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <AccountLayout
        eyebrow="Customer Account"
        title="Check your email"
        intro="We have accepted your request. Follow the verification link to activate the account."
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <MailCheck aria-hidden="true" size={24} />
        </div>
        <h2 className="mt-5 text-2xl font-extrabold text-[#123A7A]">Verification requested</h2>
        <p className="mt-3 leading-6 text-slate-600">
          For privacy, this message is the same whether the address is new or already belongs to an account.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link className="rounded-md bg-[#123A7A] px-4 py-2.5 font-semibold text-white" to="/account/login">
            Go to sign in
          </Link>
          <Link className="rounded-md border border-slate-300 px-4 py-2.5 font-semibold text-[#123A7A]" to="/account/resend-verification">
            Resend verification
          </Link>
        </div>
      </AccountLayout>
    )
  }

  return (
    <AccountLayout
      eyebrow="Customer Account"
      title="Create your account"
      intro="Use one secure account for online orders and, where authorized, the equipment portal."
      aside={<>Already registered? <Link className="font-bold text-[#123A7A]" to="/account/login">Sign in</Link> with your email or portal username.</>}
    >
      <h2 className="text-2xl font-extrabold text-[#123A7A]">Your details</h2>
      {errorMessage && <div role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div>}

      <form className="mt-6 space-y-4" onSubmit={onSubmit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block" htmlFor="registration-first-name">
            <span className="mb-1 block text-sm font-semibold text-slate-700">First name</span>
            <input id="registration-first-name" className="w-full rounded-md border border-slate-300 px-3 py-2.5 outline-none focus:border-[#123A7A]" autoComplete="given-name" value={form.firstName} onChange={(event) => updateField('firstName', event.target.value)} />
          </label>
          <label className="block" htmlFor="registration-last-name">
            <span className="mb-1 block text-sm font-semibold text-slate-700">Last name</span>
            <input id="registration-last-name" className="w-full rounded-md border border-slate-300 px-3 py-2.5 outline-none focus:border-[#123A7A]" autoComplete="family-name" value={form.lastName} onChange={(event) => updateField('lastName', event.target.value)} />
          </label>
        </div>

        <label className="block" htmlFor="registration-email">
          <span className="mb-1 block text-sm font-semibold text-slate-700">Email</span>
          <input id="registration-email" className="w-full rounded-md border border-slate-300 px-3 py-2.5 outline-none focus:border-[#123A7A]" type="email" autoComplete="email" value={form.email} onChange={(event) => updateField('email', event.target.value)} required />
        </label>

        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-700" htmlFor="registration-password">Password</label>
          <div className="relative">
            <input id="registration-password" className="w-full rounded-md border border-slate-300 px-3 py-2.5 pr-12 outline-none focus:border-[#123A7A]" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={12} maxLength={128} value={form.password} onChange={(event) => updateField('password', event.target.value)} required />
            <button className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? 'Hide password' : 'Show password'} title={showPassword ? 'Hide password' : 'Show password'}>
              {showPassword ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
            </button>
          </div>
          <span className="mt-1 block text-xs text-slate-500">At least 12 characters. Common or entirely numeric passwords are rejected.</span>
        </div>

        <label className="block" htmlFor="registration-confirm-password">
          <span className="mb-1 block text-sm font-semibold text-slate-700">Confirm password</span>
          <input id="registration-confirm-password" className="w-full rounded-md border border-slate-300 px-3 py-2.5 outline-none focus:border-[#123A7A]" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={form.confirmPassword} onChange={(event) => updateField('confirmPassword', event.target.value)} required />
        </label>

        <label className="flex items-start gap-3 text-sm leading-5 text-slate-600">
          <input className="mt-1 h-4 w-4 accent-[#123A7A]" type="checkbox" checked={form.acceptTerms} onChange={(event) => updateField('acceptTerms', event.target.checked)} required />
          <span>I accept the <Link className="font-semibold text-[#123A7A] underline" to="/terms-and-conditions">terms and conditions</Link>.</span>
        </label>
        <label className="flex items-start gap-3 text-sm leading-5 text-slate-600">
          <input className="mt-1 h-4 w-4 accent-[#123A7A]" type="checkbox" checked={form.acceptPrivacy} onChange={(event) => updateField('acceptPrivacy', event.target.checked)} required />
          <span>I have read the <Link className="font-semibold text-[#123A7A] underline" to="/privacy-policy">privacy policy</Link>.</span>
        </label>

        {turnstileSiteKey && (
          <div className="pt-1">
            <TurnstileWidget siteKey={turnstileSiteKey} onTokenChange={(token) => { setTurnstileToken(token); setTurnstileError('') }} onError={() => setTurnstileError('The security check could not load. Refresh and try again.')} />
            {turnstileError && <p className="mt-2 text-sm text-red-700">{turnstileError}</p>}
          </div>
        )}

        <button className="flex w-full items-center justify-center gap-2 rounded-md bg-[#123A7A] px-4 py-3 font-bold text-white transition hover:bg-[#0f3168] disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={submitting || Boolean(turnstileSiteKey && !turnstileToken)}>
          <UserPlus size={19} aria-hidden="true" />
          {submitting ? 'Creating account...' : 'Create account'}
        </button>
      </form>
    </AccountLayout>
  )
}
