import { useState } from 'react'
import { Link } from 'react-router-dom'
import QuantityAddToCart from '../components/QuantityAddToCart'
import ShopPageLayout from '../components/ShopPageLayout'
import { CollectionGridSkeleton, ProductGridSkeleton } from '../components/ShopSkeleton'
import { useCart } from '../context/CartContext'
import { useFeaturedCollectionsQuery, useFeaturedProductsQuery } from '../hooks/useCatalogQueries'
import StockStatusBadge from '../components/StockStatusBadge'
import {
  buildCollectionPath,
  buildProductPath,
  formatCurrency,
  getUserFacingErrorMessage,
  getStockStatus,
  shopRoutes,
} from '../utils/shopConfig'
import usePageMeta from '../utils/usePageMeta'

export default function ShopPage() {
  usePageMeta({
    title: 'Shop',
    description:
      'Browse certified lifting equipment, accessories, and products from Manley Lifting.',
  })

  const { addItem } = useCart()
  const collectionsQuery = useFeaturedCollectionsQuery()
  const productsQuery = useFeaturedProductsQuery()
  const collections = collectionsQuery.data || []
  const featuredProducts = productsQuery.data || []
  const loading = collectionsQuery.isPending || productsQuery.isPending
  const errorMessage = collectionsQuery.error || productsQuery.error
    ? getUserFacingErrorMessage(
      collectionsQuery.error || productsQuery.error,
      'We could not load shop data right now. Please try again in a moment.',
    )
    : ''
  const [quantityByHandle, setQuantityByHandle] = useState({})

  function getDisplayPrice(product) {
    const unitPrice = Number(product?.price || 0)
    const quantity = quantityByHandle[product.handle] || 1
    return unitPrice * quantity
  }

  function handleQuantityChange(handle, quantity) {
    setQuantityByHandle((current) => {
      if (current[handle] === quantity) return current
      return {
        ...current,
        [handle]: quantity,
      }
    })
  }

  return (
    <ShopPageLayout>
      <main>
        <section className="border-b border-slate-200 bg-[#f8fafc]">
          <div className="mx-auto grid w-full max-w-7xl gap-10 px-6 py-12 md:grid-cols-[1.2fr_0.8fr] md:items-end md:py-16">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#C61F2A]">Shop</p>
              <h1 className="mt-2 max-w-3xl text-4xl font-extrabold leading-tight text-[#123A7A] md:text-5xl">
                Shop lifting equipment and accessories
              </h1>
              <p className="mt-4 max-w-2xl text-slate-600">
                Practical equipment, inspection essentials, and lifting accessories with availability shown before you add to cart.
              </p>
              <div className="mt-7 flex flex-wrap gap-4">
                <a
                  href="#featured-products"
                  className="rounded-md bg-[#123A7A] px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-[#0f3168]"
                >
                  Browse Products
                </a>
                <Link
                  to={shopRoutes.cart}
                  className="rounded-md border-2 border-[#123A7A] px-6 py-3 text-sm font-bold uppercase tracking-wide text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
                >
                  Open Cart
                </Link>
              </div>
            </div>

            <aside className="grid grid-cols-3 gap-2 border-t border-slate-300 pt-4 text-xs font-semibold text-slate-700 md:grid-cols-1 md:gap-0 md:border-t-0 md:border-l md:pl-8 md:pt-0">
              <div className="border-slate-200 md:border-b md:py-3 md:first:pt-0">
                <span className="block text-[#C61F2A]">Availability</span>
                Stock status shown on every product
              </div>
              <div className="border-slate-200 md:border-b md:py-3">
                <span className="block text-[#C61F2A]">Pricing</span>
                EUR pricing with quantity controls
              </div>
              <div className="md:py-3 md:pb-0">
                <span className="block text-[#C61F2A]">Checkout</span>
                Secure checkout when you are ready
              </div>
            </aside>
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

        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto w-full max-w-7xl px-6 py-16">
            <div className="mb-10">
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#C61F2A]">
                Collections
              </p>
              <h2 className="mt-2 text-3xl font-extrabold text-[#123A7A] md:text-4xl">
                Explore store collections
              </h2>
            </div>

            {loading ? (
              <CollectionGridSkeleton count={3} />
            ) : (
              <div className="grid gap-6 md:grid-cols-3">
                {collections.map((collection) => (
                  <article
                    key={collection.handle}
                    className="group rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-[#123A7A] hover:shadow-md"
                  >
                    <Link
                      to={buildCollectionPath(collection.handle)}
                      className="block cursor-pointer"
                      aria-label={'View ' + collection.title}
                    >
                      <h3 className="text-xl font-bold text-[#123A7A] transition hover:text-[#C61F2A]">
                        {collection.title}
                      </h3>
                      <p className="mt-3 text-slate-600">{collection.description || ' '}</p>
                    </Link>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>

        <section id="featured-products" className="bg-[#f8fafc]">
          <div className="mx-auto w-full max-w-7xl px-6 py-16">
            <div className="mb-10">
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#C61F2A]">
                Featured Products
              </p>
              <h2 className="mt-2 text-3xl font-extrabold text-[#123A7A] md:text-4xl">
                Popular items to get started
              </h2>
            </div>

            {loading ? (
              <ProductGridSkeleton count={3} />
            ) : (
              <div className="grid gap-6 md:grid-cols-3">
                {featuredProducts.map((product) => {
                  const stockStatus = getStockStatus(product)

                  return (
                  <article
                    key={product.handle}
                    className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-[#123A7A] hover:shadow-md sm:p-5"
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
                        <h3 className="text-xl font-bold leading-tight text-[#123A7A] transition group-hover:text-[#C61F2A]">
                        {product.title}
                        </h3>
                        <p className="shrink-0 text-lg font-bold text-[#C61F2A]">
                          {formatCurrency(getDisplayPrice(product), product.currency)}
                        </p>
                      </div>
                      <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-slate-600">
                        {product.description || 'Product details available on the item page.'}
                      </p>
                    </Link>

                    <div className="mt-auto pt-5">
                      <StockStatusBadge status={stockStatus} compact />
                      <QuantityAddToCart
                        unitPrice={Number(product.price || 0)}
                        max={product.inventoryTracked ? Math.max(1, product.availableQty) : 99}
                        disabled={!stockStatus.canAdd}
                        onQuantityChange={(quantity) =>
                          handleQuantityChange(product.handle, quantity)
                        }
                        onAdd={(quantity) => addItem(product, quantity)}
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
