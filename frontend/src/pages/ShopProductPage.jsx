import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import QuantityAddToCart from '../components/QuantityAddToCart'
import ShopPageLayout from '../components/ShopPageLayout'
import { ProductDetailSkeleton } from '../components/ShopSkeleton'
import { useCart } from '../context/CartContext'
import { useProductQuery } from '../hooks/useCatalogQueries'
import StockStatusBadge from '../components/StockStatusBadge'
import { formatCurrency, getStockStatus, getUserFacingErrorMessage, shopRoutes } from '../utils/shopConfig'
import usePageMeta from '../utils/usePageMeta'

export default function ShopProductPage() {
  const { handle } = useParams()
  const { addItem } = useCart()
  const productQuery = useProductQuery(handle)
  const product = productQuery.data
  const loading = productQuery.isPending
  const errorMessage = productQuery.error
    ? getUserFacingErrorMessage(productQuery.error, 'We could not load this product right now. Please try again in a moment.')
    : ''
  const [quantity, setQuantity] = useState(1)
  const [activeImageIndex, setActiveImageIndex] = useState(0)

  const galleryImages = useMemo(() => {
    const images = Array.isArray(product?.images) ? product.images.filter((image) => image?.url) : []
    return images.length > 0
      ? images
      : product?.imageUrl
        ? [{ url: product.imageUrl, alt: product.imageAlt || product.title }]
        : []
  }, [product])

  useEffect(() => {
    setActiveImageIndex(0)
  }, [product?.handle])

  usePageMeta({
    title: product?.title || 'Shop Product',
    description:
      product?.description ||
      'View certified lifting product details, pricing, and purchasing options from Manley Lifting.',
  })

  const basePrice = Number(product?.price || 0)
  const displayPrice = useMemo(() => basePrice * quantity, [basePrice, quantity])
  const stockStatus = getStockStatus(product)

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

            <div className="grid gap-8 md:grid-cols-[1.1fr_0.9fr] md:items-start lg:gap-14">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-6">
                {galleryImages.length > 0 ? (
                  <div>
                    <div className="relative flex min-h-[24rem] items-center justify-center">
                      <img
                        src={galleryImages[activeImageIndex]?.url}
                        alt={galleryImages[activeImageIndex]?.alt || product.title}
                        fetchPriority="high"
                        decoding="async"
                        className="mx-auto max-h-[70vh] w-full rounded-xl object-contain mix-blend-multiply"
                      />
                      {galleryImages.length > 1 && (
                        <>
                          <button
                            type="button"
                            aria-label="Previous product image"
                            title="Previous product image"
                            onClick={() => setActiveImageIndex((current) => (current - 1 + galleryImages.length) % galleryImages.length)}
                            className="absolute left-2 top-1/2 inline-flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#123A7A] shadow-md transition hover:bg-white"
                          >
                            <ChevronLeft size={22} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            aria-label="Next product image"
                            title="Next product image"
                            onClick={() => setActiveImageIndex((current) => (current + 1) % galleryImages.length)}
                            className="absolute right-2 top-1/2 inline-flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#123A7A] shadow-md transition hover:bg-white"
                          >
                            <ChevronRight size={22} aria-hidden="true" />
                          </button>
                        </>
                      )}
                    </div>
                    {galleryImages.length > 1 && (
                      <div className="mt-4 flex gap-3 overflow-x-auto pb-1" aria-label="Product image thumbnails">
                        {galleryImages.map((image, index) => (
                          <button
                            type="button"
                            key={`${image.url}-${index}`}
                            aria-label={`Show product image ${index + 1}`}
                            aria-pressed={index === activeImageIndex}
                            onClick={() => setActiveImageIndex(index)}
                            className={`h-16 w-16 shrink-0 overflow-hidden rounded-md border-2 bg-white ${index === activeImageIndex ? 'border-[#C61F2A]' : 'border-transparent'}`}
                          >
                            <img src={image.url} alt="" className="h-full w-full object-cover" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mx-auto aspect-[4/3] max-h-[70vh] w-full rounded-2xl border border-slate-200 bg-slate-100" />
                )}
              </div>

              <div className="md:pt-3">
                <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#C61F2A]">
                  Product
                </p>
                <h1 className="mt-2 max-w-xl text-4xl font-extrabold leading-tight text-[#123A7A] md:text-5xl">
                  {product?.title || 'Product'}
                </h1>
                <p className="mt-5 text-3xl font-bold text-[#C61F2A]">
                  {formatCurrency(displayPrice, product?.currency)}
                </p>
                <p className="mt-5 max-w-2xl leading-relaxed text-slate-600">
                  {product?.description || 'Product details available on request.'}
                </p>

                <div className="mt-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <StockStatusBadge status={stockStatus} />
                  {stockStatus.canAdd && (
                    <p className="mt-3 text-sm text-slate-600">
                      {product.inventoryTracked
                        ? `Choose up to ${Math.max(1, product.availableQty)} units.`
                        : 'Quantity is confirmed when your order is prepared.'}
                    </p>
                  )}
                  <QuantityAddToCart
                    unitPrice={basePrice}
                    max={product.inventoryTracked ? Math.max(1, product.availableQty) : 99}
                    disabled={!stockStatus.canAdd}
                    onQuantityChange={setQuantity}
                    onAdd={(selectedQuantity) => addItem(product, selectedQuantity)}
                    productTitle={product.title}
                    buttonLabel={stockStatus.canAdd ? 'Add to Cart' : stockStatus.label}
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
