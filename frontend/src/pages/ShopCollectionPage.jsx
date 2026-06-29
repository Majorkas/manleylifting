import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import QuantityAddToCart from '../components/QuantityAddToCart'
import ShopPageLayout from '../components/ShopPageLayout'
import { CollectionGridSkeleton } from '../components/ShopSkeleton'
import { useCart } from '../context/CartContext'
import {
  buildProductPath,
  formatCurrency,
  getCollectionByHandle,
  shopRoutes,
} from '../utils/shopConfig'

export default function ShopCollectionPage() {
  const { handle } = useParams()
  const { addItem } = useCart()
  const [collection, setCollection] = useState(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [quantityByHandle, setQuantityByHandle] = useState({})

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setErrorMessage('')

      try {
        const nextCollection = await getCollectionByHandle(handle)
        if (cancelled) return
        setCollection(nextCollection)
      } catch (error) {
        if (cancelled) return
        setErrorMessage(error.message || 'Could not load this collection.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [handle])

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
                {(collection?.products || []).map((product) => (
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

                      <h2 className="mt-5 text-xl font-bold text-[#123A7A] transition hover:text-[#C61F2A]">
                        {product.title}
                      </h2>
                      <p className="mt-2 text-lg font-semibold text-[#C61F2A]">
                        {formatCurrency(getDisplayPrice(product), product.currency)}
                      </p>
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
