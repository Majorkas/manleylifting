import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useCatalogManagementMutation, useCatalogManagementQuery } from '../hooks/useCatalogManagementQueries'
import Modal from './Modal'

const emptyForm = { variantRef: '', handle: '', title: '', priceAmount: '', sku: '' }

export default function PortalCatalogManagementPanel() {
  const [search, setSearch] = useState('')
  const [isActive, setIsActive] = useState(undefined)
  const [page, setPage] = useState(1)
  const [editingProduct, setEditingProduct] = useState(null)
  const [isProductFormOpen, setIsProductFormOpen] = useState(false)
  const [stockTargetId, setStockTargetId] = useState(null)
  const [stockDelta, setStockDelta] = useState('')
  const [stockReason, setStockReason] = useState('')
  const [form, setForm] = useState(emptyForm)
  const catalogQuery = useCatalogManagementQuery({ search, isActive, page })
  const mutation = useCatalogManagementMutation()
  const products = catalogQuery.data?.results || []

  useEffect(() => {
    if (editingProduct) setIsProductFormOpen(true)
  }, [editingProduct])

  function submit(event) {
    event.preventDefault()
    mutation.mutate({ productId: editingProduct?.id, action: editingProduct ? 'update' : 'create', payload: form }, {
      onSuccess: () => {
        setForm(emptyForm)
        setEditingProduct(null)
        setIsProductFormOpen(false)
      },
    })
  }

  return (
    <section aria-labelledby="catalog-management-heading" className="mt-8 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#C61F2A]">Store management</p>
          <h2 id="catalog-management-heading" className="mt-1 text-2xl font-extrabold text-[#123A7A]">Store products</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">Create, update, publish, archive, and adjust stock for the products customers can buy.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto]">
        <label className="text-sm font-semibold text-slate-700">
          <span className="mb-1 block">Find a product</span>
          <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Name or handle" className="min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 font-normal" />
        </label>
        <label className="text-sm font-semibold text-slate-700"><span className="mb-1 block">Visibility</span>
          <span className="relative block">
            <select aria-label="Visibility" value={isActive == null ? '' : String(isActive)} onChange={(event) => { setIsActive(event.target.value === '' ? undefined : event.target.value); setPage(1) }} className="min-h-11 w-full appearance-none rounded-md border border-slate-300 bg-white px-3 py-2 pr-9 font-normal text-slate-900 outline-none transition focus:border-[#123A7A] focus:ring-2 focus:ring-[#123A7A]/20">
              <option value="">All products</option><option value="true">Active only</option><option value="false">Archived only</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} aria-hidden="true" />
          </span>
        </label>
        <button type="button" onClick={() => { setEditingProduct(null); setForm(emptyForm); setIsProductFormOpen(true) }} className="min-h-11 rounded-md bg-[#123A7A] px-4 py-2 text-sm font-semibold text-white">
          Add product
        </button>
        </div>
      </div>

      <Modal open={isProductFormOpen} onClose={() => { setIsProductFormOpen(false); setEditingProduct(null) }} ariaLabel={editingProduct ? 'Edit product' : 'Add a product'}>
      <form onSubmit={submit}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-slate-900">{editingProduct ? 'Edit product' : 'Add a product'}</h3>
            <p className="mt-1 text-sm text-slate-600">Stock is managed separately from product details.</p>
          </div>
          <button type="button" onClick={() => { setIsProductFormOpen(false); setEditingProduct(null) }} className="min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700">Cancel</button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            ['variantRef', 'Variant reference', 'Internal product or variant ID'],
            ['handle', 'Product handle', 'Lowercase URL handle, for example chain-block'],
            ['title', 'Product name', 'The name customers will see'],
            ['priceAmount', 'Price (EUR)', 'Enter the selling price before shipping and tax'],
            ['sku', 'SKU', 'Optional stock-keeping reference'],
          ].map(([field, label, hint]) => (
            <label key={field} className="text-sm font-semibold text-slate-700">
              <span className="mb-1 block">{label}</span>
              <input required={['variantRef', 'handle', 'title', 'priceAmount'].includes(field)} value={form[field]} onChange={(event) => setForm((current) => ({ ...current, [field]: event.target.value }))} placeholder={hint} type={field === 'priceAmount' ? 'number' : 'text'} step={field === 'priceAmount' ? '0.01' : undefined} min={field === 'priceAmount' ? '0' : undefined} className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-normal text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#123A7A] focus:ring-2 focus:ring-[#123A7A]/20" />
            </label>
          ))}
        </div>
        <button type="submit" disabled={mutation.isPending} className="mt-4 min-h-11 rounded-md bg-[#123A7A] px-4 py-2 font-semibold text-white disabled:opacity-60">
          {mutation.isPending ? 'Saving product...' : editingProduct ? 'Save product changes' : 'Add product'}
        </button>
      </form>
      </Modal>
      {mutation.isError && <p role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{mutation.error?.message || 'Catalog update failed.'}</p>}

      {catalogQuery.isPending && <p className="mt-5 text-sm text-slate-600" role="status">Loading store products...</p>}
      {catalogQuery.isError && <p role="alert" className="mt-5 rounded-md bg-red-50 p-3 text-sm text-red-700">{catalogQuery.error.message}</p>}
      {!catalogQuery.isPending && !catalogQuery.isError && products.length === 0 && <p className="mt-5 text-sm text-slate-600">No products found.</p>}
      {products.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead><tr className="border-b border-slate-200 text-slate-500"><th className="px-3 py-2">Product</th><th className="px-3 py-2">Price</th><th className="px-3 py-2">Stock</th><th className="px-3 py-2">Visibility</th><th className="px-3 py-2">Actions</th></tr></thead>
            <tbody>
              {products.map((product) => {
                const isStockTarget = stockTargetId === product.id
                return (
                  <tr key={product.id} className="border-b border-slate-100">
                    <td className="px-3 py-3 font-semibold">
                      {product.title}
                      <span className="mt-1 block text-xs font-normal text-slate-500">{product.handle}</span>
                    </td>
                    <td className="px-3 py-3 font-variant-numeric:tabular-nums">{product.currencyCode} {product.priceAmount}</td>
                    <td className="px-3 py-3">
                      <div className="font-variant-numeric:tabular-nums">
                        {product.availableQty} available <span className="text-xs text-slate-500">({product.reservedQty} reserved)</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <input
                          aria-label={`Stock change for ${product.title}`}
                          value={isStockTarget ? stockDelta : ''}
                          onChange={(event) => { setStockTargetId(product.id); setStockDelta(event.target.value) }}
                          placeholder="+/- qty"
                          className="min-h-10 w-20 rounded border px-2 py-1"
                        />
                        <input
                          aria-label={`Stock reason for ${product.title}`}
                          value={isStockTarget ? stockReason : ''}
                          onChange={(event) => { setStockTargetId(product.id); setStockReason(event.target.value) }}
                          placeholder="Reason"
                          className="min-h-10 w-28 rounded border px-2 py-1"
                        />
                        <button
                          type="button"
                          onClick={() => mutation.mutate({ productId: product.id, action: 'stock', payload: { delta: stockDelta, reason: stockReason } })}
                          className="min-h-10 rounded bg-slate-100 px-2 py-1 text-xs font-semibold"
                        >
                          Adjust stock
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-3">{product.isActive ? 'Active' : 'Archived'}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingProduct(product)
                            setForm({
                              variantRef: product.variantRef,
                              handle: product.handle,
                              title: product.title,
                              priceAmount: product.priceAmount,
                              sku: product.sku || '',
                            })
                          }}
                          className="min-h-10 font-semibold text-[#123A7A]"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => mutation.mutate({ productId: product.id, action: 'state', payload: { action: product.isActive ? 'archive' : 'reactivate' } })}
                          className="min-h-10 font-semibold text-[#C61F2A]"
                        >
                          {product.isActive ? 'Archive product' : 'Reactivate product'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 flex items-center justify-between"><button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} className="rounded-md border px-3 py-2 text-sm">Previous</button><span className="text-sm text-slate-600">Page {page}</span><button type="button" disabled={page >= Number(catalogQuery.data?.total_pages || 1)} onClick={() => setPage((current) => current + 1)} className="rounded-md border px-3 py-2 text-sm">Next</button></div>
    </section>
  )
}
