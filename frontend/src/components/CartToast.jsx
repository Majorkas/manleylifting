import { Link } from 'react-router-dom'

export default function CartToast({ toast, onClose }) {
  if (!toast) return null

  return (
    <div
      className="fixed bottom-6 right-6 z-[110] w-[calc(100%-3rem)] max-w-sm transition-all duration-200 translate-y-0 opacity-100"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#C61F2A]">
              Added to Cart
            </p>
            <h3 className="mt-1 text-base font-extrabold text-[#123A7A]">{toast.title}</h3>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-600 hover:border-[#123A7A] hover:text-[#123A7A]"
            aria-label="Close cart notification"
          >
            Close
          </button>
        </div>

        <div className="mt-3 space-y-1 text-sm text-slate-700">
          <p>Added: {toast.addedCost}</p>
          <p>Cart total: {toast.cartValue}</p>
        </div>

        <Link
          to="/cart"
          className="mt-4 inline-flex rounded-md bg-[#123A7A] px-3 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-[#0f3168]"
          onClick={onClose}
        >
          View cart
        </Link>
      </div>
    </div>
  )
}
