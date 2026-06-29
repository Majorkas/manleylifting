import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import ShopPageLayout from '../components/ShopPageLayout'
import { useCart } from '../context/CartContext'
import {
  clearPendingCheckout,
  createCheckoutUrl,
  formatCurrency,
  generateCheckoutRef,
  getCheckoutStatus,
  loadPendingCheckout,
  savePendingCheckout,
  shopRoutes,
} from '../utils/shopConfig'

export default function CheckoutPage() {
  const { cartItems, cartCount, subtotal, clearCart } = useCart()
  const [errorMessage, setErrorMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')

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
        const result = await getCheckoutStatus(pending.checkoutRef, pending.statusToken)
        if (cancelled) return

        if (result.status === 'confirmed') {
          clearCart()
          clearPendingCheckout()
          setStatusMessage('Order confirmed. Your cart has been cleared.')
          if (intervalId) window.clearInterval(intervalId)
          return
        }

        if (result.status === 'missing' || result.status === 'expired') {
          clearPendingCheckout()
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
  }, [clearCart])

  async function handlePlaceOrder() {
    if (checkoutItems.length === 0) return

    setIsSubmitting(true)
    setErrorMessage('')

    try {
      const checkoutRef = generateCheckoutRef()
      const checkout = await createCheckoutUrl(checkoutItems, checkoutRef)
      const checkoutUrl = checkout.checkoutUrl
      const statusToken = checkout.statusToken

      if (!checkoutUrl) throw new Error('No checkout URL returned from server')
      if (!statusToken) throw new Error('No status token returned from server')

      savePendingCheckout(checkoutRef, statusToken)
      window.location.assign(checkoutUrl)
    } catch (error) {
      setErrorMessage(error.message || 'Could not start checkout right now.')
      setIsSubmitting(false)
    }
  }

  return (
    <ShopPageLayout>
      <main className="mx-auto w-full max-w-7xl px-6 py-16">
        <div className="mb-10">
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#C61F2A]">Checkout</p>
          <h1 className="mt-2 text-4xl font-extrabold text-[#123A7A] md:text-5xl">Checkout</h1>
          <p className="mt-4 max-w-3xl text-slate-600">
            Place order now creates a live Shopify checkout and redirects the customer securely.
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
                  placeholder="John Smith"
                  className="w-full rounded-md border border-slate-300 px-4 py-3 text-slate-900 outline-none transition focus:border-[#123A7A] focus:ring-2 focus:ring-[#123A7A]/20"
                />
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">Email</label>
                  <input
                    type="email"
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
                <span className="text-xl font-extrabold text-[#C61F2A]">{formatCurrency(subtotal)}</span>
              </div>

              <div className="mt-8 space-y-3">
                <button
                  type="button"
                  onClick={handlePlaceOrder}
                  disabled={cartItems.length === 0 || isSubmitting}
                  className="block w-full rounded-md bg-[#123A7A] px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-[#0f3168] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? 'Redirecting...' : 'Place Order'}
                </button>

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
