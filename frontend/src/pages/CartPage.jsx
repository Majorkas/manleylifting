import { Link } from 'react-router-dom'
import ShopPageLayout from '../components/ShopPageLayout'
import { formatCurrency, shopRoutes } from '../utils/shopConfig'
import { useCart } from '../context/CartContext'

export default function CartPage() {
  const { cartItems, cartCount, subtotal, removeItem } = useCart()

  return (
    <ShopPageLayout>
      <main className="mx-auto w-full max-w-7xl px-6 py-16">
        <div className="mb-10">
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#C61F2A]">Cart</p>
          <h1 className="mt-2 text-4xl font-extrabold text-[#123A7A] md:text-5xl">Your Cart</h1>
        </div>

        <div className="grid gap-10 lg:grid-cols-[1.5fr_0.85fr]">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-[#123A7A]">Cart Items</h2>
              <span className="text-sm font-semibold text-slate-500">
                {cartCount} item{cartCount === 1 ? '' : 's'}
              </span>
            </div>

            <div className="mt-6 space-y-5">
              {cartItems.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
                  Your cart is empty.
                </div>
              ) : (
                cartItems.map((item) => (
                  <article
                    key={item.handle}
                    className="flex flex-col gap-4 rounded-xl border border-slate-200 p-4 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="flex items-start gap-4">
                      {item.imageUrl ? (
                        <img
                          src={item.imageUrl}
                          alt={item.title}
                          className="h-20 w-20 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="h-20 w-20 rounded-lg bg-slate-100" />
                      )}

                      <div>
                        <h3 className="text-lg font-bold text-[#123A7A]">{item.title}</h3>
                        <p className="mt-2 text-sm text-slate-600">Quantity: {item.quantity}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 md:flex-col md:items-end">
                      <p className="text-lg font-semibold text-[#C61F2A]">
                        {formatCurrency(item.price * item.quantity, item.currency)}
                      </p>
                      <button
                        type="button"
                        onClick={() => removeItem(item.handle)}
                        className="text-sm font-semibold text-slate-500 hover:text-[#123A7A]"
                      >
                        Remove
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>

          <aside className="rounded-2xl border border-slate-200 bg-[#f8fafc] p-6 shadow-sm">
            <h2 className="text-xl font-bold text-[#123A7A]">Order Summary</h2>

            <div className="mt-6 space-y-3 text-sm text-slate-700">
              <div className="flex items-center justify-between">
                <span>Subtotal</span>
                <span className="font-semibold text-slate-900">{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Shipping</span>
                <span className="font-semibold text-slate-900">Calculated at checkout</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Tax</span>
                <span className="font-semibold text-slate-900">Calculated at checkout</span>
              </div>
            </div>

            <div className="mt-6 border-t border-slate-200 pt-6">
              <div className="flex items-center justify-between">
                <span className="text-base font-bold text-[#123A7A]">Total</span>
                <span className="text-xl font-extrabold text-[#C61F2A]">
                  {formatCurrency(subtotal)}
                </span>
              </div>

              <div className="mt-8 space-y-3">
                <Link
                  to={shopRoutes.checkout}
                  className="block rounded-md bg-[#123A7A] px-6 py-3 text-center text-sm font-bold uppercase tracking-wide text-white transition hover:bg-[#0f3168]"
                >
                  Proceed to Checkout
                </Link>
                <Link
                  to={shopRoutes.home}
                  className="block rounded-md border-2 border-[#123A7A] px-6 py-3 text-center text-sm font-bold uppercase tracking-wide text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
                >
                  Continue Shopping
                </Link>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </ShopPageLayout>
  )
}
