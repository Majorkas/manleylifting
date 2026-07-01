import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import PortalLayout from '../components/PortalLayout'
import {
  clearPortalSession,
  getPortalCompanyHeader,
  getPortalEquipment,
  getPortalMe,
  hasPortalSession,
  portalLogout,
} from '../utils/portalApi'

function roleLabel(role) {
  if (role === 'owner') return 'Owner'
  if (role === 'staff') return 'Staff'
  return 'Customer'
}

export default function PortalDashboardPage() {
  const navigate = useNavigate()
  const isAuthenticated = hasPortalSession()
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [profile, setProfile] = useState(null)
  const [company, setCompany] = useState(null)
  const [equipment, setEquipment] = useState([])
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [loggingOut, setLoggingOut] = useState(false)

  const canEditReports = useMemo(
    () => profile?.role === 'owner' || profile?.role === 'staff',
    [profile?.role],
  )

  useEffect(() => {
    let cancelled = false

    async function loadPortalData() {
      setLoading(true)
      setErrorMessage('')

      try {
        const nextProfile = await getPortalMe()
        if (cancelled) return

        setProfile(nextProfile)
        const selectedCompanyId = nextProfile.allowedCompanyIds[0] || ''

        const [nextCompany, nextEquipment] = await Promise.all([
          getPortalCompanyHeader(selectedCompanyId),
          getPortalEquipment({ companyId: selectedCompanyId, search: searchQuery }),
        ])
        if (cancelled) return

        setCompany(nextCompany)
        setEquipment(nextEquipment)
      } catch (error) {
        if (cancelled) return

        if (Number(error?.status || 0) === 401) {
          clearPortalSession()
          navigate('/portal/login', { replace: true })
          return
        }

        setErrorMessage(String(error?.message || 'Unable to load portal data right now.'))
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadPortalData()
    return () => {
      cancelled = true
    }
  }, [navigate, searchQuery])

  async function handleLogout() {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await portalLogout()
    } finally {
      navigate('/portal/login', { replace: true })
      setLoggingOut(false)
    }
  }

  if (!isAuthenticated) {
    return <Navigate to="/portal/login" replace />
  }

  return (
    <PortalLayout>
      <section className="mx-auto w-full max-w-7xl px-6 py-10 md:py-12">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#C61F2A]">Portal</p>
            <h1 className="mt-1 text-3xl font-extrabold text-[#123A7A] md:text-4xl">
              Equipment & Certification Hub
            </h1>
          </div>

          {profile && (
            <div className="flex items-center gap-3">
              <span className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
                {roleLabel(profile.role)}
              </span>
              <button
                type="button"
                onClick={handleLogout}
                disabled={loggingOut}
                className="rounded-md border-2 border-[#123A7A] px-4 py-2 text-sm font-bold uppercase tracking-wide text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white disabled:cursor-not-allowed disabled:opacity-70"
              >
                {loggingOut ? 'Signing Out...' : 'Sign Out'}
              </button>
            </div>
          )}
        </div>

        {errorMessage && (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMessage}
          </div>
        )}

        {company && (
          <article className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start gap-5">
              <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                {company.logo ? (
                  <img
                    src={company.logo}
                    alt={company.name + ' logo'}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <span className="text-xl font-extrabold text-[#123A7A]">
                    {(company.name || '?').slice(0, 1).toUpperCase()}
                  </span>
                )}
              </div>

              <div className="min-w-[240px] flex-1">
                <h2 className="text-2xl font-extrabold text-[#123A7A]">{company.name}</h2>
                <p className="mt-1 text-sm text-slate-500">Company profile</p>
                <div className="mt-3 grid gap-2 text-sm text-slate-600 md:grid-cols-2">
                  <p>
                    <span className="font-semibold text-slate-700">Email:</span>{' '}
                    {company.contact_email || 'Not provided'}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-700">Phone:</span>{' '}
                    {company.contact_phone || 'Not provided'}
                  </p>
                  <p className="md:col-span-2">
                    <span className="font-semibold text-slate-700">Address:</span>{' '}
                    {company.address || 'Not provided'}
                  </p>
                </div>
              </div>
            </div>
          </article>
        )}

        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-2xl font-extrabold text-[#123A7A]">Managed Equipment</h2>
              <p className="mt-1 text-sm text-slate-600">
                View inspection-ready assets and reporting status at any time.
              </p>
            </div>

            <form
              className="flex w-full max-w-sm gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                setSearchQuery(searchInput.trim())
              }}
            >
              <input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search by name, asset tag, serial"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-[#123A7A]"
              />
              <button
                type="submit"
                className="rounded-md bg-[#123A7A] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f3168]"
              >
                Search
              </button>
            </form>
          </div>

          {loading ? (
            <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              Loading equipment...
            </div>
          ) : equipment.length === 0 ? (
            <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              No equipment found for this company.
            </div>
          ) : (
            <div className="mt-6 overflow-hidden rounded-xl border border-slate-200">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[920px] border-collapse text-left text-sm">
                  <thead className="bg-[#123A7A] text-white">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Name</th>
                      <th className="px-4 py-3 font-semibold">Asset Tag</th>
                      <th className="px-4 py-3 font-semibold">Serial</th>
                      <th className="px-4 py-3 font-semibold">Location</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold">Next Due</th>
                      <th className="px-4 py-3 font-semibold">Reports</th>
                    </tr>
                  </thead>
                  <tbody>
                    {equipment.map((item) => (
                      <tr key={item.id} className="border-t border-slate-200 odd:bg-white even:bg-slate-50/60">
                        <td className="px-4 py-3 font-semibold text-slate-800">{item.name}</td>
                        <td className="px-4 py-3 text-slate-700">{item.asset_tag || '-'}</td>
                        <td className="px-4 py-3 text-slate-700">{item.serial_number || '-'}</td>
                        <td className="px-4 py-3 text-slate-700">{item.location || '-'}</td>
                        <td className="px-4 py-3">
                          <span className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
                            {item.status || 'unknown'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-700">{item.next_inspection_due || '-'}</td>
                        <td className="px-4 py-3 text-slate-700">
                          {canEditReports ? 'Create & View' : 'View'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </section>
    </PortalLayout>
  )
}
