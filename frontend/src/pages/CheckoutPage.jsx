import { useEffect, useMemo, useRef, useState } from 'react'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import { Link, useNavigate } from 'react-router-dom'
import ShopPageLayout from '../components/ShopPageLayout'
import { useCart } from '../context/CartContext'
import {
  clearPendingCheckout,
  createOnsitePaymentIntent,
  formatCurrency,
  generateCheckoutRef,
  getOnsiteCheckoutStatus,
  saveCompletedCheckout,
  loadPendingCheckout,
  savePendingCheckout,
  shopRoutes,
} from '../utils/shopConfig'

const turnstileSiteKey = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || '').trim()
const stripePublishableKey = String(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '').trim()
const stripePromise = stripePublishableKey ? loadStripe(stripePublishableKey) : null

function OnsitePaymentForm({
  amountTotalCents,
  currency,
  email,
  isPaymentElementReady,
  isSubmitting,
  setIsSubmitting,
  setErrorMessage,
  onPaymentElementReady,
  onPaymentSubmitted,
}) {
  const stripe = useStripe()
  const elements = useElements()

  async function handleSubmit(event) {
    event.preventDefault()
    if (!stripe || !elements) return

    setErrorMessage('')
    setIsSubmitting(true)

    const result = await stripe.confirmPayment({
      elements,
      confirmParams: {
        receipt_email: email,
      },
      redirect: 'if_required',
    })

    if (result.error) {
      setErrorMessage(result.error.message || 'We could not complete payment right now. Please try again.')
      setIsSubmitting(false)
      return
    }

    onPaymentSubmitted(result.paymentIntent)
  }

  return (
    <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
      <PaymentElement onReady={onPaymentElementReady} />
      <button
        type="submit"
        disabled={!stripe || !elements || !isPaymentElementReady || isSubmitting}
        className="block w-full rounded-md bg-[#123A7A] px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-[#0f3168] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? 'Processing...' : `Pay ${formatCurrency(amountTotalCents / 100, currency)}`}
      </button>
    </form>
  )
}

function loadTurnstileScript() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Browser environment not available'))
  }

  if (window.turnstile) {
    return Promise.resolve(window.turnstile)
  }

  if (window.__manleyTurnstileLoader) {
    return window.__manleyTurnstileLoader
  }

  window.__manleyTurnstileLoader = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-turnstile-script="true"]')
    if (existing) {
      existing.addEventListener('load', () => resolve(window.turnstile))
      existing.addEventListener('error', () => reject(new Error('Could not load Turnstile script')))
      return
    }

    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.dataset.turnstileScript = 'true'
    script.onload = () => resolve(window.turnstile)
    script.onerror = () => reject(new Error('Could not load Turnstile script'))
    document.head.appendChild(script)
  })

  return window.__manleyTurnstileLoader
}

function getFriendlyCheckoutErrorMessage(error) {
  const rawMessage = String(error?.message || '').trim().toLowerCase()

  if (rawMessage.includes('security check')) {
    return 'We could not verify the security check. Please try again and place your order.'
  }

  if (rawMessage.includes('request source') || rawMessage.includes('security reasons')) {
    return 'We could not verify your request source. Please refresh the page and try again.'
  }

  return error?.message || 'We could not start checkout right now. Please try again in a moment.'
}

export default function CheckoutPage() {
  const navigate = useNavigate()
  const { cartItems, cartCount, subtotal, clearCart } = useCart()
  const [errorMessage, setErrorMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [checkoutRef, setCheckoutRef] = useState('')
  const [statusToken, setStatusToken] = useState('')
  const [amountTotalCents, setAmountTotalCents] = useState(0)
  const [checkoutCurrency, setCheckoutCurrency] = useState('EUR')
  const [isPaymentElementReady, setIsPaymentElementReady] = useState(false)
  const [paymentElementLoadIssue, setPaymentElementLoadIssue] = useState('')
  const [isAwaitingPaymentConfirmation, setIsAwaitingPaymentConfirmation] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileLoaded, setTurnstileLoaded] = useState(!turnstileSiteKey)
  const [turnstileLoadError, setTurnstileLoadError] = useState('')
  const turnstileContainerRef = useRef(null)
  const turnstileWidgetIdRef = useRef(null)

  const checkoutItems = useMemo(
    () =>
      cartItems.map((item) => ({
        variantId: item.variantId,
        quantity: item.quantity,
      })),
    [cartItems],
  )

  useEffect(() => {
    const pending = loadPendingCheckout()
    if (!pending?.checkoutRef || !pending?.statusToken) return

    let cancelled = false
    let intervalId = null
    let attempts = 0
    const maxAttempts = 24

    async function checkStatus() {
      attempts += 1

      try {
        const result = await getOnsiteCheckoutStatus(pending.checkoutRef, pending.statusToken)
        if (cancelled) return

        if (result.status === 'paid') {
          saveCompletedCheckout(pending.checkoutRef, pending.statusToken)
          clearCart()
          clearPendingCheckout()
          setStatusMessage('Order confirmed. Your cart has been cleared.')
          navigate(shopRoutes.orderConfirmed)
          if (intervalId) window.clearInterval(intervalId)
          return
        }

        if (result.status === 'failed' || result.status === 'canceled') {
          clearPendingCheckout()
          setStatusMessage('Your payment was not completed. Please try again.')
          if (intervalId) window.clearInterval(intervalId)
          return
        }

        if (attempts >= maxAttempts) {
          if (intervalId) window.clearInterval(intervalId)
        }
      } catch {
        if (attempts >= maxAttempts && intervalId) {
          window.clearInterval(intervalId)
        }
      }
    }

    checkStatus()
    intervalId = window.setInterval(checkStatus, 5000)

    return () => {
      cancelled = true
      if (intervalId) window.clearInterval(intervalId)
    }
  }, [clearCart, navigate])

  useEffect(() => {
    if (!isAwaitingPaymentConfirmation || !checkoutRef || !statusToken) return

    let cancelled = false
    let intervalId = null
    let attempts = 0
    const maxAttempts = 40

    async function pollStatus() {
      attempts += 1
      try {
        const result = await getOnsiteCheckoutStatus(checkoutRef, statusToken)
        if (cancelled) return

        if (result.status === 'paid') {
          saveCompletedCheckout(checkoutRef, statusToken)
          clearCart()
          clearPendingCheckout()
          setStatusMessage('Payment confirmed. Thank you for your order.')
          setIsAwaitingPaymentConfirmation(false)
          setIsSubmitting(false)
          navigate(shopRoutes.orderConfirmed)
          if (intervalId) window.clearInterval(intervalId)
          return
        }

        if (result.status === 'failed' || result.status === 'canceled') {
          setErrorMessage('Your payment could not be confirmed. Please try again.')
          setIsAwaitingPaymentConfirmation(false)
          setIsSubmitting(false)
          if (intervalId) window.clearInterval(intervalId)
          return
        }

        if (attempts >= maxAttempts && intervalId) {
          window.clearInterval(intervalId)
          setIsSubmitting(false)
          setIsAwaitingPaymentConfirmation(false)
          setStatusMessage('Payment is still processing. We will update this page once confirmed.')
        }
      } catch {
        if (attempts >= maxAttempts && intervalId) {
          window.clearInterval(intervalId)
          setIsSubmitting(false)
          setIsAwaitingPaymentConfirmation(false)
        }
      }
    }

    pollStatus()
    intervalId = window.setInterval(pollStatus, 3000)

    return () => {
      cancelled = true
      if (intervalId) window.clearInterval(intervalId)
    }
  }, [checkoutRef, statusToken, isAwaitingPaymentConfirmation, clearCart, navigate])

  useEffect(() => {
    if (!clientSecret || isPaymentElementReady) return

    const timeoutId = window.setTimeout(() => {
      setPaymentElementLoadIssue(
        'Payment options are taking longer than expected to load. Confirm VITE_STRIPE_PUBLISHABLE_KEY is set, restart the frontend dev server, and check browser blockers/network.',
      )
    }, 12000)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [clientSecret, isPaymentElementReady])

  useEffect(() => {
    if (!turnstileSiteKey) return

    let cancelled = false

    loadTurnstileScript()
      .then((turnstile) => {
        if (cancelled || !turnstile || !turnstileContainerRef.current || turnstileWidgetIdRef.current !== null) {
          return
        }

        turnstileWidgetIdRef.current = turnstile.render(turnstileContainerRef.current, {
          sitekey: turnstileSiteKey,
          theme: 'light',
          callback: (token) => {
            setTurnstileToken(String(token || ''))
            setTurnstileLoadError('')
          },
          'expired-callback': () => {
            setTurnstileToken('')
          },
          'error-callback': () => {
            setTurnstileToken('')
            setTurnstileLoadError('Bot check failed to load. Please refresh and try again.')
          },
        })

        setTurnstileLoaded(true)
      })
      .catch(() => {
        if (cancelled) return
        console.error('Failed to load Turnstile script')
        setTurnstileLoadError('Bot check failed to load. Please refresh and try again.')
      })

    return () => {
      cancelled = true
    }
  }, [])

  async function handlePreparePayment() {
    if (checkoutItems.length === 0) return

    setIsSubmitting(true)
    setErrorMessage('')

    if (!customerName.trim()) {
      setErrorMessage('Please provide your full name before continuing.')
      setIsSubmitting(false)
      return
    }

    if (!customerEmail.trim()) {
      setErrorMessage('Please provide your email before continuing.')
      setIsSubmitting(false)
      return
    }

    if (turnstileSiteKey && !turnstileToken) {
      setErrorMessage('Please complete the bot check before placing your order.')
      setIsSubmitting(false)
      return
    }

    if (!stripePromise) {
      setErrorMessage('Stripe is not configured. Please try again later.')
      setIsSubmitting(false)
      return
    }

    try {
      const nextCheckoutRef = generateCheckoutRef()
      const checkout = await createOnsitePaymentIntent(
        checkoutItems,
        nextCheckoutRef,
        {
          name: customerName,
          email: customerEmail,
        },
        {
        antiBotToken: turnstileToken,
        },
      )
      const nextStatusToken = checkout.statusToken
      const nextClientSecret = checkout.clientSecret

      if (!nextClientSecret) throw new Error('No payment client secret returned from server')
      if (!nextStatusToken) throw new Error('No status token returned from server')

      setCheckoutRef(checkout.checkoutRef || nextCheckoutRef)
      setStatusToken(nextStatusToken)
      setClientSecret(nextClientSecret)
      setAmountTotalCents(checkout.amountTotalCents)
      setCheckoutCurrency(checkout.currency || 'EUR')
      setIsPaymentElementReady(false)
      setPaymentElementLoadIssue('')

      savePendingCheckout(checkout.checkoutRef || nextCheckoutRef, nextStatusToken)
      setStatusMessage('Secure payment details loaded. Complete card payment below.')
      setIsSubmitting(false)
    } catch (error) {
      console.error('Failed to create onsite payment intent', {
        cartItemCount: checkoutItems.length,
        error,
      })
      setErrorMessage(getFriendlyCheckoutErrorMessage(error))
      if (turnstileSiteKey && window.turnstile && turnstileWidgetIdRef.current !== null) {
        window.turnstile.reset(turnstileWidgetIdRef.current)
      }
      setTurnstileToken('')
      setIsSubmitting(false)
    }
  }

  function handlePaymentSubmitted(paymentIntent) {
    const status = String(paymentIntent?.status || '').toLowerCase()
    if (status === 'succeeded') {
      if (checkoutRef && statusToken) {
        saveCompletedCheckout(checkoutRef, statusToken)
      }
      clearCart()
      clearPendingCheckout()
      setStatusMessage('Payment confirmed. Thank you for your order.')
      setIsSubmitting(false)
      navigate(shopRoutes.orderConfirmed)
      return
    }

    setStatusMessage('Payment submitted. Waiting for secure confirmation...')
    setIsAwaitingPaymentConfirmation(true)
  }

  return (
    <ShopPageLayout>
      <main className="mx-auto w-full max-w-7xl px-6 py-16">
        <div className="mb-10">
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#C61F2A]">Checkout</p>
          <h1 className="mt-2 text-4xl font-extrabold text-[#123A7A] md:text-5xl">Checkout</h1>
          <p className="mt-4 max-w-3xl text-slate-600">
            Complete your payment securely on this page without leaving the site.
          </p>
        </div>

        {statusMessage && (
          <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
            {statusMessage}
          </div>
        )}

        {errorMessage && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {errorMessage}
          </div>
        )}

        <div className="grid gap-10 lg:grid-cols-[1.25fr_0.75fr]">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-[#123A7A]">Customer Details</h2>

            <form className="mt-6 space-y-5">
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Full Name</label>
                <input
                  type="text"
                    value={customerName}
                    onChange={(event) => setCustomerName(event.target.value)}
                  placeholder="John Smith"
                  className="w-full rounded-md border border-slate-300 px-4 py-3 text-slate-900 outline-none transition focus:border-[#123A7A] focus:ring-2 focus:ring-[#123A7A]/20"
                />
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">Email</label>
                  <input
                    type="email"
                    value={customerEmail}
                    onChange={(event) => setCustomerEmail(event.target.value)}
                    placeholder="john@example.com"
                    className="w-full rounded-md border border-slate-300 px-4 py-3 text-slate-900 outline-none transition focus:border-[#123A7A] focus:ring-2 focus:ring-[#123A7A]/20"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">Phone</label>
                  <input
                    type="tel"
                    placeholder="+353..."
                    className="w-full rounded-md border border-slate-300 px-4 py-3 text-slate-900 outline-none transition focus:border-[#123A7A] focus:ring-2 focus:ring-[#123A7A]/20"
                  />
                </div>
              </div>
            </form>
          </section>

          <aside className="rounded-2xl border border-slate-200 bg-[#f8fafc] p-6 shadow-sm">
            <h2 className="text-xl font-bold text-[#123A7A]">Order Summary</h2>

            <div className="mt-6 space-y-4 text-sm text-slate-700">
              <div className="flex items-center justify-between">
                <span>Items</span>
                <span className="font-semibold text-slate-900">{cartCount}</span>
              </div>

              {cartItems.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">
                  Your cart is empty.
                </div>
              ) : (
                <div className="space-y-3">
                  {cartItems.map((item) => (
                    <div key={item.handle} className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-semibold text-slate-900">{item.title}</p>
                        <p className="text-xs text-slate-500">Qty {item.quantity}</p>
                      </div>
                      <p className="font-semibold text-[#C61F2A]">
                        {formatCurrency(item.price * item.quantity, item.currency)}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between border-t border-slate-200 pt-3">
                <span>Subtotal</span>
                <span className="font-semibold text-slate-900">{formatCurrency(subtotal)}</span>
              </div>
            </div>

            <div className="mt-6 border-t border-slate-200 pt-6">
              <div className="flex items-center justify-between">
                <span className="text-base font-bold text-[#123A7A]">Total</span>
                <span className="text-xl font-extrabold text-[#C61F2A]">{formatCurrency(subtotal, checkoutCurrency)}</span>
              </div>

              <div className="mt-8 space-y-3">
                {turnstileSiteKey && (
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Security Check
                    </p>
                    <div ref={turnstileContainerRef} />
                    {!turnstileLoaded && !turnstileLoadError && (
                      <p className="mt-2 text-xs text-slate-500">Loading bot check...</p>
                    )}
                    {turnstileLoadError && <p className="mt-2 text-xs text-red-700">{turnstileLoadError}</p>}
                  </div>
                )}

                <button
                  type="button"
                  onClick={handlePreparePayment}
                  disabled={
                    cartItems.length === 0 ||
                    isSubmitting ||
                    Boolean(turnstileSiteKey && (!turnstileToken || turnstileLoadError)) ||
                    Boolean(clientSecret)
                  }
                  className="block w-full rounded-md bg-[#123A7A] px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-[#0f3168] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? 'Preparing Payment...' : 'Prepare Secure Payment'}
                </button>

                {clientSecret && stripePromise && (
                  <Elements stripe={stripePromise} options={{ clientSecret }}>
                    {!isPaymentElementReady && (
                      <p className="text-xs text-slate-500">Loading secure payment options...</p>
                    )}
                    {paymentElementLoadIssue && (
                      <p className="text-xs text-red-700">{paymentElementLoadIssue}</p>
                    )}
                    <OnsitePaymentForm
                      amountTotalCents={amountTotalCents}
                      currency={checkoutCurrency}
                      email={customerEmail}
                      isPaymentElementReady={isPaymentElementReady}
                      isSubmitting={isSubmitting}
                      setIsSubmitting={setIsSubmitting}
                      setErrorMessage={setErrorMessage}
                      onPaymentElementReady={() => {
                        setIsPaymentElementReady(true)
                        setPaymentElementLoadIssue('')
                      }}
                      onPaymentSubmitted={handlePaymentSubmitted}
                    />
                  </Elements>
                )}

                <Link
                  to={shopRoutes.cart}
                  className="block rounded-md border-2 border-[#123A7A] px-6 py-3 text-center text-sm font-bold uppercase tracking-wide text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
                >
                  Back to Cart
                </Link>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </ShopPageLayout>
  )
}
