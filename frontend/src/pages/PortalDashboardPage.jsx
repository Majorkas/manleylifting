import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import PortalLayout from '../components/PortalLayout'
import {
  clearPortalSession,
  createEquipmentReport,
  getEquipmentReports,
  getPortalCompanies,
  getPortalCompanyHeader,
  getPortalEquipment,
  getPortalMe,
  getReportRevisions,
  hasPortalSession,
  portalLogout,
  updateReport,
} from '../utils/portalApi'

function roleLabel(role) {
  if (role === 'owner') return 'Owner'
  if (role === 'staff') return 'Staff'
  return 'Customer'
}

export default function PortalDashboardPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const isAuthenticated = hasPortalSession()
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [profile, setProfile] = useState(null)
  const [companies, setCompanies] = useState([])
  const [company, setCompany] = useState(null)
  const [equipment, setEquipment] = useState([])
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [loggingOut, setLoggingOut] = useState(false)
  const [selectedEquipment, setSelectedEquipment] = useState(null)
  const [reports, setReports] = useState([])
  const [reportsLoading, setReportsLoading] = useState(false)
  const [reportError, setReportError] = useState('')
  const [creatingReport, setCreatingReport] = useState(false)
  const [savingReportEdit, setSavingReportEdit] = useState(false)
  const [editingReportId, setEditingReportId] = useState('')
  const [reportRevisions, setReportRevisions] = useState([])
  const [revisionsLoading, setRevisionsLoading] = useState(false)
  const [reportForm, setReportForm] = useState({
    title: '',
    summary: '',
    findings: '',
    recommendations: '',
    report_date: new Date().toISOString().slice(0, 10),
    status: 'submitted',
  })
  const selectedCompanyId = searchParams.get('companyId') || ''

  const canEditReports = useMemo(
    () => profile?.role === 'owner' || profile?.role === 'staff',
    [profile?.role],
  )
  const showsCustomerPicker = canEditReports && !selectedCompanyId
  const isOwner = profile?.role === 'owner'
  const activeSelectedEquipment = useMemo(() => {
    if (!selectedEquipment) return null
    return equipment.find((item) => String(item.id) === String(selectedEquipment.id)) || null
  }, [equipment, selectedEquipment])

  useEffect(() => {
    let cancelled = false

    async function loadReports() {
      if (!activeSelectedEquipment?.id) return

      setReportsLoading(true)
      setReportError('')
      try {
        const nextReports = await getEquipmentReports(activeSelectedEquipment.id)
        if (cancelled) return
        setReports(nextReports)
      } catch (error) {
        if (cancelled) return
        setReportError(String(error?.message || 'Unable to load reports for this equipment.'))
      } finally {
        if (!cancelled) setReportsLoading(false)
      }
    }

    loadReports()
    return () => {
      cancelled = true
    }
  }, [activeSelectedEquipment?.id])

  useEffect(() => {
    let cancelled = false

    async function loadPortalData() {
      setLoading(true)
      setErrorMessage('')

      try {
        const nextProfile = await getPortalMe()
        if (cancelled) return

        setProfile(nextProfile)
        const isStaffOrOwner = nextProfile.role === 'staff' || nextProfile.role === 'owner'

        let activeCompanyId = nextProfile.allowedCompanyIds[0] || ''

        if (isStaffOrOwner) {
          const nextCompanies = await getPortalCompanies()
          if (cancelled) return
          setCompanies(nextCompanies)

          if (selectedCompanyId) {
            activeCompanyId = selectedCompanyId
          } else {
            setCompany(null)
            setEquipment([])
            return
          }
        } else {
          setCompanies([])
        }

        if (!activeCompanyId) {
          setCompany(null)
          setEquipment([])
          return
        }

        const [nextCompany, nextEquipment] = await Promise.all([
          getPortalCompanyHeader(activeCompanyId),
          getPortalEquipment({ companyId: activeCompanyId, search: searchQuery }),
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
  }, [navigate, searchQuery, selectedCompanyId])

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

  async function handleCreateReport(event) {
    event.preventDefault()
    if (!activeSelectedEquipment?.id || creatingReport) return

    setCreatingReport(true)
    setReportError('')
    try {
      await createEquipmentReport(activeSelectedEquipment.id, reportForm)
      const refreshed = await getEquipmentReports(activeSelectedEquipment.id)
      setReports(refreshed)
      setReportForm((current) => ({ ...current, title: '', summary: '', findings: '', recommendations: '' }))
    } catch (error) {
      setReportError(String(error?.message || 'Unable to create report.'))
    } finally {
      setCreatingReport(false)
    }
  }

  async function handleOwnerEdit(reportId) {
    const report = reports.find((item) => String(item.id) === String(reportId))
    if (!report || savingReportEdit) return

    setSavingReportEdit(true)
    setReportError('')
    try {
      await updateReport(reportId, {
        title: report.title,
        summary: report.summary,
        findings: report.findings,
        recommendations: report.recommendations,
        report_date: report.report_date,
        status: report.status,
      })

      const [refreshedReports, revisions] = await Promise.all([
        getEquipmentReports(activeSelectedEquipment.id),
        getReportRevisions(reportId),
      ])
      setReports(refreshedReports)
      setReportRevisions(revisions)
      setEditingReportId(String(reportId))
    } catch (error) {
      setReportError(String(error?.message || 'Unable to save report changes.'))
    } finally {
      setSavingReportEdit(false)
    }
  }

  async function handleLoadRevisions(reportId) {
    if (!isOwner) return
    setRevisionsLoading(true)
    setReportError('')
    try {
      const revisions = await getReportRevisions(reportId)
      setReportRevisions(revisions)
      setEditingReportId(String(reportId))
    } catch (error) {
      setReportError(String(error?.message || 'Unable to load revision history.'))
    } finally {
      setRevisionsLoading(false)
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
            {showsCustomerPicker ? (
              <>
                <h1 className="mt-1 text-3xl font-extrabold text-[#123A7A] md:text-4xl">
                  Manley Lifting Customer Portal
                </h1>
                <p className="mt-2 text-slate-600">
                  Select a customer below to open their company profile.
                </p>
              </>
            ) : (
              <h1 className="mt-1 text-3xl font-extrabold text-[#123A7A] md:text-4xl">
                Equipment & Certification Hub
              </h1>
            )}
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

        {showsCustomerPicker && (
          <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-extrabold text-[#123A7A]">Customer List</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Open a customer to view company details, equipment, reports, and certificates.
                </p>
              </div>
              <span className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
                {companies.length} customer{companies.length === 1 ? '' : 's'}
              </span>
            </div>

            {loading ? (
              <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                Loading customers...
              </div>
            ) : companies.length === 0 ? (
              <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                No customer companies are assigned to this account.
              </div>
            ) : (
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {companies.map((item) => (
                  <article key={item.id} className="rounded-xl border border-slate-200 p-4">
                    <h3 className="text-lg font-bold text-[#123A7A]">{item.name}</h3>
                    <p className="mt-1 text-sm text-slate-600">{item.contact_email || 'No email provided'}</p>
                    <p className="mt-1 text-sm text-slate-600">{item.contact_phone || 'No phone provided'}</p>
                    <button
                      type="button"
                      onClick={() => setSearchParams({ companyId: String(item.id) })}
                      className="mt-4 rounded-md bg-[#123A7A] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f3168]"
                    >
                      Open Customer Profile
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {!showsCustomerPicker && canEditReports && (
          <div className="mt-6">
            <button
              type="button"
              onClick={() => {
                setSearchParams({})
                setSearchInput('')
                setSearchQuery('')
              }}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-[#123A7A] transition hover:border-[#123A7A]"
            >
              Back to Customer List
            </button>
          </div>
        )}

        {!showsCustomerPicker && company && (
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

        {!showsCustomerPicker && (
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
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedEquipment(item)
                              setEditingReportId('')
                              setReportRevisions([])
                            }}
                            className="rounded border border-[#123A7A] px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
                          >
                            {canEditReports ? 'Create & View' : 'View'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          </section>
        )}

        {!showsCustomerPicker && activeSelectedEquipment && (
          <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-extrabold text-[#123A7A]">
                  Reports for {activeSelectedEquipment.name}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Asset tag: {activeSelectedEquipment.asset_tag || '-'} | Serial: {activeSelectedEquipment.serial_number || '-'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedEquipment(null)
                  setReports([])
                  setEditingReportId('')
                  setReportRevisions([])
                }}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-[#123A7A] transition hover:border-[#123A7A]"
              >
                Close Reports
              </button>
            </div>

            {reportError && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {reportError}
              </div>
            )}

            {canEditReports && (
              <form className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4" onSubmit={handleCreateReport}>
                <h3 className="text-lg font-bold text-[#123A7A]">Create New Report</h3>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <label className="text-sm font-semibold text-slate-700">
                    Report Title
                    <input
                      type="text"
                      value={reportForm.title}
                      onChange={(event) => setReportForm((current) => ({ ...current, title: event.target.value }))}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      required
                    />
                  </label>
                  <label className="text-sm font-semibold text-slate-700">
                    Report Date
                    <input
                      type="date"
                      value={reportForm.report_date}
                      onChange={(event) =>
                        setReportForm((current) => ({ ...current, report_date: event.target.value }))
                      }
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      required
                    />
                  </label>
                  <label className="text-sm font-semibold text-slate-700 md:col-span-2">
                    Summary
                    <textarea
                      value={reportForm.summary}
                      onChange={(event) =>
                        setReportForm((current) => ({ ...current, summary: event.target.value }))
                      }
                      className="mt-1 min-h-20 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="text-sm font-semibold text-slate-700">
                    Findings
                    <textarea
                      value={reportForm.findings}
                      onChange={(event) =>
                        setReportForm((current) => ({ ...current, findings: event.target.value }))
                      }
                      className="mt-1 min-h-20 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="text-sm font-semibold text-slate-700">
                    Recommendations
                    <textarea
                      value={reportForm.recommendations}
                      onChange={(event) =>
                        setReportForm((current) => ({ ...current, recommendations: event.target.value }))
                      }
                      className="mt-1 min-h-20 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="text-sm font-semibold text-slate-700 md:max-w-xs">
                    Status
                    <select
                      value={reportForm.status}
                      onChange={(event) =>
                        setReportForm((current) => ({ ...current, status: event.target.value }))
                      }
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="draft">Draft</option>
                      <option value="submitted">Submitted</option>
                      <option value="final">Final</option>
                    </select>
                  </label>
                </div>
                <button
                  type="submit"
                  disabled={creatingReport}
                  className="mt-4 rounded-md bg-[#123A7A] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f3168] disabled:opacity-70"
                >
                  {creatingReport ? 'Creating...' : 'Create Report'}
                </button>
              </form>
            )}

            <div className="mt-6 overflow-hidden rounded-xl border border-slate-200">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] border-collapse text-left text-sm">
                  <thead className="bg-[#123A7A] text-white">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Title</th>
                      <th className="px-4 py-3 font-semibold">Date</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold">Inspector</th>
                      <th className="px-4 py-3 font-semibold">Summary</th>
                      <th className="px-4 py-3 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportsLoading ? (
                      <tr>
                        <td className="px-4 py-4 text-slate-500" colSpan={6}>
                          Loading reports...
                        </td>
                      </tr>
                    ) : reports.length === 0 ? (
                      <tr>
                        <td className="px-4 py-4 text-slate-500" colSpan={6}>
                          No reports have been submitted for this equipment.
                        </td>
                      </tr>
                    ) : (
                      reports.map((report) => (
                        <tr key={report.id} className="border-t border-slate-200 odd:bg-white even:bg-slate-50/60">
                          <td className="px-4 py-3 font-semibold text-slate-800">
                            {isOwner && editingReportId === String(report.id) ? (
                              <input
                                type="text"
                                value={report.title || ''}
                                onChange={(event) =>
                                  setReports((current) =>
                                    current.map((item) =>
                                      item.id === report.id ? { ...item, title: event.target.value } : item,
                                    ),
                                  )
                                }
                                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                              />
                            ) : (
                              report.title
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-700">{report.report_date}</td>
                          <td className="px-4 py-3 text-slate-700">{report.status}</td>
                          <td className="px-4 py-3 text-slate-700">{report.submitted_by_name || '-'}</td>
                          <td className="px-4 py-3 text-slate-700">{report.summary || '-'}</td>
                          <td className="px-4 py-3 text-slate-700">
                            <div className="flex gap-2">
                              {isOwner && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => setEditingReportId(String(report.id))}
                                    className="rounded border border-[#123A7A] px-2 py-1 text-xs font-semibold text-[#123A7A]"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleOwnerEdit(report.id)}
                                    disabled={savingReportEdit}
                                    className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700"
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleLoadRevisions(report.id)}
                                    className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700"
                                  >
                                    Revisions
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {isOwner && editingReportId && (
              <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-lg font-bold text-[#123A7A]">Revision History</h3>
                {revisionsLoading ? (
                  <p className="mt-2 text-sm text-slate-500">Loading revisions...</p>
                ) : reportRevisions.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">No revisions recorded yet for this report.</p>
                ) : (
                  <ul className="mt-3 space-y-2 text-sm text-slate-700">
                    {reportRevisions.map((revision) => (
                      <li key={revision.id} className="rounded border border-slate-200 bg-white p-3">
                        <p className="font-semibold">
                          {revision.edited_by_name || 'Unknown user'} at {revision.changed_at}
                        </p>
                        <p className="mt-1 text-slate-600">
                          Previous title: {revision.previous_data?.title || '-'} | Status:{' '}
                          {revision.previous_data?.status || '-'}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        )}
      </section>
    </PortalLayout>
  )
}
