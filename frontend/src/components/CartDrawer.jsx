import { Link } from 'react-router-dom'
import { formatCurrency, shopRoutes } from '../utils/shopConfig'

export default function CartDrawer({
  open,
  items,
  subtotal,
  onClose,
  onIncreaseQuantity,
  onDecreaseQuantity,
  onRemoveItem,
}) {
  return (
    <div className={'fixed inset-0 z-[90] ' + (open ? 'pointer-events-auto' : 'pointer-events-none')}>
      <button
        type="button"
        aria-label="Close cart drawer"
        onClick={onClose}
        className={
          'absolute inset-0 bg-slate-950/40 transition-opacity duration-300 ' +
          (open ? 'opacity-100' : 'opacity-0')
        }
      />

      <aside
        className={
          'absolute right-0 top-0 flex h-full w-full max-w-md transform flex-col bg-white shadow-2xl transition-transform duration-300 ' +
          (open ? 'translate-x-0' : 'translate-x-full')
        }
        role="dialog"
        aria-modal="true"
        aria-label="Shopping cart"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#C61F2A]">Cart</p>
            <h2 className="text-xl font-extrabold text-[#123A7A]">Your Cart</h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-[#123A7A] hover:text-[#123A7A]"
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
              Your cart is empty.
            </div>
          ) : (
            <div className="space-y-4">
              {items.map((item) => (
                <article key={item.handle} className="rounded-xl border border-slate-200 p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-base font-bold text-[#123A7A]">{item.title}</h3>
                      <p className="mt-1 text-sm text-slate-500">
                        {formatCurrency(item.price, item.currency)}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => onRemoveItem(item.handle)}
                      className="text-sm font-semibold text-slate-500 hover:text-[#C61F2A]"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onDecreaseQuantity(item.handle)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:border-[#123A7A] hover:text-[#123A7A]"
                        aria-label={'Decrease quantity for ' + item.title}
                      >
                        -
                      </button>

                      <span className="min-w-8 text-center text-sm font-semibold text-slate-900">
                        {item.quantity}
                      </span>

                      <button
                        type="button"
                        onClick={() => onIncreaseQuantity(item.handle)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:border-[#123A7A] hover:text-[#123A7A]"
                        aria-label={'Increase quantity for ' + item.title}
                      >
                        +
                      </button>
                    </div>

                    <p className="text-sm font-semibold text-[#C61F2A]">
                      {formatCurrency(item.price * Number(item.quantity), item.currency)}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 bg-slate-50 px-6 py-5">
          <div className="flex items-center justify-between">
            <span className="text-base font-bold text-[#123A7A]">Subtotal</span>
            <span className="text-lg font-extrabold text-[#C61F2A]">{formatCurrency(subtotal)}</span>
          </div>

          <div className="mt-4 grid gap-3">
            <Link
              to={shopRoutes.cart}
              onClick={onClose}
              className="block rounded-md border-2 border-[#123A7A] px-4 py-3 text-center text-sm font-bold uppercase tracking-wide text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
            >
              View Full Cart
            </Link>

            <Link
              to={shopRoutes.checkout}
              onClick={onClose}
              className="block rounded-md bg-[#123A7A] px-4 py-3 text-center text-sm font-bold uppercase tracking-wide text-white transition hover:bg-[#0f3168]"
            >
              Proceed to Checkout
            </Link>
          </div>
        </div>
      </aside>
    </div>
  )
}
