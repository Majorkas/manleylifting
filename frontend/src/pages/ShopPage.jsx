import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import QuantityAddToCart from '../components/QuantityAddToCart'
import ShopPageLayout from '../components/ShopPageLayout'
import { CollectionGridSkeleton, ProductGridSkeleton } from '../components/ShopSkeleton'
import { useCart } from '../context/CartContext'
import {
  buildCollectionPath,
  buildProductPath,
  formatCurrency,
  getFeaturedCollections,
  getFeaturedProducts,
  shopRoutes,
} from '../utils/shopConfig'

export default function ShopPage() {
  const { addItem } = useCart()
  const [collections, setCollections] = useState([])
  const [featuredProducts, setFeaturedProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [quantityByHandle, setQuantityByHandle] = useState({})

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setErrorMessage('')

      try {
        const [nextCollections, nextProducts] = await Promise.all([
          getFeaturedCollections(),
          getFeaturedProducts(),
        ])
        if (cancelled) return
        setCollections(nextCollections)
        setFeaturedProducts(nextProducts)
      } catch (error) {
        if (cancelled) return
        setErrorMessage(error.message || 'Could not load shop data right now.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

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
          <div className="mx-auto w-full max-w-7xl px-6 py-16 md:py-20">
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#C61F2A]">Shop</p>
            <h1 className="mt-2 text-4xl font-extrabold text-[#123A7A] md:text-5xl">
              Shop lifting equipment and accessories
            </h1>
            <p className="mt-4 max-w-3xl text-slate-600">
              Product and collection data now comes directly from Shopify via your backend API.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
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
                    className="rounded-xl border border-slate-200 p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
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
                {featuredProducts.map((product) => (
                  <article
                    key={product.handle}
                    className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <Link
                      to={buildProductPath(product.handle)}
                      className="block cursor-pointer"
                      aria-label={'View ' + product.title}
                    >
                      {product.imageUrl ? (
                        <img
                          src={product.imageUrl}
                          alt={product.imageAlt || product.title}
                          className="aspect-[4/3] w-full rounded-lg object-cover"
                        />
                      ) : (
                        <div className="aspect-[4/3] rounded-lg bg-slate-100" />
                      )}

                      <h3 className="mt-5 text-xl font-bold text-[#123A7A] transition hover:text-[#C61F2A]">
                        {product.title}
                      </h3>
                      <p className="mt-2 text-lg font-semibold text-[#C61F2A]">
                        {formatCurrency(getDisplayPrice(product), product.currency)}
                      </p>
                      <p className="mt-3 text-slate-600">{product.description || ' '}</p>
                    </Link>

                    <div className="mt-6 flex items-center gap-3">
                      <QuantityAddToCart
                        unitPrice={Number(product.price || 0)}
                        onQuantityChange={(quantity) =>
                          handleQuantityChange(product.handle, quantity)
                        }
                        onAdd={(quantity) => addItem(product, quantity)}
                        buttonLabel="Add to Cart"
                      />
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
    </ShopPageLayout>
  )
}
