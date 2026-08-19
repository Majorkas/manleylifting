import { useEffect, useState } from 'react'
import { Building2, LogOut, MapPin, Package2, ShieldCheck, ShoppingBag } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import AccountLayout from '../components/AccountLayout'
import { claimGuestOrder, getAccountBootstrap, getAccountSecurityEvents, getAccountSessions, portalLogout } from '../utils/portalApi'
import { clearPendingOrderClaim, loadPendingOrderClaim } from '../utils/shopConfig'
import usePageMeta from '../utils/usePageMeta'

export default function AccountOverviewPage() {
  usePageMeta({ title: 'My Account', description: 'Manage your Manley Lifting account.', noIndex: true })
  const navigate = useNavigate()
  const [account, setAccount] = useState(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [securityEvents, setSecurityEvents] = useState([])
  const [sessions, setSessions] = useState([])
  const canShop = Boolean(account?.capabilities?.canShop)
  const canViewOrders = Boolean(account?.capabilities?.canViewOrders)
  const canAccessPortal = Boolean(account?.capabilities?.canAccessPortal)
  const canFulfillOrders = Boolean(account?.capabilities?.canFulfillOrders)
  const canManageShop = Boolean(account?.capabilities?.canManageShop)

  useEffect(() => {
    let cancelled = false

    async function loadAccountData() {
      try {
        const bootstrap = await getAccountBootstrap()
        if (cancelled) return

        setAccount(bootstrap)

        const pendingClaim = loadPendingOrderClaim()
        if (bootstrap?.emailVerified && pendingClaim?.orderNumber && pendingClaim?.claimToken) {
          try {
            await claimGuestOrder(pendingClaim.orderNumber, pendingClaim.claimToken)
            clearPendingOrderClaim()
          } catch {
            // Keep the claim available for a later retry if the account is not yet fully verified.
          }
        }
      } catch (error) {
        if (cancelled) return
        if (error?.status === 401) {
          navigate('/account/login?redirect=/account', { replace: true })
          return
        }
        setErrorMessage(String(error?.message || 'Account details could not be loaded.'))
      }
    }

    loadAccountData()
    return () => {
      cancelled = true
    }
  }, [navigate])

  useEffect(() => {
    let cancelled = false

    async function loadSecuritySummary() {
      if (!account) return

      try {
        const [nextSecurityEvents, nextSessions] = await Promise.all([getAccountSecurityEvents(), getAccountSessions()])
        if (cancelled) return
        setSecurityEvents(Array.isArray(nextSecurityEvents) ? nextSecurityEvents : [])
        setSessions(Array.isArray(nextSessions) ? nextSessions : [])
      } catch (error) {
        if (cancelled) return
        if (error?.status === 401) {
          navigate('/account/login?redirect=/account', { replace: true })
        }
      }
    }

    loadSecuritySummary()
    return () => {
      cancelled = true
    }
  }, [account, navigate])

  async function signOut() {
    await portalLogout()
    navigate('/account/login', { replace: true })
  }

  const latestSecurityEvent = securityEvents[0]
  const latestSecurityEventLabel = latestSecurityEvent?.action
    ? String(latestSecurityEvent.action).replace('account.', '').replace(/_/g, ' ')
    : ''
  const activeSessionCount = sessions.filter((session) => session.isActive && !session.isRevoked).length

  return (
    <AccountLayout
      eyebrow="My Account"
      title={account?.fullName || 'Account profile'}
      intro={account ? (canAccessPortal ? 'Choose the portal or ecommerce account area that fits this profile.' : 'Manage your ecommerce account profile, orders, addresses, and security.') : 'Loading your account securely...'}
    >
      {errorMessage && <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div>}
      {!account && !errorMessage && <p className="text-slate-600">Loading...</p>}
      {account && (
        <>
          {canAccessPortal ? (
            <div className="mt-6 space-y-6">
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[#C61F2A]">Account options</p>
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <Link className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-4 py-4 text-[#123A7A] shadow-sm transition hover:border-[#123A7A] hover:shadow-md" to="/portal">
                    <span className="flex items-center gap-3 font-bold"><Building2 size={20} aria-hidden="true" />Open portal</span>
                    <span aria-hidden="true">&rarr;</span>
                  </Link>
                  {canViewOrders && (
                    <Link className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-4 text-[#123A7A] shadow-sm transition hover:border-[#123A7A] hover:shadow-md" to="/account/orders">
                      <span className="flex items-center gap-3 font-bold"><Package2 size={20} aria-hidden="true" />Store orders</span>
                      <span aria-hidden="true">&rarr;</span>
                    </Link>
                  )}
                  <Link className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-4 text-[#123A7A] shadow-sm transition hover:border-[#123A7A] hover:shadow-md" to="/account/security">
                    <span className="flex items-center gap-3 font-bold"><ShieldCheck size={20} aria-hidden="true" />Security</span>
                    <span aria-hidden="true">&rarr;</span>
                  </Link>
                  {canFulfillOrders && (
                    <Link className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-4 text-[#123A7A] shadow-sm transition hover:border-[#123A7A] hover:shadow-md" to="/shop/fulfillment">
                      <span className="flex items-center gap-3 font-bold"><Package2 size={20} aria-hidden="true" />Fulfillment operations</span>
                      <span aria-hidden="true">&rarr;</span>
                    </Link>
                  )}
                  {canManageShop && (
                    <Link className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-4 text-[#123A7A] shadow-sm transition hover:border-[#123A7A] hover:shadow-md" to="/shop/shop-management">
                      <span className="flex items-center gap-3 font-bold"><ShoppingBag size={20} aria-hidden="true" />Shop management</span>
                      <span aria-hidden="true">&rarr;</span>
                    </Link>
                  )}
                  {canShop && (
                    <Link className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-4 text-[#123A7A] shadow-sm transition hover:border-[#123A7A] hover:shadow-md" to="/shop">
                      <span className="flex items-center gap-3 font-bold"><ShoppingBag size={20} aria-hidden="true" />Shop</span>
                      <span aria-hidden="true">&rarr;</span>
                    </Link>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[#C61F2A]">Security shortcuts</p>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <Link className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-4 text-[#123A7A] shadow-sm transition hover:border-[#123A7A] hover:shadow-md" to="/account/security">
                    <span className="flex items-center gap-3 font-bold"><ShieldCheck size={20} aria-hidden="true" />Security center</span>
                    <span aria-hidden="true">&rarr;</span>
                  </Link>
                  <Link className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-4 text-[#123A7A] shadow-sm transition hover:border-[#123A7A] hover:shadow-md" to="/account/change-email">
                    <span className="flex items-center gap-3 font-bold"><MapPin size={20} aria-hidden="true" />Change email</span>
                    <span aria-hidden="true">&rarr;</span>
                  </Link>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[#C61F2A]">Security summary</p>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-sm font-semibold text-slate-900">Recent security activity</p>
                    <p className="mt-1 text-sm text-slate-600">{latestSecurityEventLabel || 'No recent security events.'}</p>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-sm font-semibold text-slate-900">Active sessions</p>
                    <p className="mt-1 text-sm text-slate-600">
                      {activeSessionCount > 0
                        ? `${activeSessionCount} active session${activeSessionCount === 1 ? '' : 's'} detected.`
                        : 'No active sessions were returned yet.'}
                    </p>
                  </div>
                </div>
                <div className="mt-4">
                  <Link className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-4 py-2.5 font-semibold text-[#123A7A] hover:bg-slate-50" to="/account/security">
                    <ShieldCheck size={18} aria-hidden="true" /> Open security center
                  </Link>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <Link className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-4 text-[#123A7A] shadow-sm transition hover:border-[#123A7A] hover:shadow-md" to="/account/orders">
                  <span className="flex items-center gap-3 font-bold"><Package2 size={20} aria-hidden="true" />Orders</span>
                  <span aria-hidden="true">&rarr;</span>
                </Link>
                <Link className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-4 text-[#123A7A] shadow-sm transition hover:border-[#123A7A] hover:shadow-md" to="/account/addresses">
                  <span className="flex items-center gap-3 font-bold"><MapPin size={20} aria-hidden="true" />Addresses</span>
                  <span aria-hidden="true">&rarr;</span>
                </Link>
                <Link className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-4 text-[#123A7A] shadow-sm transition hover:border-[#123A7A] hover:shadow-md" to="/account/security">
                  <span className="flex items-center gap-3 font-bold"><ShieldCheck size={20} aria-hidden="true" />Security</span>
                  <span aria-hidden="true">&rarr;</span>
                </Link>
                {canShop && (
                  <Link className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-4 text-[#123A7A] shadow-sm transition hover:border-[#123A7A] hover:shadow-md" to="/shop">
                    <span className="flex items-center gap-3 font-bold"><ShoppingBag size={20} aria-hidden="true" />Shop</span>
                    <span aria-hidden="true">&rarr;</span>
                  </Link>
                )}
              </div>

              <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[#C61F2A]">Security summary</p>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-sm font-semibold text-slate-900">Recent security activity</p>
                    <p className="mt-1 text-sm text-slate-600">{latestSecurityEventLabel || 'No recent security events.'}</p>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-sm font-semibold text-slate-900">Active sessions</p>
                    <p className="mt-1 text-sm text-slate-600">
                      {activeSessionCount > 0
                        ? `${activeSessionCount} active session${activeSessionCount === 1 ? '' : 's'} detected.`
                        : 'No active sessions were returned yet.'}
                    </p>
                  </div>
                </div>
                <div className="mt-4">
                  <Link className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-4 py-2.5 font-semibold text-[#123A7A] hover:bg-slate-50" to="/account/security">
                    <ShieldCheck size={18} aria-hidden="true" /> Open security center
                  </Link>
                </div>
              </div>
            </>
          )}

          <button className="mt-7 flex items-center gap-2 rounded-md border border-slate-300 px-4 py-2.5 font-semibold text-slate-700 hover:bg-slate-50" type="button" onClick={signOut}>
            <LogOut size={18} aria-hidden="true" /> Sign out
          </button>
        </>
      )}
    </AccountLayout>
  )
}