import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import PortalCatalogManagementPanel from '../components/PortalCatalogManagementPanel'
import PortalLayout from '../components/PortalLayout'
import { getPortalMe } from '../utils/portalApi'
import usePageMeta from '../utils/usePageMeta'

const CATALOG_MANAGER_ROLES = new Set(['owner', 'office_staff'])

export default function ShopManagementPage() {
  usePageMeta({ title: 'Shop Management', description: 'Manage products and inventory for the Manley Lifting shop.', noIndex: true })
  const navigate = useNavigate()
  const [profile, setProfile] = useState(null)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadProfile() {
      try {
        const nextProfile = await getPortalMe()
        if (cancelled) return
        if (!CATALOG_MANAGER_ROLES.has(nextProfile?.role)) {
          navigate('/portal', { replace: true })
          return
        }
        setProfile(nextProfile)
      } catch (error) {
        if (cancelled) return
        if (Number(error?.status || 0) === 401) {
          navigate('/account/login?redirect=/shop/shop-management', { replace: true })
          return
        }
        setErrorMessage(String(error?.message || 'Shop management could not be loaded.'))
      }
    }

    void loadProfile()
    return () => {
      cancelled = true
    }
  }, [navigate])

  return (
    <PortalLayout>
      <div className="mx-auto w-full max-w-7xl px-6 pb-16">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-6">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#C61F2A]">Store operations</p>
            <h1 className="mt-1 text-3xl font-extrabold text-[#123A7A]">Shop management</h1>
            <p className="mt-2 text-sm text-slate-600">Create, update, publish, archive, and adjust stock for store products.</p>
          </div>
          <Link to="/account" className="min-h-11 rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-[#123A7A] hover:bg-slate-50">
            Back to profile
          </Link>
        </div>
        {errorMessage && <div role="alert" className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div>}
        {!profile && !errorMessage && <p className="mt-6 text-sm text-slate-600" role="status">Loading shop management...</p>}
        {profile && <PortalCatalogManagementPanel />}
      </div>
    </PortalLayout>
  )
}
