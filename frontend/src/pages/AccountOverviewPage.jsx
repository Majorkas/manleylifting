import { useEffect, useState } from 'react'
import { Building2, LogOut, ShieldCheck, ShoppingBag } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import AccountLayout from '../components/AccountLayout'
import { getAccountBootstrap, portalLogout } from '../utils/portalApi'
import usePageMeta from '../utils/usePageMeta'

export default function AccountOverviewPage() {
  usePageMeta({ title: 'My Account', description: 'Manage your Manley Lifting account.', noIndex: true })
  const navigate = useNavigate()
  const [account, setAccount] = useState(null)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    getAccountBootstrap()
      .then((result) => {
        if (!cancelled) setAccount(result)
      })
      .catch((error) => {
        if (cancelled) return
        if (error?.status === 401) {
          navigate('/account/login?redirect=/account', { replace: true })
          return
        }
        setErrorMessage(String(error?.message || 'Account details could not be loaded.'))
      })
    return () => {
      cancelled = true
    }
  }, [navigate])

  async function signOut() {
    await portalLogout()
    navigate('/account/login', { replace: true })
  }

  return (
    <AccountLayout
      eyebrow="My Account"
      title={account?.fullName || 'Account overview'}
      intro={account ? account.email : 'Loading your account securely...'}
    >
      {errorMessage && <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div>}
      {!account && !errorMessage && <p className="text-slate-600">Loading...</p>}
      {account && (
        <>
          <div className="flex items-center gap-3 border-b border-slate-200 pb-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><ShieldCheck size={22} aria-hidden="true" /></div>
            <div>
              <p className="font-bold text-slate-900">{account.emailVerified ? 'Email verified' : 'Email verification required'}</p>
              <p className="text-sm text-slate-500">Secure browser session active</p>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {account.capabilities.canShop && (
              <Link className="flex items-center justify-between rounded-md border border-slate-200 px-4 py-4 text-[#123A7A] transition hover:border-[#123A7A]" to="/shop">
                <span className="flex items-center gap-3 font-bold"><ShoppingBag size={20} aria-hidden="true" />Shop</span>
                <span aria-hidden="true">&rarr;</span>
              </Link>
            )}
            {account.capabilities.canAccessPortal && (
              <Link className="flex items-center justify-between rounded-md border border-slate-200 px-4 py-4 text-[#123A7A] transition hover:border-[#123A7A]" to="/portal">
                <span className="flex items-center gap-3 font-bold"><Building2 size={20} aria-hidden="true" />Equipment portal</span>
                <span aria-hidden="true">&rarr;</span>
              </Link>
            )}
          </div>

          <button className="mt-7 flex items-center gap-2 rounded-md border border-slate-300 px-4 py-2.5 font-semibold text-slate-700 hover:bg-slate-50" type="button" onClick={signOut}>
            <LogOut size={18} aria-hidden="true" /> Sign out
          </button>
        </>
      )}
    </AccountLayout>
  )
}
