import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getAccountBootstrap, registerCommerceAccount } from '../utils/portalApi'
import ShopPageLayout from '../components/ShopPageLayout'
import { useCart } from '../context/CartContext'
import {
  clearCompletedCheckout,
  clearGuestCheckoutOffer,
  clearPendingCheckout,
  formatCurrency,
  getOnsiteCheckoutStatus,
  getOnsiteOrderSummary,
  loadCompletedCheckout,
  loadGuestCheckoutOffer,
  loadPendingCheckout,
  saveCompletedCheckout,
  shopRoutes,
} from '../utils/shopConfig'
import usePageMeta from '../utils/usePageMeta'

export default function OrderConfirmedPage() {
  usePageMeta({
    title: 'Order Confirmed',
    description: 'Order confirmation details for your Manley Lifting purchase.',
    noIndex: true,
  })

  const { clearCart } = useCart()
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [order, setOrder] = useState(null)
  const [guestOffer, setGuestOffer] = useState(null)
  const [registeringGuest, setRegisteringGuest] = useState(false)
  const [registerGuestMessage, setRegisterGuestMessage] = useState('')
  const [guestPassword, setGuestPassword] = useState('')
  const [guestConfirmPassword, setGuestConfirmPassword] = useState('')
  const [confirmationAttempt, setConfirmationAttempt] = useState(0)
  const [orderNumberCopied, setOrderNumberCopied] = useState(false)
  const paymentStatus = order?.paymentStatus || 'pending'
  const paymentVerified = paymentStatus === 'paid' || paymentStatus === 'partially_refunded' || paymentStatus === 'refunded'
  const paymentFailed = paymentStatus === 'failed' || paymentStatus === 'canceled'

  useEffect(() => {
    let cancelled = false

    async function resolveGuestOffer() {
      try {
        await getAccountBootstrap()
        if (cancelled) return
        clearGuestCheckoutOffer()
        setGuestOffer(null)
      } catch {
        if (!cancelled) setGuestOffer(loadGuestCheckoutOffer())
      }
    }

    void resolveGuestOffer()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let retryTimeoutId = null

    function isFinalPaymentStatus(value) {
      return ['paid', 'partially_refunded', 'refunded', 'failed', 'canceled'].includes(String(value || '').toLowerCase())
    }

    function applySummary(nextSummary) {
      setOrder((currentSummary) => {
        const currentIsFinal = isFinalPaymentStatus(currentSummary?.paymentStatus)
        const nextIsFinal = isFinalPaymentStatus(nextSummary?.paymentStatus)
        return currentIsFinal && !nextIsFinal ? currentSummary : nextSummary
      })
    }

    async function loadOrder() {
      const completed = loadCompletedCheckout()
      const pending = completed ? null : loadPendingCheckout()
      const checkout = completed || pending
      if (!checkout?.checkoutRef || !checkout?.statusToken) {
        setErrorMessage('We could not find a recent completed order. Please contact support if you were charged.')
        setIsLoading(false)
        return
      }

      try {
        const summary = await getOnsiteOrderSummary(checkout.checkoutRef, checkout.statusToken)
        if (cancelled) return
        applySummary(summary)

        const paymentStatus = String(summary.paymentStatus || '').toLowerCase()
        const paymentIsFinal = ['paid', 'partially_refunded', 'refunded', 'failed', 'canceled'].includes(paymentStatus)
        if (!paymentIsFinal) {
          const pollForConfirmation = async () => {
            try {
              const result = await getOnsiteCheckoutStatus(checkout.checkoutRef, checkout.statusToken)
              if (cancelled) return

              const refreshedSummary = await getOnsiteOrderSummary(checkout.checkoutRef, checkout.statusToken)
              if (cancelled) return
              applySummary(refreshedSummary)

              const resolvedStatus = String(result.status || refreshedSummary.paymentStatus || '').toLowerCase()
              if (resolvedStatus === 'paid') {
                saveCompletedCheckout(checkout.checkoutRef, checkout.statusToken)
                clearPendingCheckout()
                clearCart()
                return
              }

              if (resolvedStatus === 'failed' || resolvedStatus === 'canceled') return
            } catch {
              if (cancelled) return
            }

            if (!cancelled) {
              retryTimeoutId = window.setTimeout(() => {
                void pollForConfirmation()
              }, 3000)
            }
          }

          void pollForConfirmation()
        }
      } catch (error) {
        if (cancelled) return
        setErrorMessage(error?.message || 'We could not load your order confirmation right now.')
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    loadOrder()

    return () => {
      cancelled = true
      if (retryTimeoutId) window.clearTimeout(retryTimeoutId)
    }
  }, [clearCart, confirmationAttempt])

  async function handleRegisterGuestAccount() {
    if (!guestOffer?.email) return

    if (guestPassword.length < 12) {
      setRegisterGuestMessage('Choose a password with at least 12 characters.')
      return
    }

    if (guestPassword !== guestConfirmPassword) {
      setRegisterGuestMessage('Passwords do not match. Enter the same password twice.')
      return
    }

    setRegisteringGuest(true)
    setRegisterGuestMessage('')

    try {
      await registerCommerceAccount({
        email: guestOffer.email,
        password: guestPassword,
        firstName: guestOffer.fullName?.split(' ')[0] || '',
        lastName: guestOffer.fullName?.split(' ').slice(1).join(' ') || '',
        acceptTerms: true,
        acceptPrivacy: true,
      })
      setRegisterGuestMessage('Thanks! We have sent a verification email to your address so you can activate your account.')
      setGuestPassword('')
      setGuestConfirmPassword('')
      clearGuestCheckoutOffer()
      setGuestOffer(null)
    } catch (error) {
      setRegisterGuestMessage(String(error?.message || 'We could not create the account right now.'))
    } finally {
      setRegisteringGuest(false)
    }
  }

  async function handleCopyOrderNumber() {
    const orderNumber = String(order?.orderNumber || '').trim()
    if (!orderNumber) return

    try {
      await navigator.clipboard.writeText(orderNumber)
    } catch {
      // The visible copied state still confirms the action when clipboard access is unavailable.
    }
    setOrderNumberCopied(true)
    window.setTimeout(() => setOrderNumberCopied(false), 2200)
  }

  return (
    <ShopPageLayout>
      <main className="mx-auto w-full max-w-5xl px-6 py-16">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className={`text-sm font-bold uppercase tracking-[0.16em] ${paymentFailed ? 'text-red-700' : 'text-[#C61F2A]'}`}>
                {paymentVerified ? 'Order Confirmed' : paymentFailed ? 'Payment Not Completed' : 'Payment Processing'}
              </p>
              <h1 className="mt-2 text-4xl font-extrabold text-[#123A7A] md:text-5xl">{paymentFailed ? 'Payment issue' : 'Thank You'}</h1>
            </div>
            <div className={`rounded-full border px-4 py-2 text-sm font-semibold ${paymentVerified ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : paymentFailed ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
              {paymentVerified ? 'Payment received • Order tracked' : paymentFailed ? 'Payment could not be completed' : 'Payment is processing • Order tracked'}
            </div>
          </div>

          {isLoading && (
            <p className="mt-5 text-slate-600" role="status" aria-live="polite">
              Loading your order details...
            </p>
          )}

          {!isLoading && errorMessage && (
            <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
              <p>{errorMessage}</p>
              <button
                type="button"
                onClick={() => {
                  setErrorMessage('')
                  setOrder(null)
                  setIsLoading(true)
                  setConfirmationAttempt((attempt) => attempt + 1)
                }}
                disabled={isLoading}
                className="mt-3 rounded-md border border-red-300 px-3 py-2 font-semibold text-red-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Retry confirmation
              </button>
            </div>
          )}

          {!isLoading && order && (
            <>
              <p className="mt-5 text-slate-700">
                {paymentVerified && (
                  <>
                    We have received your payment and emailed confirmation to{' '}
                    <span className="font-semibold text-slate-900">{order.customerEmail || 'your email address'}</span>.
                  </>
                )}
                {paymentFailed && 'Payment could not be completed. Please contact support if you believe you were charged, or return to the shop to try again.'}
                {!paymentVerified && !paymentFailed && 'Your payment is processing. We will confirm the order after the backend verifies it.'}
              </p>

              {order.orderNumber && (
                <div className="mt-5 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Order number</p>
                    <p className="mt-1 break-all font-mono text-sm font-bold text-slate-900">{order.orderNumber}</p>
                  </div>
                  <div className="flex items-end justify-between gap-3 sm:justify-end">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Order date</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">
                        {order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-IE') : 'Not available'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyOrderNumber}
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-[#123A7A] hover:text-[#123A7A]"
                      aria-label="Copy order number"
                    >
                      {orderNumberCopied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between border-b border-slate-200 pb-3 text-sm">
                  <span className="font-semibold text-slate-700">Order Status</span>
                  <span className={`font-bold uppercase tracking-wide ${paymentFailed ? 'text-red-700' : paymentVerified ? 'text-emerald-700' : 'text-amber-800'}`}>
                    {paymentFailed ? paymentStatus : paymentVerified ? order.status : paymentStatus}
                  </span>
                </div>

                {(order.shippingName || order.shippingAddressLine1 || order.shippingCity || order.shippingPostcode) && (
                  <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700">
                    <p className="font-semibold text-slate-900">Delivery details</p>
                    <p className="mt-2">{order.shippingName || order.customerName || 'Delivery address'}</p>
                    {order.shippingAddressLine1 && <p>{order.shippingAddressLine1}</p>}
                    {order.shippingAddressLine2 && <p>{order.shippingAddressLine2}</p>}
                    <p>
                      {[order.shippingCity, order.shippingCounty].filter(Boolean).join(', ')}
                      {order.shippingCity || order.shippingCounty ? ' ' : ''}
                      {order.shippingPostcode || ''}
                    </p>
                    {order.shippingCountryCode && <p>{order.shippingCountryCode}</p>}
                    {order.shippingPhone && <p className="mt-2 text-slate-600">Phone: {order.shippingPhone}</p>}
                  </div>
                )}

                <div className="mt-3 space-y-3">
                  {order.lineItems.map((item, index) => (
                    <div key={item.variantId || index} className="flex items-start justify-between gap-4 text-sm">
                      <div>
                        <p className="font-semibold text-slate-900">{item.title || 'Item'}</p>
                        <p className="text-xs text-slate-500">
                          {item.variantTitle || 'Default'} | Qty {Number(item.quantity || 0)}
                        </p>
                      </div>
                      <span className="font-semibold text-[#C61F2A]">
                        {formatCurrency(Number(item.lineTotalCents || 0) / 100, item.currency || order.currency)}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-4">
                  <span className="text-base font-bold text-[#123A7A]">{paymentVerified ? 'Total Paid' : 'Order Total'}</span>
                  <span className="text-xl font-extrabold text-[#C61F2A]">
                    {formatCurrency(order.amountTotalCents / 100, order.currency)}
                  </span>
                </div>
              </div>

              {guestOffer && (
                <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm font-semibold text-slate-900">Create your account for faster future orders</p>
                  <p className="mt-2 text-sm text-slate-600">
                    We can set up an account for <span className="font-semibold text-slate-900">{guestOffer.email}</span> so you can review orders and save addresses next time.
                  </p>
                  {registerGuestMessage && (
                    <p className="mt-3 text-sm text-emerald-700">{registerGuestMessage}</p>
                  )}
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <label className="text-sm font-medium text-slate-700">
                      <span className="mb-1 block">Password</span>
                      <input
                        type="password"
                        value={guestPassword}
                        onChange={(event) => setGuestPassword(event.target.value)}
                        className="w-full rounded-md border border-slate-300 px-3 py-2"
                        placeholder="At least 12 characters"
                      />
                    </label>
                    <label className="text-sm font-medium text-slate-700">
                      <span className="mb-1 block">Confirm password</span>
                      <input
                        type="password"
                        value={guestConfirmPassword}
                        onChange={(event) => setGuestConfirmPassword(event.target.value)}
                        className="w-full rounded-md border border-slate-300 px-3 py-2"
                        placeholder="Repeat password"
                      />
                    </label>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={handleRegisterGuestAccount}
                      disabled={registeringGuest}
                      className="rounded-md bg-[#123A7A] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {registeringGuest ? 'Creating account…' : 'Create account'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        clearGuestCheckoutOffer()
                        setGuestOffer(null)
                      }}
                      className="rounded-md border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700"
                    >
                      Skip for now
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  to={shopRoutes.home}
                  onClick={() => clearCompletedCheckout()}
                  className="rounded-md bg-[#123A7A] px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-[#0f3168]"
                >
                  Continue Shopping
                </Link>
                <Link
                  to={shopRoutes.contact || '/contact'}
                  className="rounded-md border-2 border-[#123A7A] px-6 py-3 text-sm font-bold uppercase tracking-wide text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
                >
                  Contact Support
                </Link>
              </div>
            </>
          )}
        </div>
      </main>
    </ShopPageLayout>
  )
}
