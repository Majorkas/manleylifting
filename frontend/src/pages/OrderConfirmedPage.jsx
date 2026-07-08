import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import ShopPageLayout from '../components/ShopPageLayout'
import {
  clearCompletedCheckout,
  formatCurrency,
  getOnsiteOrderSummary,
  loadCompletedCheckout,
  shopRoutes,
} from '../utils/shopConfig'
import usePageMeta from '../utils/usePageMeta'

export default function OrderConfirmedPage() {
  usePageMeta({
    title: 'Order Confirmed',
    description: 'Order confirmation details for your Manley Lifting purchase.',
    noIndex: true,
  })

  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [order, setOrder] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function loadOrder() {
      const completed = loadCompletedCheckout()
      if (!completed?.checkoutRef || !completed?.statusToken) {
        setErrorMessage('We could not find a recent completed order. Please contact support if you were charged.')
        setIsLoading(false)
        return
      }

      try {
        const summary = await getOnsiteOrderSummary(completed.checkoutRef, completed.statusToken)
        if (cancelled) return
        setOrder(summary)
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
    }
  }, [])

  return (
    <ShopPageLayout>
      <main className="mx-auto w-full max-w-5xl px-6 py-16">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#C61F2A]">Order Confirmed</p>
          <h1 className="mt-2 text-4xl font-extrabold text-[#123A7A] md:text-5xl">Thank You</h1>

          {isLoading && <p className="mt-5 text-slate-600">Loading your order details...</p>}

          {!isLoading && errorMessage && (
            <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorMessage}</div>
          )}

          {!isLoading && order && (
            <>
              <p className="mt-5 text-slate-700">
                We have received your payment and emailed confirmation to{' '}
                <span className="font-semibold text-slate-900">{order.customerEmail || 'your email address'}</span>.
              </p>

              <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between border-b border-slate-200 pb-3 text-sm">
                  <span className="font-semibold text-slate-700">Order Status</span>
                  <span className="font-bold uppercase tracking-wide text-emerald-700">{order.status}</span>
                </div>

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
                  <span className="text-base font-bold text-[#123A7A]">Total Paid</span>
                  <span className="text-xl font-extrabold text-[#C61F2A]">
                    {formatCurrency(order.amountTotalCents / 100, order.currency)}
                  </span>
                </div>
              </div>

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
