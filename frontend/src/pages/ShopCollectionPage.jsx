import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import QuantityAddToCart from '../components/QuantityAddToCart'
import ShopPageLayout from '../components/ShopPageLayout'
import { CollectionGridSkeleton } from '../components/ShopSkeleton'
import { useCart } from '../context/CartContext'
import { useCollectionQuery } from '../hooks/useCatalogQueries'
import StockStatusBadge from '../components/StockStatusBadge'
import {
  buildProductPath,
  formatCurrency,
  getUserFacingErrorMessage,
  getStockStatus,
  shopRoutes,
} from '../utils/shopConfig'
import usePageMeta from '../utils/usePageMeta'

export default function ShopCollectionPage() {
  const { handle } = useParams()
  const { addItem } = useCart()
  const collectionQuery = useCollectionQuery(handle)
  const collection = collectionQuery.data
  const loading = collectionQuery.isPending
  const errorMessage = collectionQuery.error
    ? getUserFacingErrorMessage(
      collectionQuery.error,
      'We could not load this collection right now. Please try again in a moment.',
    )
    : ''
  const [quantityByHandle, setQuantityByHandle] = useState({})

  usePageMeta({
    title: collection?.title ? `${collection.title} Collection` : 'Shop Collection',
    description:
      collection?.description ||
      'Explore lifting products in this collection from Manley Lifting.',
  })

  function getDisplayPrice(product) {
    const unitPrice = Number(product?.price || 0)
    const quantity = quantityByHandle[product.handle] || 1
    return unitPrice * quantity
  }

  function handleQuantityChange(productHandle, quantity) {
    setQuantityByHandle((current) => {
      if (current[productHandle] === quantity) return current
      return {
        ...current,
        [productHandle]: quantity,
      }
    })
  }

  return (
    <ShopPageLayout>
      <main>
        <section className="border-b border-slate-200 bg-[#f8fafc]">
          <div className="mx-auto w-full max-w-7xl px-6 py-16 md:py-20">
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#C61F2A]">
              Collection
            </p>
            <h1 className="mt-2 text-4xl font-extrabold text-[#123A7A] md:text-5xl">
              {collection?.title || 'Collection'}
            </h1>
            <p className="mt-4 max-w-3xl text-slate-600">{collection?.description || ' '}</p>

            <div className="mt-6">
              <Link
                to={shopRoutes.home}
                className="inline-flex items-center text-sm font-semibold text-[#C61F2A] transition hover:text-[#9f1720]"
              >
                <span className="mr-2" aria-hidden="true">
                  ←
                </span>
                Back to store
              </Link>
            </div>
          </div>
        </section>

        {errorMessage && (
          <section className="bg-white">
            <div className="mx-auto w-full max-w-7xl px-6 py-6">
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {errorMessage}
              </div>
            </div>
          </section>
        )}

        <section className="bg-white">
          <div className="mx-auto w-full max-w-7xl px-6 py-16">
            {loading ? (
              <CollectionGridSkeleton count={3} />
            ) : (
              <div className="grid gap-6 md:grid-cols-3">
                {(collection?.products || []).map((product) => {
                  const stockStatus = getStockStatus(product)

                  return (
                  <article
                    key={product.handle}
                    className="group flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-[#123A7A] hover:shadow-md sm:p-5"
                  >
                    <Link
                      to={buildProductPath(product.handle)}
                      className="block cursor-pointer"
                      aria-label={'View ' + product.title}
                    >
                      {product.imageUrl ? (
                        <div className="overflow-hidden rounded-lg bg-slate-50">
                          <img
                            src={product.imageUrl}
                            alt={product.imageAlt || product.title}
                            loading="lazy"
                            decoding="async"
                            className="aspect-[4/3] w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                          />
                        </div>
                      ) : (
                        <div className="aspect-[4/3] rounded-lg bg-slate-100" />
                      )}

                      <div className="mt-5 flex items-start justify-between gap-3">
                        <h2 className="text-xl font-bold leading-tight text-[#123A7A] transition group-hover:text-[#C61F2A]">
                        {product.title}
                        </h2>
                        <p className="shrink-0 text-lg font-bold text-[#C61F2A]">
                          {formatCurrency(getDisplayPrice(product), product.currency)}
                        </p>
                      </div>
                    </Link>

                    <div className="mt-auto pt-5">
                      <StockStatusBadge status={stockStatus} compact className="mb-3 md:mb-4" />
                      <QuantityAddToCart
                        unitPrice={Number(product.price || 0)}
                        max={product.inventoryTracked ? Math.max(1, product.availableQty) : 99}
                        disabled={!stockStatus.canAdd}
                        onQuantityChange={(quantity) =>
                          handleQuantityChange(product.handle, quantity)
                        }
                        onAdd={(quantity) => addItem(product, quantity)}
                        productTitle={product.title}
                        buttonLabel={stockStatus.canAdd ? 'Add to Cart' : stockStatus.label}
                      />
                    </div>
                  </article>
                  )
                })}
              </div>
            )}
          </div>
        </section>
      </main>
    </ShopPageLayout>
  )
}
