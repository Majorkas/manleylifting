import { Link } from 'react-router-dom'
import ShopPageLayout from '../components/ShopPageLayout'
import usePageMeta from '../utils/usePageMeta'
import { shopRoutes } from '../utils/shopConfig'

export default function NotFoundPage() {
  usePageMeta({
    title: 'Page Not Found',
    description: 'The page you requested could not be found.',
    noIndex: true,
  })

  return (
    <ShopPageLayout>
      <main className="mx-auto w-full max-w-3xl px-6 py-16">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm md:p-12">
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#C61F2A]">404</p>
          <h1 className="mt-3 text-4xl font-extrabold text-[#123A7A] md:text-5xl">Page not found</h1>
          <p className="mt-4 text-slate-600">
            The page you are looking for does not exist or may have moved.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              to={shopRoutes.home}
              className="rounded-md bg-[#123A7A] px-6 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-[#0f3168]"
            >
              Go to homepage
            </Link>
            <Link
              to={shopRoutes.shop}
              className="rounded-md border-2 border-[#123A7A] px-6 py-3 text-sm font-bold uppercase tracking-wide text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
            >
              Visit the shop
            </Link>
          </div>
        </div>
      </main>
    </ShopPageLayout>
  )
}
