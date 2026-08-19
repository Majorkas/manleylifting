import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useFeaturedProductsQuery } from '../hooks/useCatalogQueries'
import { buildProductPath, formatCurrency, getStockStatus } from '../utils/shopConfig'

export default function ShopSearchPopover() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const triggerRef = useRef(null)
  const inputRef = useRef(null)
  const { data: products = [], isPending } = useFeaturedProductsQuery()

  useEffect(() => {
    if (!open) return undefined

    inputRef.current?.focus()
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open])

  const normalizedQuery = query.trim().toLowerCase()
  const results = normalizedQuery
    ? products.filter((product) =>
      `${product.title} ${product.description || ''}`.toLowerCase().includes(normalizedQuery),
    ).slice(0, 6)
    : products.slice(0, 6)

  function closePopover() {
    setOpen(false)
    setQuery('')
    triggerRef.current?.focus()
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 text-[#123A7A] transition hover:border-[#123A7A] hover:bg-[#123A7A]/5"
        aria-label="Search products"
        aria-expanded={open}
        aria-controls="shop-product-search"
        title="Search products"
      >
        <Search size={18} aria-hidden="true" />
      </button>

      {open && (
        <div
          id="shop-product-search"
          className="absolute right-0 top-12 z-[100] w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-4 shadow-2xl"
          role="dialog"
          aria-label="Shop product search"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#C61F2A]">Shop search</p>
              <h2 className="mt-1 text-lg font-bold text-[#123A7A]">Find a product</h2>
            </div>
            <button
              type="button"
              onClick={closePopover}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-600 hover:border-[#123A7A] hover:text-[#123A7A]"
              aria-label="Close product search"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          <label className="sr-only" htmlFor="shop-navbar-search">Search shop products</label>
          <input
            ref={inputRef}
            id="shop-navbar-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by product or use"
            className="mt-4 w-full rounded-md border border-slate-300 px-3 py-3 text-sm text-slate-900 outline-none focus:border-[#123A7A] focus:ring-2 focus:ring-[#123A7A]/20"
          />

          <div className="mt-3 max-h-80 space-y-2 overflow-y-auto" aria-live="polite">
            {isPending && <p className="p-3 text-sm text-slate-600">Loading products...</p>}
            {!isPending && results.length === 0 && (
              <p className="p-3 text-sm text-slate-600">No products match that search.</p>
            )}
            {!isPending && results.map((product) => {
              const stockStatus = getStockStatus(product)
              return (
                <Link
                  key={product.handle}
                  to={buildProductPath(product.handle)}
                  onClick={closePopover}
                  className="flex gap-3 rounded-lg border border-slate-200 p-3 transition hover:border-[#123A7A] hover:bg-slate-50"
                  aria-label={`${product.title}, ${formatCurrency(product.price, product.currency)}`}
                >
                  {product.imageUrl ? (
                    <img src={product.imageUrl} alt="" className="h-14 w-14 rounded-md object-cover" />
                  ) : (
                    <span className="h-14 w-14 rounded-md bg-slate-100" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-[#123A7A]">{product.title}</span>
                    <span className="mt-1 block text-sm font-semibold text-[#C61F2A]">
                      {formatCurrency(product.price, product.currency)}
                    </span>
                    <span className="mt-1 block text-xs text-slate-600">{stockStatus.label}</span>
                  </span>
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
