export default function CartToast({ toast, onClose }) {
  if (!toast) return null

  return (
    <div
      className="fixed bottom-6 right-6 z-[110] w-[calc(100%-3rem)] max-w-sm transition-all duration-200 translate-y-0 opacity-100"
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
          >
            Close
          </button>
        </div>

        <div className="mt-3 space-y-1 text-sm text-slate-700">
          <p>Added: {toast.addedCost}</p>
          <p>Cart total: {toast.cartValue}</p>
        </div>
      </div>
    </div>
  )
}
