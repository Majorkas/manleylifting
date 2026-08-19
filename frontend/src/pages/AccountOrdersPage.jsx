import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Download, FileText, Package2, Printer, ReceiptText, X } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import AccountLayout from '../components/AccountLayout'
import AccountSectionTabs from '../components/AccountSectionTabs'
import Modal from '../components/Modal'
import { useAccountOrdersQuery } from '../hooks/useAccountQueries'
import { downloadAccountOrderInvoice } from '../utils/portalApi'
import usePageMeta from '../utils/usePageMeta'

function formatCurrency(amountCents, currency = 'EUR') {
  const normalizedCurrency = String(currency || 'EUR').toUpperCase()
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

function getInvoiceLineItems(order) {
  return Array.isArray(order?.lineItems) ? order.lineItems : []
}

export default function AccountOrdersPage() {
  usePageMeta({ title: 'My orders', description: 'View your recent Manley Lifting orders.', noIndex: true })
  const navigate = useNavigate()
  const ordersQuery = useAccountOrdersQuery()
  const [invoiceOrder, setInvoiceOrder] = useState(null)
  const orders = useMemo(() => ordersQuery.data || [], [ordersQuery.data])
  const loading = ordersQuery.isPending
  const errorMessage = ordersQuery.error?.status === 401
    ? ''
    : String(ordersQuery.error?.message || '')

  useEffect(() => {
    if (ordersQuery.error?.status === 401) {
      navigate('/account/login?redirect=/account/orders', { replace: true })
    }
  }, [navigate, ordersQuery.error])

  const summary = useMemo(() => ({
    count: orders.length,
    latestAmount: orders[0]?.amountTotalCents || 0,
    latestCurrency: orders[0]?.currency || 'EUR',
  }), [orders])

  async function handleDownloadInvoice(order) {
    const blob = await downloadAccountOrderInvoice(order.orderNumber)
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `invoice-${order.orderNumber || order.checkoutRef || 'order'}.pdf`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
  }

  async function handlePrintInvoice(order) {
    const blob = await downloadAccountOrderInvoice(order.orderNumber)
    const url = window.URL.createObjectURL(blob)
    const frame = document.createElement('iframe')
    frame.style.position = 'fixed'
    frame.style.width = '0'
    frame.style.height = '0'
    frame.style.border = '0'
    frame.src = url
    frame.onload = () => {
      frame.contentWindow?.focus()
      frame.contentWindow?.print()
      window.setTimeout(() => {
        frame.remove()
        window.URL.revokeObjectURL(url)
      }, 1500)
    }
    document.body.appendChild(frame)
  }

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

              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => setInvoiceOrder(order)}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-[#123A7A] hover:text-[#123A7A]"
                  aria-label={`View invoice for ${order.orderNumber || order.checkoutRef}`}
                >
                  <FileText size={15} aria-hidden="true" /> View invoice
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>

      <Modal
        open={Boolean(invoiceOrder)}
        onClose={() => setInvoiceOrder(null)}
        ariaLabel={`Invoice ${invoiceOrder?.orderNumber || invoiceOrder?.checkoutRef || ''}`}
        panelClassName="max-h-[calc(100vh-3rem)] w-full max-w-3xl overflow-y-auto rounded-lg border border-slate-200 bg-white p-6 shadow-xl"
      >
        {invoiceOrder && (
          <div>
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-5">
              <div>
                <img src="/logo-navbar.png" alt="Manley Lifting" className="h-10 w-auto object-contain" />
                <h2 className="mt-3 text-2xl font-bold text-[#123A7A]">Invoice {invoiceOrder.orderNumber || invoiceOrder.checkoutRef}</h2>
                <p className="mt-1 text-sm text-slate-600">Issued {formatDate(invoiceOrder.createdAt)}</p>
              </div>
              <button type="button" onClick={() => setInvoiceOrder(null)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900" aria-label="Close invoice">
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Billed to</p>
                <p className="mt-2 text-sm font-semibold text-slate-900">{invoiceOrder.shippingName || invoiceOrder.customerName || 'Customer'}</p>
                <p className="whitespace-pre-line text-sm text-slate-600">{[
                  invoiceOrder.shippingAddressLine1,
                  invoiceOrder.shippingAddressLine2,
                  [invoiceOrder.shippingCity, invoiceOrder.shippingCounty, invoiceOrder.shippingPostcode].filter(Boolean).join(', '),
                  invoiceOrder.shippingCountryCode,
                ].filter(Boolean).join('\n')}</p>
              </div>
              <div className="sm:text-right">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Payment status</p>
                <p className="mt-2 text-sm font-semibold uppercase text-emerald-700">{invoiceOrder.paymentStatus || invoiceOrder.status || 'Paid'}</p>
              </div>
            </div>

            <div className="mt-6 overflow-x-auto border-y border-slate-200">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-3">Item</th><th className="py-3">Qty</th><th className="py-3 text-right">Total</th></tr></thead>
                <tbody>
                  {getInvoiceLineItems(invoiceOrder).map((item, index) => (
                    <tr key={`${item.sku || item.variantId || index}-${index}`} className="border-t border-slate-100"><td className="py-3"><p className="font-semibold text-slate-900">{item.title || item.sku || 'Item'}</p></td><td className="py-3">{Number(item.quantity || 0)}</td><td className="py-3 text-right font-semibold text-slate-900">{formatCurrency(item.lineTotalCents, item.currency || invoiceOrder.currency)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-5 ml-auto w-full max-w-xs space-y-2 text-sm text-slate-700">
              <div className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(invoiceOrder.subtotalCents || getInvoiceLineItems(invoiceOrder).reduce((total, item) => total + Number(item.lineTotalCents || 0), 0), invoiceOrder.currency)}</span></div>
              <div className="flex justify-between"><span>Shipping paid</span><span>{formatCurrency(invoiceOrder.shippingCents, invoiceOrder.currency)}</span></div>
              <div className="flex justify-between"><span>Taxes</span><span>{formatCurrency(invoiceOrder.taxCents, invoiceOrder.currency)}</span></div>
              <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-base font-bold text-[#123A7A]"><span>Total paid</span><span>{formatCurrency(invoiceOrder.amountTotalCents, invoiceOrder.currency)}</span></div>
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => handlePrintInvoice(invoiceOrder)} className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-[#123A7A] hover:text-[#123A7A]"><Printer size={16} aria-hidden="true" /> Print invoice</button>
              <button type="button" onClick={() => handleDownloadInvoice(invoiceOrder)} className="inline-flex items-center gap-2 rounded-md bg-[#123A7A] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0f3168]"><Download size={16} aria-hidden="true" /> Download invoice</button>
            </div>
          </div>
        )}
      </Modal>
    </AccountLayout>
  )
}
