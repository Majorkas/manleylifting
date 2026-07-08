import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import QuantityAddToCart from '../components/QuantityAddToCart'
import ShopPageLayout from '../components/ShopPageLayout'
import { ProductDetailSkeleton } from '../components/ShopSkeleton'
import { useCart } from '../context/CartContext'
import { formatCurrency, getProductByHandle, getUserFacingErrorMessage, shopRoutes } from '../utils/shopConfig'
import usePageMeta from '../utils/usePageMeta'

export default function ShopProductPage() {
  const { handle } = useParams()
  const { addItem } = useCart()
  const [product, setProduct] = useState(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [quantity, setQuantity] = useState(1)

  usePageMeta({
    title: product?.title || 'Shop Product',
    description:
      product?.description ||
      'View certified lifting product details, pricing, and purchasing options from Manley Lifting.',
  })

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setErrorMessage('')

      try {
        const nextProduct = await getProductByHandle(handle)
        if (cancelled) return
        setProduct(nextProduct)
      } catch (error) {
        if (cancelled) return
        console.error('Failed to load product page', {
          handle,
          error,
        })
        setErrorMessage(
          getUserFacingErrorMessage(
            error,
            'We could not load this product right now. Please try again in a moment.',
          ),
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [handle])

  const basePrice = Number(product?.price || 0)
  const displayPrice = useMemo(() => basePrice * quantity, [basePrice, quantity])

  return (
    <ShopPageLayout>
      <main className="mx-auto w-full max-w-7xl px-6 py-16">
        {errorMessage && (
          <div className="mb-8 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {errorMessage}
          </div>
        )}

        {loading ? (
          <ProductDetailSkeleton />
        ) : (
          <>
            <div className="mb-6">
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

            <div className="grid gap-10 md:grid-cols-2 md:items-start">
              <div>
                {product?.imageUrl ? (
                  <img
                    src={product.imageUrl}
                    alt={product.imageAlt || product.title}
                    className="mx-auto max-h-[70vh] w-full rounded-2xl border border-slate-200 object-contain bg-white"
                  />
                ) : (
                  <div className="mx-auto aspect-[4/3] max-h-[70vh] w-full rounded-2xl border border-slate-200 bg-slate-100" />
                )}
              </div>

              <div className="md:pt-2">
                <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#C61F2A]">
                  Product
                </p>
                <h1 className="mt-2 text-4xl font-extrabold text-[#123A7A] md:text-5xl">
                  {product?.title || 'Product'}
                </h1>
                <p className="mt-4 text-2xl font-bold text-[#C61F2A]">
                  {formatCurrency(displayPrice, product?.currency)}
                </p>
                <p className="mt-6 max-w-2xl text-slate-600">{product?.description || ' '}</p>

                <div className="mt-8">
                  <QuantityAddToCart
                    unitPrice={basePrice}
                    onQuantityChange={setQuantity}
                    onAdd={(selectedQuantity) => addItem(product, selectedQuantity)}
                    buttonLabel="Add to Cart"
                  />
                </div>


              </div>
            </div>
          </>
        )}
      </main>
    </ShopPageLayout>
  )
}
