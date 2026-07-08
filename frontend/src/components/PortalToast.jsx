export default function PortalToast({ toast, onClose }) {
  if (!toast) return null

  return (
    <div className="fixed bottom-6 right-6 z-[110] w-[calc(100%-3rem)] max-w-sm">
      <div className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">Success</p>
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

        <p className="mt-3 text-sm text-slate-700">{toast.message}</p>
      </div>
    </div>
  )
}
