import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Package2, ReceiptText } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import AccountLayout from '../components/AccountLayout'
import AccountSectionTabs from '../components/AccountSectionTabs'
import { getAccountOrders } from '../utils/portalApi'
import usePageMeta from '../utils/usePageMeta'

function formatCurrency(amountCents, currency = 'GBP') {
  const normalizedCurrency = String(currency || 'GBP').toUpperCase()
  const amount = Number(amountCents || 0) / 100
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: normalizedCurrency,
    minimumFractionDigits: 2,
  }).format(amount)
}

function formatDate(value) {
  if (!value) return 'Pending'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function AccountOrdersPage() {
  usePageMeta({ title: 'My orders', description: 'View your recent Manley Lifting orders.', noIndex: true })
  const navigate = useNavigate()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    getAccountOrders()
      .then((result) => {
        if (!cancelled) setOrders(result)
      })
      .catch((error) => {
        if (cancelled) return
        if (error?.status === 401) {
          navigate('/account/login?redirect=/account/orders', { replace: true })
          return
        }
        setErrorMessage(String(error?.message || 'Orders could not be loaded.'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [navigate])

  const summary = useMemo(() => ({
    count: orders.length,
    latestAmount: orders[0]?.amountTotalCents || 0,
    latestCurrency: orders[0]?.currency || 'GBP',
  }), [orders])

  return (
    <AccountLayout
      eyebrow="Orders"
      title="Order history"
      intro="Review recent purchases and keep track of your current order status."
      headerAction={(
        <Link to="/account" className="inline-flex items-center gap-2 text-sm font-semibold text-[#123A7A]">
          <ArrowLeft size={16} aria-hidden="true" /> Back to account
        </Link>
      )}
    >
      <AccountSectionTabs />
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 shadow-sm">
          <div>
            <p className="text-sm font-semibold text-slate-900">{summary.count} order{summary.count === 1 ? '' : 's'} saved</p>
            <p className="text-sm text-slate-600">Latest purchase: {summary.count ? formatCurrency(summary.latestAmount, summary.latestCurrency) : 'No orders yet'}</p>
          </div>
        </div>

        {errorMessage && <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div>}

        {loading && !errorMessage && <p className="text-slate-600">Loading your orders…</p>}

        {!loading && !errorMessage && orders.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
            You have not placed any orders yet.
          </div>
        )}

        <div className="space-y-3">
          {orders.map((order) => (
            <article key={order.checkoutRef} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-[#123A7A] hover:shadow-md">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Package2 size={18} className="text-[#123A7A]" aria-hidden="true" />
                    <p className="font-semibold text-slate-900">{order.orderNumber || order.checkoutRef}</p>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">Placed {formatDate(order.createdAt)}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-slate-900">{formatCurrency(order.amountTotalCents, order.currency)}</p>
                  <p className="text-sm text-slate-500">{String(order.status || 'Processing').replace(/^./, (char) => char.toUpperCase())}</p>
                </div>
              </div>

              <div className="mt-4 space-y-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                <div className="flex items-center gap-2">
                  <ReceiptText size={16} className="text-slate-500" aria-hidden="true" />
                  <span>{order.lineItems?.length ? `${order.lineItems.length} item${order.lineItems.length === 1 ? '' : 's'}` : 'Item details available in your confirmation email'}</span>
                </div>
                <div className="text-slate-500">
                  {[
                    order.shippingName,
                    order.shippingAddressLine1,
                    [order.shippingCity, order.shippingCounty, order.shippingPostcode].filter(Boolean).join(', '),
                    order.shippingCountryCode,
                  ].filter(Boolean).join(' • ') || `Shipping to ${order.customerName || 'your saved address'} • Updates and tracking sent by email`}
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </AccountLayout>
  )
}
