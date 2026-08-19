import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import { Link, useNavigate } from 'react-router-dom'
import ShopPageLayout from '../components/ShopPageLayout'
import { useCart } from '../context/CartContext'
import { getAccessToken, getAccountBootstrap, registerCommerceAccount } from '../utils/portalApi'
import {
  clearPendingCheckout,
  createOnsitePaymentIntent,
  formatCurrency,
  generateCapabilityToken,
  generateCheckoutRef,
  getOnsiteCheckoutStatus,
  saveCompletedCheckout,
  saveGuestCheckoutOffer,
  loadPendingCheckout,
  savePendingCheckout,
  savePendingOrderClaim,
  shopRoutes,
} from '../utils/shopConfig'
import usePageMeta from '../utils/usePageMeta'
import { invalidateCheckoutQueries } from '../queryInvalidation'
import { useAccountAddressesQuery } from '../hooks/useAccountQueries'

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

  if (rawMessage.includes('failed to fetch') || rawMessage.includes('network') || rawMessage.includes('timeout')) {
    return 'We could not reach checkout. Please check your connection and try again.'
  }

  return error?.message || 'We could not start checkout right now. Please try again in a moment.'
}

export default function CheckoutPage() {
  usePageMeta({
    title: 'Checkout',
    description: 'Secure checkout for Manley Lifting shop orders.',
    noIndex: true,
  })

  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { cartItems, cartCount, subtotal, clearCart } = useCart()
  const [errorMessage, setErrorMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [canRetryPendingCheckout, setCanRetryPendingCheckout] = useState(false)
  const [customerName, setCustomerName] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [checkoutAccountState, setCheckoutAccountState] = useState('checking')
  const [showAccountChoice, setShowAccountChoice] = useState(true)
  const [customerPhone, setCustomerPhone] = useState('')
  const [selectedAddressId, setSelectedAddressId] = useState('')
  const savedAddressesQuery = useAccountAddressesQuery()
  const savedAddresses = useMemo(() => savedAddressesQuery.data || [], [savedAddressesQuery.data])
  const [showOneOffAddressForm, setShowOneOffAddressForm] = useState(false)
  const [addressLine1, setAddressLine1] = useState('')
  const [addressLine2, setAddressLine2] = useState('')
  const [addressCity, setAddressCity] = useState('')
  const [addressCounty, setAddressCounty] = useState('')
  const [addressPostcode, setAddressPostcode] = useState('')
  const [addressCountryCode, setAddressCountryCode] = useState('IE')
  const [createAccountForCheckout, setCreateAccountForCheckout] = useState(false)
  const [accountPassword, setAccountPassword] = useState('')
  const [accountConfirmPassword, setAccountConfirmPassword] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [checkoutRef, setCheckoutRef] = useState('')
  const [statusToken, setStatusToken] = useState('')
  const [amountTotalCents, setAmountTotalCents] = useState(0)
  const [serverSubtotalCents, setServerSubtotalCents] = useState(0)
  const [serverShippingCents, setServerShippingCents] = useState(0)
  const [serverTaxCents, setServerTaxCents] = useState(0)
  const [checkoutCurrency, setCheckoutCurrency] = useState('EUR')
  const [serverLineItems, setServerLineItems] = useState([])
  const [priceRefreshNotice, setPriceRefreshNotice] = useState('')
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

  const selectedAddress =
    savedAddresses.find((address) => String(address.id) === String(selectedAddressId)) ||
    (savedAddresses.length === 1 ? savedAddresses[0] : null)
  const shouldShowSavedAddressExperience = checkoutAccountState === 'signed-in'
  const displayedTotal = amountTotalCents > 0 ? amountTotalCents / 100 : subtotal
  const displayedTotalLabel = amountTotalCents > 0 ? 'Total' : 'Current subtotal'

  useEffect(() => {
    if (!savedAddresses.length) return
    if (selectedAddressId) return

    const fallbackAddress = savedAddresses.find((address) => address.isDefaultShipping) || savedAddresses[0]
    if (fallbackAddress) {
      setSelectedAddressId(String(fallbackAddress.id))
    }
  }, [savedAddresses, selectedAddressId])

  useEffect(() => {
    let cancelled = false

    getAccountBootstrap()
      .then((account) => {
        if (cancelled) return
        const nextName = String(account?.fullName || '').trim()
        const nextEmail = String(account?.email || '').trim()
        const nextPhone = String(account?.phone || '').trim()
        setCustomerName((current) => current || nextName)
        setCustomerEmail((current) => current || nextEmail)
        setCustomerPhone((current) => current || nextPhone)
        setCheckoutAccountState('signed-in')
        setShowAccountChoice(false)
        setShowOneOffAddressForm(true)
      })
      .catch(() => {
        if (!cancelled) {
          setCheckoutAccountState('guest')
          setShowAccountChoice(true)
          setShowOneOffAddressForm(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const defaultAddress = savedAddresses.find((address) => address.isDefaultShipping)
    if (defaultAddress) setSelectedAddressId(String(defaultAddress.id))
  }, [savedAddresses])

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
          setCanRetryPendingCheckout(false)
          setStatusMessage('Order confirmed. Your cart has been cleared.')
          navigate(shopRoutes.orderConfirmed)
          if (intervalId) window.clearInterval(intervalId)
          return
        }

        if (result.status === 'failed' || result.status === 'canceled') {
          clearPendingCheckout()
          setCanRetryPendingCheckout(false)
          setStatusMessage('Your payment was not completed. Please try again.')
          if (intervalId) window.clearInterval(intervalId)
          return
        }

        if (attempts >= maxAttempts) {
          if (intervalId) window.clearInterval(intervalId)
          setCanRetryPendingCheckout(true)
          setStatusMessage('Your previous payment is still being verified. If you were charged, please contact support.')
        }
      } catch {
        if (attempts >= maxAttempts && intervalId) {
          window.clearInterval(intervalId)
          setCanRetryPendingCheckout(true)
          setStatusMessage('Your previous payment is still being verified. If you were charged, please contact support.')
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

  function splitCustomerName(fullName) {
    const trimmed = String(fullName || '').trim()
    if (!trimmed) return { firstName: '', lastName: '' }

    const parts = trimmed.split(/\s+/).filter(Boolean)
    if (parts.length === 0) return { firstName: '', lastName: '' }
    if (parts.length === 1) return { firstName: parts[0], lastName: '' }

    return {
      firstName: parts[0],
      lastName: parts.slice(1).join(' '),
    }
  }

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
      const nextStatusToken = generateCapabilityToken()
      const nextClaimToken = generateCapabilityToken()
      const shipping = selectedAddress
        ? {
            name: selectedAddress.recipientName,
            phone: selectedAddress.recipientPhone,
            addressLine1: selectedAddress.addressLine1,
            addressLine2: selectedAddress.addressLine2,
            city: selectedAddress.city,
            county: selectedAddress.county,
            postcode: selectedAddress.postcode,
            countryCode: selectedAddress.countryCode,
          }
        : {
            name: customerName,
            phone: customerPhone,
            addressLine1: addressLine1,
            addressLine2: addressLine2,
            city: addressCity,
            county: addressCounty,
            postcode: addressPostcode,
            countryCode: addressCountryCode,
          }

      if (checkoutAccountState !== 'signed-in') {
        try {
          if (typeof window !== 'undefined') {
            saveGuestCheckoutOffer(customerEmail, customerName)
            if (createAccountForCheckout) {
              window.localStorage.setItem('manley-recent-account-address', JSON.stringify({
                label: 'Checkout address',
                recipientName: customerName.trim(),
                recipientPhone: customerPhone.trim(),
                addressLine1: addressLine1.trim(),
                addressLine2: addressLine2.trim(),
                city: addressCity.trim(),
                county: addressCounty.trim(),
                postcode: addressPostcode.trim(),
                countryCode: addressCountryCode.trim(),
                isDefaultShipping: true,
                isDefaultBilling: false,
              }))
            }
          }
        } catch {
          // Ignore storage failures and keep checkout moving.
        }
      }

      if (createAccountForCheckout && checkoutAccountState !== 'signed-in') {
        if (!accountPassword.trim() || !accountConfirmPassword.trim()) {
          setErrorMessage('Choose a password for your new account before continuing.')
          setIsSubmitting(false)
          return
        }

        if (accountPassword !== accountConfirmPassword) {
          setErrorMessage('The account passwords do not match. Enter the same password in both fields.')
          setIsSubmitting(false)
          return
        }

        const { firstName, lastName } = splitCustomerName(customerName)
        await registerCommerceAccount({
          email: customerEmail.trim(),
          password: accountPassword,
          firstName,
          lastName,
          recipientName: customerName.trim(),
          recipientPhone: customerPhone.trim(),
          addressLine1: addressLine1.trim(),
          addressLine2: addressLine2.trim(),
          city: addressCity.trim(),
          county: addressCounty.trim(),
          postcode: addressPostcode.trim(),
          countryCode: addressCountryCode.trim(),
          acceptTerms: true,
          acceptPrivacy: true,
          turnstileToken,
        })
      }

      const checkout = await createOnsitePaymentIntent(
        checkoutItems,
        nextCheckoutRef,
        {
          name: customerName,
          email: customerEmail,
        },
        {
          accessToken: getAccessToken(),
          antiBotToken: turnstileToken,
          claimToken: nextClaimToken,
          shipping,
          statusToken: nextStatusToken,
        },
      )
      const nextClientSecret = checkout.clientSecret

      if (!nextClientSecret) throw new Error('No payment client secret returned from server')
      if (checkout.statusToken !== nextStatusToken) throw new Error('Checkout status token mismatch')
      if (checkout.claimToken !== nextClaimToken) throw new Error('Checkout claim token mismatch')

      if (checkout.claimToken) {
        savePendingOrderClaim(checkout.orderNumber, checkout.claimToken, checkout.checkoutRef || nextCheckoutRef, nextStatusToken)
      }

      setCheckoutRef(checkout.checkoutRef || nextCheckoutRef)
      setStatusToken(nextStatusToken)
      setClientSecret(nextClientSecret)
      setAmountTotalCents(checkout.amountTotalCents)
      setServerSubtotalCents(Number(checkout.subtotalCents || 0))
      setServerShippingCents(Number(checkout.shippingCents || 0))
      setServerTaxCents(Number(checkout.taxCents || 0))
      setCheckoutCurrency(checkout.currency || 'EUR')
      setServerLineItems(Array.isArray(checkout.lineItems) ? checkout.lineItems : [])
      setPriceRefreshNotice(String(checkout.priceRefreshNotice || '').trim())
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
      void invalidateCheckoutQueries(queryClient, checkoutRef)
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
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#C61F2A]">Checkout</p>
            <h1 className="mt-2 text-4xl font-extrabold text-[#123A7A] md:text-5xl">Checkout</h1>
            <p className="mt-3 max-w-3xl text-sm text-slate-600 md:text-base">
              Complete your payment securely on this page without leaving the site.
            </p>
          </div>
          <div className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">
            Secure payment · Order updates
          </div>
        </div>

        {statusMessage && (
          <div
            className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700"
            role="status"
            aria-live="polite"
          >
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <span>{statusMessage}</span>
              {canRetryPendingCheckout && (
                <button
                  type="button"
                  onClick={() => {
                    clearPendingCheckout()
                    setCanRetryPendingCheckout(false)
                    setStatusMessage('')
                    setErrorMessage('Please start a fresh payment attempt.')
                  }}
                  className="rounded-md border border-emerald-700 px-3 py-2 text-xs font-bold uppercase tracking-wide text-emerald-800 transition hover:bg-emerald-100"
                >
                  Clear and retry
                </button>
              )}
            </div>
          </div>
        )}

        {errorMessage && (
          <div
            className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
            role="alert"
            aria-live="assertive"
          >
            {errorMessage}
          </div>
        )}

        <div className="grid gap-10 lg:grid-cols-[1.25fr_0.75fr]">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-[#123A7A]">Customer Details</h2>

            {checkoutAccountState === 'checking' && (
              <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                Checking your account status…
              </div>
            )}

            {checkoutAccountState === 'guest' && showAccountChoice && (
              <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-5">
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-900">Sign in to your account</p>
                <h3 className="mt-2 text-xl font-bold text-amber-950">Choose how you’d like to continue</h3>
                <p className="mt-2 text-sm text-amber-800">
                  Sign in to use your saved addresses and order history, register for a new account, or continue as a guest.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link to="/account/login?redirect=/checkout" className="rounded-md bg-[#123A7A] px-3 py-2 text-sm font-semibold text-white">
                    Log in
                  </Link>
                  <Link to="/account/register" className="rounded-md border border-amber-300 px-3 py-2 text-sm font-semibold text-amber-900">
                    Register
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAccountChoice(false)
                      setShowOneOffAddressForm(true)
                    }}
                    className="rounded-md border border-amber-300 px-3 py-2 text-sm font-semibold text-amber-900"
                  >
                    Continue as guest
                  </button>
                </div>
              </div>
            )}

            {checkoutAccountState === 'signed-in' && (
              <div className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                Signed in as <span className="font-semibold text-emerald-900">{customerName || 'your account'}</span>. Your saved addresses and order history will be available after checkout.
              </div>
            )}

            {(!showAccountChoice || checkoutAccountState === 'signed-in') && (
              <form className="mt-2 space-y-5">
                <div>
                  <label htmlFor="checkout-full-name" className="mb-2 block text-sm font-semibold text-slate-700">
                    Full Name
                  </label>
                  <input
                    id="checkout-full-name"
                    type="text"
                    value={customerName}
                    onChange={(event) => setCustomerName(event.target.value)}
                    placeholder="John Smith"
                    className="w-full rounded-md border border-slate-300 px-4 py-3 text-slate-900 outline-none transition focus:border-[#123A7A] focus:ring-2 focus:ring-[#123A7A]/20"
                  />
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                  <div>
                    <label htmlFor="checkout-email" className="mb-2 block text-sm font-semibold text-slate-700">
                      Email
                    </label>
                    <input
                      id="checkout-email"
                      type="email"
                      value={customerEmail}
                      onChange={(event) => setCustomerEmail(event.target.value)}
                      placeholder="john@example.com"
                      className="w-full rounded-md border border-slate-300 px-4 py-3 text-slate-900 outline-none transition focus:border-[#123A7A] focus:ring-2 focus:ring-[#123A7A]/20"
                    />
                  </div>

                  <div>
                    <label htmlFor="checkout-phone" className="mb-2 block text-sm font-semibold text-slate-700">
                      Phone
                    </label>
                    <input
                      id="checkout-phone"
                      type="tel"
                      value={customerPhone}
                      onChange={(event) => setCustomerPhone(event.target.value)}
                      placeholder="+353..."
                      className="w-full rounded-md border border-slate-300 px-4 py-3 text-slate-900 outline-none transition focus:border-[#123A7A] focus:ring-2 focus:ring-[#123A7A]/20"
                    />
                  </div>
                </div>

                {shouldShowSavedAddressExperience && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900" data-testid="delivery-address-heading">Delivery address</p>
                        <p className="mt-1 text-sm text-slate-600">
                          {selectedAddress
                            ? 'Your default delivery address is ready for this order.'
                            : 'Add a delivery address for this order.'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowOneOffAddressForm(true)}
                        aria-pressed={showOneOffAddressForm}
                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition ${
                          showOneOffAddressForm
                            ? 'border-[#123A7A] bg-[#123A7A] text-white shadow-sm'
                            : 'border-slate-300 bg-white text-slate-700 hover:border-[#123A7A] hover:text-[#123A7A]'
                        }`}
                      >
                        Change address
                      </button>
                    </div>

                    {selectedAddress ? (
                      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">
                              {selectedAddress.label || 'Default saved address'}
                            </p>
                            <p className="mt-1 text-sm text-slate-700">
                              {selectedAddress.recipientName || 'Recipient'}
                            </p>
                            <p className="text-sm text-slate-700" data-testid="selected-address-line">
                              {selectedAddress.addressLine1}
                              {selectedAddress.addressLine2 ? `, ${selectedAddress.addressLine2}` : ''}
                            </p>
                            <p className="text-sm text-slate-700">
                              {selectedAddress.city}, {selectedAddress.postcode}
                            </p>
                          </div>
                          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                            Default
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">
                        No saved address selected yet. You can still use a new address for this order.
                      </div>
                    )}

                    {showOneOffAddressForm && (
                      <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
                        <label htmlFor="saved-address-select" className="block text-sm font-semibold text-slate-700">
                          Saved address
                        </label>
                        <select
                          id="saved-address-select"
                          value={selectedAddressId}
                          onChange={(event) => {
                            const nextValue = event.target.value
                            setSelectedAddressId(nextValue)
                            setShowOneOffAddressForm(!nextValue)
                          }}
                          className="w-full rounded-md border border-slate-300 px-4 py-3 text-slate-900 outline-none transition focus:border-[#123A7A] focus:ring-2 focus:ring-[#123A7A]/20"
                        >
                          <option value="">Use a new address</option>
                          {savedAddresses.map((address) => (
                            <option key={address.id} value={address.id}>
                              {address.label || 'Saved address'} — {address.city || 'Address'}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}

                {showOneOffAddressForm && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <p className="text-sm font-semibold text-slate-900">Address details</p>
                      <div className="mt-3 grid gap-4 md:grid-cols-2">
                        <label htmlFor="checkout-address-line-1" className="text-sm font-medium text-slate-700">
                          <span className="mb-1 block">Address line 1</span>
                          <input
                            id="checkout-address-line-1"
                            type="text"
                            value={addressLine1}
                            onChange={(event) => setAddressLine1(event.target.value)}
                            className="w-full rounded-md border border-slate-300 px-3 py-2"
                            placeholder="1 Main Street"
                          />
                        </label>
                        <label htmlFor="checkout-address-line-2" className="text-sm font-medium text-slate-700">
                          <span className="mb-1 block">Address line 2</span>
                          <input
                            id="checkout-address-line-2"
                            type="text"
                            value={addressLine2}
                            onChange={(event) => setAddressLine2(event.target.value)}
                            className="w-full rounded-md border border-slate-300 px-3 py-2"
                            placeholder="Apartment, unit, etc."
                          />
                        </label>
                        <label htmlFor="checkout-address-city" className="text-sm font-medium text-slate-700">
                          <span className="mb-1 block">Town or city</span>
                          <input
                            id="checkout-address-city"
                            type="text"
                            value={addressCity}
                            onChange={(event) => setAddressCity(event.target.value)}
                            className="w-full rounded-md border border-slate-300 px-3 py-2"
                            placeholder="City"
                          />
                        </label>
                        <label htmlFor="checkout-address-county" className="text-sm font-medium text-slate-700">
                          <span className="mb-1 block">County</span>
                          <input
                            id="checkout-address-county"
                            type="text"
                            value={addressCounty}
                            onChange={(event) => setAddressCounty(event.target.value)}
                            className="w-full rounded-md border border-slate-300 px-3 py-2"
                            placeholder="County"
                          />
                        </label>
                        <label htmlFor="checkout-address-postcode" className="text-sm font-medium text-slate-700">
                          <span className="mb-1 block">Postcode</span>
                          <input
                            id="checkout-address-postcode"
                            type="text"
                            value={addressPostcode}
                            onChange={(event) => setAddressPostcode(event.target.value)}
                            className="w-full rounded-md border border-slate-300 px-3 py-2"
                            placeholder="Postcode"
                          />
                        </label>
                        <label htmlFor="checkout-address-country-code" className="text-sm font-medium text-slate-700">
                          <span className="mb-1 block">Country code</span>
                          <input
                            id="checkout-address-country-code"
                            type="text"
                            value={addressCountryCode}
                            onChange={(event) => setAddressCountryCode(event.target.value)}
                            className="w-full rounded-md border border-slate-300 px-3 py-2"
                            placeholder="IE"
                          />
                        </label>
                      </div>

                      <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
                        <input
                          id="create-account-for-checkout"
                          type="checkbox"
                          checked={createAccountForCheckout}
                          onChange={(event) => setCreateAccountForCheckout(event.target.checked)}
                          aria-label="Create an account"
                        />
                        Create an account
                      </label>

                      {createAccountForCheckout && (
                        <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
                          <p className="text-sm text-slate-600">
                            We’ll create the account with this email address and send a verification link to activate it.
                          </p>

                          <label htmlFor="checkout-account-password" className="block text-sm font-medium text-slate-700">
                            <span className="mb-1 block">Password</span>
                            <input
                              id="checkout-account-password"
                              type="password"
                              value={accountPassword}
                              onChange={(event) => setAccountPassword(event.target.value)}
                              className="w-full rounded-md border border-slate-300 px-3 py-2"
                              placeholder="Choose a password"
                            />
                          </label>

                          <label htmlFor="checkout-account-confirm-password" className="block text-sm font-medium text-slate-700">
                            <span className="mb-1 block">Confirm password</span>
                            <input
                              id="checkout-account-confirm-password"
                              type="password"
                              value={accountConfirmPassword}
                              onChange={(event) => setAccountConfirmPassword(event.target.value)}
                              className="w-full rounded-md border border-slate-300 px-3 py-2"
                              placeholder="Confirm your password"
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  )}
              </form>
            )}
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
                <span className="text-base font-bold text-[#123A7A]">{displayedTotalLabel}</span>
                <span className="text-xl font-extrabold text-[#C61F2A]">
                  {formatCurrency(displayedTotal, checkoutCurrency)}
                </span>
              </div>

              {priceRefreshNotice && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status" aria-live="polite">
                  <p className="font-semibold">Order updated</p>
                  <p className="mt-1">{priceRefreshNotice}</p>
                </div>
              )}

              {serverLineItems.length > 0 && (
                <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Price breakdown</p>
                  <div className="mt-3 space-y-2 text-sm text-slate-700">
                    {serverLineItems.map((line) => (
                      <div key={`${line.title}-${line.quantity}`} className="flex items-center justify-between gap-3">
                        <span>{line.title} × {line.quantity}</span>
                        <span className="font-semibold text-slate-900">{formatCurrency((line.lineTotalCents || 0) / 100, checkoutCurrency)}</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between border-t border-slate-200 pt-2"><span>Subtotal</span><span>{formatCurrency(serverSubtotalCents / 100, checkoutCurrency)}</span></div>
                    <div className="flex items-center justify-between"><span>Shipping</span><span>{serverShippingCents ? formatCurrency(serverShippingCents / 100, checkoutCurrency) : 'Free'}</span></div>
                    <div className="flex items-center justify-between"><span>VAT/tax</span><span>{formatCurrency(serverTaxCents / 100, checkoutCurrency)}</span></div>
                  </div>
                </div>
              )}

              <div className="mt-8 space-y-3">
                <section className="rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="payment-heading">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-[#C61F2A]">Payment</p>
                    <h3 id="payment-heading" className="mt-1 text-lg font-bold text-[#123A7A]">
                      {clientSecret ? 'Enter payment details' : 'Continue to secure payment'}
                    </h3>
                    <p className="mt-1 text-sm text-slate-600">
                      {clientSecret
                        ? 'Your card details are handled securely by Stripe.'
                        : 'We will confirm the final price and availability before showing the payment form.'}
                    </p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                    Secure
                  </span>
                </div>

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

                {!clientSecret && (
                  <button
                    type="button"
                    onClick={handlePreparePayment}
                    disabled={
                      cartItems.length === 0 ||
                      isSubmitting ||
                      Boolean(turnstileSiteKey && (!turnstileToken || turnstileLoadError))
                    }
                    className="block w-full rounded-md bg-[#123A7A] px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-[#0f3168] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSubmitting ? 'Checking order...' : 'Continue to payment'}
                  </button>
                )}

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

                </section>

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
