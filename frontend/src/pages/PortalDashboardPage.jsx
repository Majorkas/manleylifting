import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import PortalLayout from '../components/PortalLayout'
import {
  createStaffAssignment,
  deleteStaffAssignment,
  createPortalCustomer,
  createPortalEquipment,
  clearPortalSession,
  createEquipmentReport,
  getEquipmentReports,
  getPortalCompanies,
  getPortalCompanyHeader,
  getPortalEquipment,
  getPortalMe,
  getPendingReportApprovals,
  getReportRevisions,
  getStaffAssignments,
  hasPortalSession,
  portalLogout,
  updateStaffAssignment,
  updateReport,
  updatePortalEquipment,
} from '../utils/portalApi'

function formatRevisionDateTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value || '-')

  return new Intl.DateTimeFormat('en-IE', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function getInspectionDueSortValue(value) {
  if (!value) return Number.POSITIVE_INFINITY

  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed
}

function calculateNextInspectionDue(lastInspectedAt, inspectionIntervalDays) {
  if (!lastInspectedAt) return ''

  const intervalDays = Number(inspectionIntervalDays)
  if (!Number.isFinite(intervalDays) || intervalDays < 1) return ''

  const date = new Date(`${lastInspectedAt}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return ''

  date.setUTCDate(date.getUTCDate() + intervalDays)
  return date.toISOString().slice(0, 10)
}

function getInspectionStatusBadge(nextInspectionDue) {
  if (!nextInspectionDue) {
    return { label: 'No Date', color: 'bg-slate-100 text-slate-700 border-slate-300' }
  }

  const dueDate = new Date(nextInspectionDue)
  if (Number.isNaN(dueDate.getTime())) {
    return { label: 'Invalid Date', color: 'bg-slate-100 text-slate-700 border-slate-300' }
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const daysUntilDue = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24))

  if (daysUntilDue <= 0) {
    return { label: 'Overdue', color: 'bg-red-100 text-red-700 border-red-300' }
  } else if (daysUntilDue <= 20) {
    return { label: 'Inspection Due', color: 'bg-amber-100 text-amber-700 border-amber-300' }
  } else {
    return { label: 'On Schedule', color: 'bg-emerald-100 text-emerald-700 border-emerald-300' }
  }
}

function getReportStatusBadge(status) {
  const normalized = String(status || '').trim().toLowerCase()

  if (normalized === 'draft') {
    return { label: 'Draft', color: 'bg-blue-100 text-blue-700 border-blue-300' }
  }

  if (normalized === 'submitted') {
    return { label: 'Submitted', color: 'bg-yellow-100 text-yellow-700 border-yellow-300' }
  }

  if (normalized === 'approved') {
    return { label: 'Approved', color: 'bg-emerald-100 text-emerald-700 border-emerald-300' }
  }

  const fallbackLabel = normalized
    ? normalized
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase())
    : 'Unknown'

  return { label: fallbackLabel, color: 'bg-slate-100 text-slate-700 border-slate-300' }
}

function buildEmptyReportForm() {
  return {
    reportId: '',
    title: '',
    summary: '',
    findings: '',
    recommendations: '',
    report_date: new Date().toISOString().slice(0, 10),
    status: 'draft',
    images: [],
    existingImages: [],
    removedImageIds: [],
  }
}

function buildEmptyCustomerForm() {
  return {
    company_name: '',
    company_contact_email: '',
    company_contact_phone: '',
    company_address: '',
    customer_username: '',
    customer_email: '',
    customer_password: '',
    customer_first_name: '',
    customer_last_name: '',
  }
}

function buildEmptyEquipmentForm() {
  return {
    name: '',
    asset_tag: '',
    serial_number: '',
    location: '',
    status: 'active',
    inspection_interval_days: 365,
    last_inspected_at: '',
    notes: '',
  }
}

function buildEmptyEmployeeForm() {
  return {
    email: '',
    password: '',
    first_name: '',
    last_name: '',
    role: 'engineer',
    allowed_company_ids: [],
  }
}

function buildEmployeeUsername(firstName, lastName) {
  const first = String(firstName || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
  const last = String(lastName || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!first || !last) return ''

  return `${first.slice(0, 1)}_${last.slice(0, 4)}`
}

function buildUniqueEmployeeUsername(baseUsername, existingUsernames) {
  const base = String(baseUsername || '').trim().toLowerCase()
  if (!base) return ''

  const taken = new Set(
    Array.isArray(existingUsernames)
      ? existingUsernames
          .map((value) => String(value || '').trim().toLowerCase())
          .filter(Boolean)
      : [],
  )

  if (!taken.has(base)) return base

  let suffix = 2
  let candidate = `${base}${suffix}`
  while (taken.has(candidate)) {
    suffix += 1
    candidate = `${base}${suffix}`
  }

  return candidate
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
  const [approvingReport, setApprovingReport] = useState(false)
  const [revisionReportId, setRevisionReportId] = useState('')
  const [reportRevisions, setReportRevisions] = useState([])
  const [revisionsLoading, setRevisionsLoading] = useState(false)
  const [pendingReportApprovals, setPendingReportApprovals] = useState([])
  const [pendingApprovalsLoading, setPendingApprovalsLoading] = useState(false)
  const [pendingApprovalsError, setPendingApprovalsError] = useState('')
  const [viewedReport, setViewedReport] = useState(null)
  const [selectedReportImage, setSelectedReportImage] = useState(null)
  const [showEditReportModal, setShowEditReportModal] = useState(false)
  const [showRevisionsModal, setShowRevisionsModal] = useState(false)
  const [reportForm, setReportForm] = useState(buildEmptyReportForm())
  const [showCreateReportForm, setShowCreateReportForm] = useState(false)
  const [customerForm, setCustomerForm] = useState(buildEmptyCustomerForm())
  const [creatingCustomer, setCreatingCustomer] = useState(false)
  const [customerCreateError, setCustomerCreateError] = useState('')
  const [customerCreateSuccess, setCustomerCreateSuccess] = useState('')
  const [showCreateCustomerForm, setShowCreateCustomerForm] = useState(false)
  const [customerSearchInput, setCustomerSearchInput] = useState('')
  const [customerPage, setCustomerPage] = useState(1)
  const [showCreateEmployeeForm, setShowCreateEmployeeForm] = useState(false)
  const [employeeForm, setEmployeeForm] = useState(buildEmptyEmployeeForm())
  const [staffAssignments, setStaffAssignments] = useState([])
  const [staffAssignmentsLoading, setStaffAssignmentsLoading] = useState(false)
  const [staffAssignmentsError, setStaffAssignmentsError] = useState('')
  const [staffAssignmentsSuccess, setStaffAssignmentsSuccess] = useState('')
  const [employeeSearchInput, setEmployeeSearchInput] = useState('')
  const [employeePage, setEmployeePage] = useState(1)
  const [companyPickerUserId, setCompanyPickerUserId] = useState('')
  const [companyPickerSearchInput, setCompanyPickerSearchInput] = useState('')
  const [savingStaffUserId, setSavingStaffUserId] = useState(0)
  const [removingStaffUserId, setRemovingStaffUserId] = useState(0)
  const [creatingStaffAssignment, setCreatingStaffAssignment] = useState(false)
  const [showCreateEquipmentForm, setShowCreateEquipmentForm] = useState(false)
  const [creatingEquipment, setCreatingEquipment] = useState(false)
  const [equipmentCreateError, setEquipmentCreateError] = useState('')
  const [equipmentCreateSuccess, setEquipmentCreateSuccess] = useState('')
  const [equipmentForm, setEquipmentForm] = useState(buildEmptyEquipmentForm())
  const [equipmentPage, setEquipmentPage] = useState(1)
  const [updatingEquipmentStatus, setUpdatingEquipmentStatus] = useState(false)
  const [equipmentStatusError, setEquipmentStatusError] = useState('')
  const [equipmentStatusDraft, setEquipmentStatusDraft] = useState('active')
  const [showDecommissionConfirm, setShowDecommissionConfirm] = useState(false)
  const [equipmentTableTab, setEquipmentTableTab] = useState('active')
  const [expandedEquipmentCardId, setExpandedEquipmentCardId] = useState('')
  const [expandedReportCardId, setExpandedReportCardId] = useState('')
  const previousSelectedEquipmentIdRef = useRef('')
  const employeeControlsSectionRef = useRef(null)
  const generatedEmployeeBaseUsername = useMemo(
    () => buildEmployeeUsername(employeeForm.first_name, employeeForm.last_name),
    [employeeForm.first_name, employeeForm.last_name],
  )
  const existingEmployeeUsernames = useMemo(
    () => staffAssignments.map((assignment) => assignment.username),
    [staffAssignments],
  )
  const generatedEmployeeUsername = useMemo(
    () => buildUniqueEmployeeUsername(generatedEmployeeBaseUsername, existingEmployeeUsernames),
    [generatedEmployeeBaseUsername, existingEmployeeUsernames],
  )
  const selectedCompanyId = searchParams.get('companyId') || ''
  const equipmentPageSize = 10
  const customerPageSize = 5
  const employeePageSize = 5

  const canEditReports = useMemo(
    () => ['owner', 'office_staff', 'staff', 'engineer'].includes(profile?.role),
    [profile?.role],
  )
  const showsCustomerPicker = canEditReports && !selectedCompanyId
  const isOwner = profile?.role === 'owner' || profile?.role === 'office_staff'
  const isStaff = profile?.role === 'staff' || profile?.role === 'engineer'
  const activeSelectedEquipment = useMemo(() => {
    if (!selectedEquipment) return null
    return equipment.find((item) => String(item.id) === String(selectedEquipment.id)) || null
  }, [equipment, selectedEquipment])
  const sortedEquipment = useMemo(() => {
    const sorted = [...equipment].sort((left, right) => {
      // Put decommissioned items at the end
      const isLeftDecommissioned = left.status === 'decommissioned'
      const isRightDecommissioned = right.status === 'decommissioned'
      if (isLeftDecommissioned !== isRightDecommissioned) {
        return isLeftDecommissioned ? 1 : -1
      }

      const leftDue = getInspectionDueSortValue(left.next_inspection_due)
      const rightDue = getInspectionDueSortValue(right.next_inspection_due)

      if (leftDue !== rightDue) return leftDue - rightDue

      const nameComparison = String(left.name || '').localeCompare(String(right.name || ''))
      if (nameComparison !== 0) return nameComparison

      return Number(left.id) - Number(right.id)
    })

    // Split into active and decommissioned
    return {
      active: sorted.filter((item) => item.status !== 'decommissioned'),
      decommissioned: sorted.filter((item) => item.status === 'decommissioned'),
    }
  }, [equipment])

  const activeEquipment = sortedEquipment.active || []
  const decommissionedEquipment = sortedEquipment.decommissioned || []
  const currentTableEquipment = equipmentTableTab === 'active' ? activeEquipment : decommissionedEquipment

  const equipmentTotalPages = Math.max(1, Math.ceil(currentTableEquipment.length / equipmentPageSize))
  const equipmentStartIndex = (equipmentPage - 1) * equipmentPageSize
  const visibleEquipment = currentTableEquipment.slice(equipmentStartIndex, equipmentStartIndex + equipmentPageSize)
  const equipmentRangeStart = currentTableEquipment.length === 0 ? 0 : equipmentStartIndex + 1
  const equipmentRangeEnd = Math.min(equipmentStartIndex + equipmentPageSize, currentTableEquipment.length)
  const equipmentNextDuePreview = useMemo(
    () => calculateNextInspectionDue(equipmentForm.last_inspected_at, equipmentForm.inspection_interval_days),
    [equipmentForm.inspection_interval_days, equipmentForm.last_inspected_at],
  )
  const normalizedCustomerSearch = customerSearchInput.trim().toLowerCase()
  const filteredCustomers = useMemo(() => {
    if (!normalizedCustomerSearch) return companies
    return companies.filter((item) => {
      const haystack = [item.name, item.contact_email, item.contact_phone]
        .map((value) => String(value || '').toLowerCase())
        .join(' ')
      return haystack.includes(normalizedCustomerSearch)
    })
  }, [companies, normalizedCustomerSearch])
  const customerTotalPages = Math.max(1, Math.ceil(filteredCustomers.length / customerPageSize))
  const customerStartIndex = (customerPage - 1) * customerPageSize
  const visibleCustomers = filteredCustomers.slice(customerStartIndex, customerStartIndex + customerPageSize)

  const normalizedEmployeeSearch = employeeSearchInput.trim().toLowerCase()
  const filteredStaffAssignments = useMemo(() => {
    if (!normalizedEmployeeSearch) return staffAssignments
    return staffAssignments.filter((assignment) => {
      const haystack = [assignment.username, assignment.email, assignment.full_name]
        .map((value) => String(value || '').toLowerCase())
        .join(' ')
      return haystack.includes(normalizedEmployeeSearch)
    })
  }, [staffAssignments, normalizedEmployeeSearch])
  const employeeTotalPages = Math.max(1, Math.ceil(filteredStaffAssignments.length / employeePageSize))
  const employeeStartIndex = (employeePage - 1) * employeePageSize
  const visibleStaffAssignments = filteredStaffAssignments.slice(
    employeeStartIndex,
    employeeStartIndex + employeePageSize,
  )
  const activeCompanyPickerAssignment = useMemo(
    () => staffAssignments.find((item) => String(item.user_id) === String(companyPickerUserId)) || null,
    [staffAssignments, companyPickerUserId],
  )
  const filteredCompanyPickerCompanies = useMemo(() => {
    const query = companyPickerSearchInput.trim().toLowerCase()
    if (!query) return companies
    return companies.filter((item) => String(item.name || '').toLowerCase().includes(query))
  }, [companies, companyPickerSearchInput])
  const isEditingReport = Boolean(reportForm.reportId)
  const isAnyModalOpen = Boolean(
    viewedReport ||
      showEditReportModal ||
      showRevisionsModal ||
      showCreateReportForm ||
      showCreateCustomerForm ||
      showCreateEmployeeForm ||
      companyPickerUserId ||
      showCreateEquipmentForm ||
      showDecommissionConfirm,
  )
  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia('(max-width: 767px)').matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return

    const mediaQuery = window.matchMedia('(max-width: 767px)')
    const updateViewport = (event) => setIsMobileViewport(Boolean(event.matches))
    setIsMobileViewport(mediaQuery.matches)

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updateViewport)
      return () => mediaQuery.removeEventListener('change', updateViewport)
    }

    mediaQuery.addListener(updateViewport)
    return () => mediaQuery.removeListener(updateViewport)
  }, [])

  useEffect(() => {
    if (equipmentPage > equipmentTotalPages) {
      setEquipmentPage(equipmentTotalPages)
    }
  }, [equipmentPage, equipmentTotalPages])

  useEffect(() => {
    if (customerPage > customerTotalPages) {
      setCustomerPage(customerTotalPages)
    }
  }, [customerPage, customerTotalPages])

  useEffect(() => {
    if (employeePage > employeeTotalPages) {
      setEmployeePage(employeeTotalPages)
    }
  }, [employeePage, employeeTotalPages])

  useEffect(() => {
    setCustomerPage(1)
  }, [customerSearchInput, showsCustomerPicker])

  useEffect(() => {
    setEmployeePage(1)
  }, [employeeSearchInput, showsCustomerPicker])

  useEffect(() => {
    setExpandedEquipmentCardId('')
  }, [equipmentTableTab, equipmentPage])

  useEffect(() => {
    setExpandedReportCardId('')
  }, [activeSelectedEquipment?.id])

  useEffect(() => {
    if (!isMobileViewport) {
      previousSelectedEquipmentIdRef.current = ''
      return
    }

    const nextSelectedId = String(selectedEquipment?.id || '')
    const previousSelectedId = previousSelectedEquipmentIdRef.current
    previousSelectedEquipmentIdRef.current = nextSelectedId

    if (!nextSelectedId || nextSelectedId === previousSelectedId) return

    const frameId = window.requestAnimationFrame(() => {
      const cardElement = document.getElementById(`equipment-card-${nextSelectedId}`)
      cardElement?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [isMobileViewport, selectedEquipment?.id])

  useEffect(() => {
    setEquipmentStatusDraft(activeSelectedEquipment?.status || 'active')
    setShowDecommissionConfirm(false)
  }, [activeSelectedEquipment?.id, activeSelectedEquipment?.status])

  useEffect(() => {
    if (!activeSelectedEquipment) {
      setViewedReport(null)
      setShowEditReportModal(false)
      setShowRevisionsModal(false)
    }
  }, [activeSelectedEquipment])

  useEffect(() => {
    if (!viewedReport?.id) return
    const updatedReport = reports.find((item) => String(item.id) === String(viewedReport.id))
    if (updatedReport) {
      setViewedReport(updatedReport)
    }
  }, [reports, viewedReport?.id])

  useEffect(() => {
    if (!showDecommissionConfirm) return

    function handleEscapeClose(event) {
      if (event.key === 'Escape') {
        setShowDecommissionConfirm(false)
      }
    }

    window.addEventListener('keydown', handleEscapeClose)
    return () => window.removeEventListener('keydown', handleEscapeClose)
  }, [showDecommissionConfirm])

  useEffect(() => {
    const isAnyReportModalOpen = Boolean(viewedReport || showEditReportModal || showRevisionsModal)
    if (!isAnyReportModalOpen) return

    function handleEscapeClose(event) {
      if (event.key !== 'Escape') return

      if (showEditReportModal) {
        handleCancelEdit()
        return
      }

      if (showRevisionsModal) {
        setShowRevisionsModal(false)
        setRevisionReportId('')
        setReportRevisions([])
        return
      }

      if (viewedReport) {
        setViewedReport(null)
      }
    }

    window.addEventListener('keydown', handleEscapeClose)
    return () => window.removeEventListener('keydown', handleEscapeClose)
  }, [viewedReport, showEditReportModal, showRevisionsModal])

  useEffect(() => {
    const isAnyCreateModalOpen = Boolean(
      showCreateCustomerForm ||
        showCreateEmployeeForm ||
        companyPickerUserId ||
        showCreateEquipmentForm ||
        showCreateReportForm
    )
    if (!isAnyCreateModalOpen) return

    function handleEscapeClose(event) {
      if (event.key !== 'Escape') return

      if (showCreateReportForm) {
        setShowCreateReportForm(false)
        setReportForm(buildEmptyReportForm())
      }

      if (showCreateEquipmentForm) {
        setShowCreateEquipmentForm(false)
      }

      if (showCreateCustomerForm) {
        setShowCreateCustomerForm(false)
      }

      if (showCreateEmployeeForm) {
        setShowCreateEmployeeForm(false)
      }

      if (companyPickerUserId) {
        setCompanyPickerUserId('')
        setCompanyPickerSearchInput('')
      }
    }

    window.addEventListener('keydown', handleEscapeClose)
    return () => window.removeEventListener('keydown', handleEscapeClose)
  }, [
    showCreateCustomerForm,
    showCreateEmployeeForm,
    companyPickerUserId,
    showCreateEquipmentForm,
    showCreateReportForm,
  ])

  async function refreshPendingReportApprovals(force = false) {
    if (!isAuthenticated) return
    if (!force && !['owner', 'office_staff'].includes(profile?.role)) return

    setPendingApprovalsLoading(true)
    setPendingApprovalsError('')

    try {
      const nextReports = await getPendingReportApprovals()
      setPendingReportApprovals(nextReports)
    } catch (error) {
      if (Number(error?.status || 0) !== 403) {
        setPendingApprovalsError(String(error?.message || 'Unable to load pending approvals.'))
      }
      setPendingReportApprovals([])
    } finally {
      setPendingApprovalsLoading(false)
    }
  }

  async function refreshStaffAssignments(force = false) {
    if (!isAuthenticated) return
    if (!force && !['owner', 'office_staff'].includes(profile?.role)) return

    setStaffAssignmentsLoading(true)
    setStaffAssignmentsError('')
    try {
      const assignments = await getStaffAssignments()
      setStaffAssignments(assignments)
    } catch (error) {
      if (Number(error?.status || 0) !== 403) {
        setStaffAssignmentsError(String(error?.message || 'Unable to load employee assignments.'))
      }
      setStaffAssignments([])
    } finally {
      setStaffAssignmentsLoading(false)
    }
  }

  async function handleApproveViewedReport() {
    if (!viewedReport?.id || !isOwner || approvingReport) return

    setApprovingReport(true)
    setReportError('')

    try {
      const updatedReport = await updateReport(viewedReport.id, { status: 'approved' })
      const refreshedReports = reports.map((report) =>
        String(report.id) === String(updatedReport.id) ? updatedReport : report,
      )
      setReports(refreshedReports)
      setViewedReport(updatedReport)
      if (!selectedCompanyId) {
        await refreshPendingReportApprovals()
      }
      await getPortalEquipment({
        companyId: activeSelectedEquipment?.company_id || selectedCompanyId,
        search: searchQuery,
      }).then((refreshedEquipment) => {
        setEquipment(refreshedEquipment)
        if (selectedEquipment) {
          const nextSelectedEquipment = refreshedEquipment.find(
            (item) => String(item.id) === String(selectedEquipment.id),
          )
          setSelectedEquipment(nextSelectedEquipment || null)
        }
      })
    } catch (error) {
      setReportError(String(error?.message || 'Unable to approve report.'))
    } finally {
      setApprovingReport(false)
    }
  }

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
      if (!isAuthenticated) {
        setLoading(false)
        return
      }

      setLoading(true)
      setErrorMessage('')

      try {
        const nextProfile = await getPortalMe()
        if (cancelled) return

        setProfile(nextProfile)
        const isStaffOrOwner = ['staff', 'engineer', 'owner', 'office_staff'].includes(nextProfile.role)
        const isOwnerUser = ['owner', 'office_staff'].includes(nextProfile.role)

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
          }
        } else {
          setCompanies([])
        }

        if (isOwnerUser) {
          await refreshStaffAssignments(true)
          await refreshPendingReportApprovals(true)
        } else {
          setStaffAssignments([])
          setPendingReportApprovals([])
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
        setEquipmentPage(1)
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
  }, [isAuthenticated, navigate, searchQuery, selectedCompanyId])

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
    if (creatingReport || savingReportEdit) return

    const refreshEquipmentList = async () => {
      const companyIdForRefresh = activeSelectedEquipment?.company_id || selectedCompanyId
      if (!companyIdForRefresh) return

      const refreshedEquipment = await getPortalEquipment({
        companyId: companyIdForRefresh,
        search: searchQuery,
      })
      setEquipment(refreshedEquipment)
      if (selectedEquipment) {
        const nextSelectedEquipment = refreshedEquipment.find(
          (item) => String(item.id) === String(selectedEquipment.id),
        )
        setSelectedEquipment(nextSelectedEquipment || null)
      }
      setEquipmentPage(1)
    }

    if (isEditingReport) {
      setSavingReportEdit(true)
      setReportError('')
      try {
        const updatedReport = await updateReport(reportForm.reportId, {
          title: reportForm.title,
          summary: reportForm.summary,
          findings: reportForm.findings,
          recommendations: reportForm.recommendations,
          report_date: reportForm.report_date,
          status: reportForm.status,
          images: reportForm.images,
          removed_image_ids: reportForm.removedImageIds,
        })

        if (activeSelectedEquipment?.id) {
          const refreshed = await getEquipmentReports(activeSelectedEquipment.id)
          setReports(refreshed)
          setViewedReport(
            refreshed.find((item) => String(item.id) === String(reportForm.reportId)) || updatedReport,
          )
        } else {
          setViewedReport(updatedReport)
        }

        if (isOwner && !selectedCompanyId) {
          await refreshPendingReportApprovals()
        }
        await refreshEquipmentList()
        setReportForm(buildEmptyReportForm())
        setShowEditReportModal(false)
      } catch (error) {
        setReportError(String(error?.message || 'Unable to save report changes.'))
      } finally {
        setSavingReportEdit(false)
      }
      return
    }

    if (!activeSelectedEquipment?.id) return

    setCreatingReport(true)
    setReportError('')
    try {
      await createEquipmentReport(activeSelectedEquipment.id, reportForm)
      const refreshed = await getEquipmentReports(activeSelectedEquipment.id)
      setReports(refreshed)
      await refreshEquipmentList()
      setReportForm(buildEmptyReportForm())
      setShowCreateReportForm(false)
    } catch (error) {
      setReportError(String(error?.message || 'Unable to create report.'))
    } finally {
      setCreatingReport(false)
    }
  }

  async function handleCreateCustomer(event) {
    event.preventDefault()
    if (!isOwner || creatingCustomer) return

    setCreatingCustomer(true)
    setCustomerCreateError('')
    setCustomerCreateSuccess('')
    try {
      const created = await createPortalCustomer(customerForm)
      const refreshedCompanies = await getPortalCompanies()
      setCompanies(refreshedCompanies)
      setCustomerForm(buildEmptyCustomerForm())
      setShowCreateCustomerForm(false)
      setCustomerCreateSuccess(
        `Created customer ${created.customer.username} for ${created.company.name}.`,
      )
    } catch (error) {
      setCustomerCreateError(String(error?.message || 'Unable to create customer account.'))
    } finally {
      setCreatingCustomer(false)
    }
  }

  async function handleCreateEmployeeAssignment(event) {
    event.preventDefault()
    if (!isOwner || creatingStaffAssignment) return

    const nextBaseUsername = buildEmployeeUsername(employeeForm.first_name, employeeForm.last_name)
    const nextUsername = buildUniqueEmployeeUsername(nextBaseUsername, existingEmployeeUsernames)
    if (!nextUsername) {
      setStaffAssignmentsError('First name and last name are required to generate a username.')
      return
    }

    setCreatingStaffAssignment(true)
    setStaffAssignmentsError('')
    setStaffAssignmentsSuccess('')
    try {
      const created = await createStaffAssignment({
        ...employeeForm,
        username: nextUsername,
      })
      await refreshStaffAssignments(true)
      setEmployeeForm(buildEmptyEmployeeForm())
      setShowCreateEmployeeForm(false)
      setStaffAssignmentsSuccess(`Created employee ${created.username}.`)
    } catch (error) {
      setStaffAssignmentsError(String(error?.message || 'Unable to create employee account.'))
    } finally {
      setCreatingStaffAssignment(false)
    }
  }

  async function handleSaveEmployeeAssignment(assignment) {
    if (!assignment?.user_id || savingStaffUserId) return
    setSavingStaffUserId(Number(assignment.user_id))
    setStaffAssignmentsError('')
    setStaffAssignmentsSuccess('')
    try {
      await updateStaffAssignment({
        user_id: assignment.user_id,
        role: assignment.role,
        allowed_company_ids: assignment.allowed_company_ids || [],
      })
      setStaffAssignmentsSuccess(`Updated permissions for ${assignment.username}.`)
      await refreshStaffAssignments(true)
      if (String(companyPickerUserId) === String(assignment.user_id)) {
        setCompanyPickerUserId('')
        setCompanyPickerSearchInput('')
      }
      window.requestAnimationFrame(() => {
        employeeControlsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    } catch (error) {
      setStaffAssignmentsError(String(error?.message || 'Unable to update employee permissions.'))
    } finally {
      setSavingStaffUserId(0)
    }
  }

  async function handleEmployeeRoleChange(assignment, nextRole) {
    if (!assignment?.user_id || savingStaffUserId || removingStaffUserId) return

    const previousRole = assignment.role
    setStaffAssignments((current) =>
      current.map((item) =>
        item.user_id === assignment.user_id
          ? { ...item, role: nextRole }
          : item,
      ),
    )

    setSavingStaffUserId(Number(assignment.user_id))
    setStaffAssignmentsError('')
    setStaffAssignmentsSuccess('')
    try {
      await updateStaffAssignment({
        user_id: assignment.user_id,
        role: nextRole,
        allowed_company_ids: assignment.allowed_company_ids || [],
      })
      setStaffAssignmentsSuccess(`Updated employee type for ${assignment.username}.`)
      await refreshStaffAssignments(true)
    } catch (error) {
      setStaffAssignments((current) =>
        current.map((item) =>
          item.user_id === assignment.user_id
            ? { ...item, role: previousRole }
            : item,
        ),
      )
      setStaffAssignmentsError(String(error?.message || 'Unable to update employee type.'))
    } finally {
      setSavingStaffUserId(0)
    }
  }

  async function handleRemoveEmployeeAssignment(assignment) {
    if (!assignment?.user_id || removingStaffUserId) return
    setRemovingStaffUserId(Number(assignment.user_id))
    setStaffAssignmentsError('')
    setStaffAssignmentsSuccess('')
    try {
      await deleteStaffAssignment(assignment.user_id)
      setStaffAssignmentsSuccess(`Removed employee ${assignment.username}.`)
      await refreshStaffAssignments(true)
    } catch (error) {
      setStaffAssignmentsError(String(error?.message || 'Unable to remove employee account.'))
    } finally {
      setRemovingStaffUserId(0)
    }
  }

  async function handleCreateEquipment(event) {
    event.preventDefault()
    if (!canEditReports || !selectedCompanyId || creatingEquipment) return

    setCreatingEquipment(true)
    setEquipmentCreateError('')
    setEquipmentCreateSuccess('')
    try {
      const payload = {
        ...equipmentForm,
        company_id: Number(selectedCompanyId),
        inspection_interval_days: Number(equipmentForm.inspection_interval_days || 365),
        last_inspected_at: equipmentForm.last_inspected_at || null,
      }
      const created = await createPortalEquipment(payload)
      const refreshedEquipment = await getPortalEquipment({
        companyId: selectedCompanyId,
        search: searchQuery,
      })
      setEquipment(refreshedEquipment)
      setEquipmentPage(1)
      setEquipmentForm(buildEmptyEquipmentForm())
      setShowCreateEquipmentForm(false)
      setEquipmentCreateSuccess(`Created equipment ${created.name}.`)
    } catch (error) {
      setEquipmentCreateError(String(error?.message || 'Unable to create equipment.'))
    } finally {
      setCreatingEquipment(false)
    }
  }

  async function handleUpdateEquipmentStatus(newStatus, equipmentId = null) {
    const targetEquipmentId = equipmentId || activeSelectedEquipment?.id
    if (!targetEquipmentId || updatingEquipmentStatus) return
    const companyIdForRefresh = activeSelectedEquipment?.company_id || selectedCompanyId
    const selectedEquipmentIdToMaintain = selectedEquipment?.id || null

    setUpdatingEquipmentStatus(true)
    setEquipmentStatusError('')
    try {
      await updatePortalEquipment(targetEquipmentId, { status: newStatus })
      const refreshedEquipment = await getPortalEquipment({
        companyId: companyIdForRefresh,
        search: searchQuery,
      })
      setEquipment(refreshedEquipment)
      if (selectedEquipmentIdToMaintain) {
        const nextSelectedEquipment = refreshedEquipment.find(
          (item) => String(item.id) === String(selectedEquipmentIdToMaintain),
        )
        setSelectedEquipment(nextSelectedEquipment || null)
      }
      setEquipmentPage(1)
    } catch (error) {
      setEquipmentStatusError(String(error?.message || 'Unable to update equipment status.'))
    } finally {
      setUpdatingEquipmentStatus(false)
    }
  }

  async function handleSubmitEquipmentStatusUpdate() {
    if (!activeSelectedEquipment?.id || updatingEquipmentStatus) return
    if (equipmentStatusDraft === (activeSelectedEquipment.status || 'active')) return

    if (equipmentStatusDraft === 'decommissioned') {
      setShowDecommissionConfirm(true)
      return
    }

    await handleUpdateEquipmentStatus(equipmentStatusDraft, activeSelectedEquipment.id)
  }

  async function handleConfirmDecommission() {
    if (!activeSelectedEquipment?.id || updatingEquipmentStatus) return
    setShowDecommissionConfirm(false)
    await handleUpdateEquipmentStatus('decommissioned', activeSelectedEquipment.id)
  }

  function handleStartEdit(report) {
    setShowCreateReportForm(false)
    setShowEditReportModal(true)
    setReportForm({
      reportId: String(report.id),
      title: report.title || '',
      summary: report.summary || '',
      findings: report.findings || '',
      recommendations: report.recommendations || '',
      report_date: report.report_date || new Date().toISOString().slice(0, 10),
      status: report.status || 'draft',
      images: [],
      existingImages: Array.isArray(report.images) ? report.images : [],
      removedImageIds: [],
    })
  }

  function handleOpenReportImage(image, images = []) {
    setSelectedReportImage({
      image,
      images: Array.isArray(images) ? images : [],
    })
  }

  function handleCloseReportImage() {
    setSelectedReportImage(null)
  }

  function handleMoveReportImage(direction) {
    if (!selectedReportImage) return

    const currentImages = Array.isArray(selectedReportImage.images) ? selectedReportImage.images : []
    const currentIndex = currentImages.findIndex(
      (image) => String(image.id) === String(selectedReportImage.image?.id),
    )
    if (currentIndex < 0) return

    const nextIndex = currentIndex + direction
    if (nextIndex < 0 || nextIndex >= currentImages.length) return

    setSelectedReportImage({
      image: currentImages[nextIndex],
      images: currentImages,
    })
  }

  function handleRemoveReportImage(imageId) {
    setReportForm((current) => {
      const nextExistingImages = (current.existingImages || []).filter(
        (image) => String(image.id) !== String(imageId),
      )
      const nextRemovedImageIds = current.removedImageIds || []
      if (nextRemovedImageIds.some((value) => String(value) === String(imageId))) {
        return {
          ...current,
          existingImages: nextExistingImages,
        }
      }

      return {
        ...current,
        existingImages: nextExistingImages,
        removedImageIds: [...nextRemovedImageIds, imageId],
      }
    })
  }

  async function handleLoadRevisions(reportId) {
    if (!isOwner) return
    setShowRevisionsModal(true)
    setRevisionReportId(String(reportId))
    setReportRevisions([])
    setRevisionsLoading(true)
    setReportError('')
    try {
      const revisions = await getReportRevisions(reportId)
      setReportRevisions(revisions)
    } catch (error) {
      setReportError(String(error?.message || 'Unable to load revision history.'))
    } finally {
      setRevisionsLoading(false)
    }
  }

  function handleCancelEdit() {
    setReportForm(buildEmptyReportForm())
    setShowEditReportModal(false)
  }

  function canEditReport(report) {
    if (isOwner) return true
    if (!isStaff) return false
    return report.status === 'draft' && Number(report.submitted_by) === Number(profile?.id)
  }

  function reportStatusOptions() {
    if (isEditingReport && isOwner) {
      return [
        { value: 'submitted', label: 'Submitted' },
        { value: 'approved', label: 'Approved' },
      ]
    }

    return [
      { value: 'draft', label: 'Draft' },
      { value: 'submitted', label: 'Submitted' },
    ]
  }

  function handleCloseEquipmentDetails() {
    setSelectedEquipment(null)
    setReports([])
    setViewedReport(null)
    setSelectedReportImage(null)
    setReportForm(buildEmptyReportForm())
    setShowCreateReportForm(false)
    setShowEditReportModal(false)
    setShowRevisionsModal(false)
    setRevisionReportId('')
    setReportRevisions([])
  }

  if (!isAuthenticated) {
    return <Navigate to="/portal/login" replace />
  }

  return (
    <PortalLayout hideNavbar={isAnyModalOpen}>
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
                {profile.username || profile.fullName || 'Portal User'}
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

            <div className="mt-4 w-full max-w-md">
              <input
                type="search"
                value={customerSearchInput}
                onChange={(event) => setCustomerSearchInput(event.target.value)}
                placeholder="Search customers by name, email, phone"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-[#123A7A]"
              />
            </div>

            {customerCreateError && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {customerCreateError}
              </div>
            )}
            {customerCreateSuccess && (
              <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {customerCreateSuccess}
              </div>
            )}

            {loading ? (
              <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                Loading customers...
              </div>
            ) : (
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {isOwner && (
                  <article className="rounded-xl border border-dashed border-[#123A7A] bg-slate-50 p-4">
                    <button
                      type="button"
                      onClick={() => {
                        setShowCreateCustomerForm(true)
                        setCustomerCreateError('')
                        setCustomerCreateSuccess('')
                      }}
                      className="flex h-full w-full flex-col items-center justify-center rounded-lg p-4 text-center transition hover:bg-white"
                    >
                      <span className="grid h-10 w-10 place-items-center rounded-full border border-[#123A7A] text-2xl font-bold text-[#123A7A]">
                        +
                      </span>
                      <h3 className="mt-3 text-lg font-bold text-[#123A7A]">Add New Customer</h3>
                      <p className="mt-1 text-sm text-slate-600">
                        Create a company and portal login.
                      </p>
                    </button>
                  </article>
                )}
                {visibleCustomers.map((item) => (
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
                {!isOwner && companies.length === 0 && (
                  <div className="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                    No customer companies are assigned to this account.
                  </div>
                )}
                {companies.length > 0 && filteredCustomers.length === 0 && (
                  <div className="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                    No customers match your search.
                  </div>
                )}
              </div>
            )}

            {!loading && filteredCustomers.length > 0 && (
              <div className="mt-4 flex items-center justify-between gap-3">
                <p className="text-sm text-slate-600">
                  Showing {customerStartIndex + 1}-{Math.min(customerStartIndex + customerPageSize, filteredCustomers.length)} of{' '}
                  {filteredCustomers.length} customers.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCustomerPage((current) => Math.max(1, current - 1))}
                    disabled={customerPage === 1}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-700 disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Page {customerPage} of {customerTotalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCustomerPage((current) => Math.min(customerTotalPages, current + 1))}
                    disabled={customerPage === customerTotalPages}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-700 disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {showsCustomerPicker && isOwner && (
          <section ref={employeeControlsSectionRef} className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-extrabold text-[#123A7A]">Employee Controls</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Manage employee portal accounts and company access permissions.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setStaffAssignmentsError('')
                  setStaffAssignmentsSuccess('')
                  setShowCreateEmployeeForm(true)
                }}
                className="rounded-md border border-[#123A7A] bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
              >
                Add Employee
              </button>
            </div>

            <div className="mt-4 w-full max-w-md">
              <input
                type="search"
                value={employeeSearchInput}
                onChange={(event) => setEmployeeSearchInput(event.target.value)}
                placeholder="Search employees by username, email, name"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-[#123A7A]"
              />
            </div>

            {staffAssignmentsError && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {staffAssignmentsError}
              </div>
            )}
            {staffAssignmentsSuccess && (
              <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {staffAssignmentsSuccess}
              </div>
            )}

            {staffAssignmentsLoading ? (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                Loading employee assignments...
              </div>
            ) : staffAssignments.length === 0 ? (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                No employee accounts found yet.
              </div>
            ) : filteredStaffAssignments.length === 0 ? (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                No employees match your search.
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {visibleStaffAssignments.map((assignment) => (
                  <article key={assignment.user_id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    {(() => {
                      const assignedCompanyNames = companies
                        .filter((item) => (assignment.allowed_company_ids || []).includes(item.id))
                        .map((item) => item.name)
                      const previewNames = assignedCompanyNames.slice(0, 2).join(', ')
                      const remainingCount = Math.max(assignedCompanyNames.length - 2, 0)

                      return (
                        <>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <h3 className="text-base font-bold text-[#123A7A]">{assignment.username}</h3>
                        <p className="text-sm text-slate-600">{assignment.email || '-'}</p>
                        <p className="text-sm text-slate-600">{assignment.full_name || '-'}</p>
                      </div>
                      <div className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                        <span>Employee Type</span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              void handleEmployeeRoleChange(assignment, 'engineer')
                            }}
                            aria-pressed={(assignment.role === 'staff' ? 'engineer' : assignment.role) === 'engineer'}
                            disabled={
                              savingStaffUserId === Number(assignment.user_id) ||
                              removingStaffUserId === Number(assignment.user_id)
                            }
                            className={
                              'rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wide transition ' +
                              ((assignment.role === 'staff' ? 'engineer' : assignment.role) === 'engineer'
                                ? 'border-[#123A7A] bg-white text-[#123A7A] shadow-md ring-2 ring-[#123A7A]/25'
                                : 'border-slate-200 bg-slate-100 text-slate-500 hover:bg-white')
                            }
                          >
                            Engineer
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void handleEmployeeRoleChange(assignment, 'office_staff')
                            }}
                            aria-pressed={(assignment.role === 'staff' ? 'engineer' : assignment.role) === 'office_staff'}
                            disabled={
                              savingStaffUserId === Number(assignment.user_id) ||
                              removingStaffUserId === Number(assignment.user_id)
                            }
                            className={
                              'rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wide transition ' +
                              ((assignment.role === 'staff' ? 'engineer' : assignment.role) === 'office_staff'
                                ? 'border-[#0f3168] bg-[#123A7A] text-white shadow-md ring-2 ring-[#123A7A]/35'
                                : 'border-blue-200 bg-blue-50 text-blue-500 hover:bg-blue-100')
                            }
                          >
                            Office
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Allowed Companies</p>
                          <p className="text-sm text-slate-700">
                            {assignedCompanyNames.length === 0
                              ? 'No companies assigned.'
                              : `${previewNames}${remainingCount > 0 ? ` +${remainingCount} more` : ''}`}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setCompanyPickerUserId(String(assignment.user_id))
                            setCompanyPickerSearchInput('')
                          }}
                          className="rounded-md border border-[#123A7A] bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
                        >
                          Edit Companies
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => handleRemoveEmployeeAssignment(assignment)}
                        disabled={removingStaffUserId === Number(assignment.user_id)}
                        className="rounded-md border border-rose-300 bg-rose-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {removingStaffUserId === Number(assignment.user_id) ? 'Removing...' : 'Remove Employee'}
                      </button>
                    </div>
                        </>
                    )
                  })()}
                  </article>
                ))}
              </div>
            )}

            {!staffAssignmentsLoading && filteredStaffAssignments.length > 0 && (
              <div className="mt-4 flex items-center justify-between gap-3">
                <p className="text-sm text-slate-600">
                  Showing {employeeStartIndex + 1}-{Math.min(employeeStartIndex + employeePageSize, filteredStaffAssignments.length)} of{' '}
                  {filteredStaffAssignments.length} employees.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEmployeePage((current) => Math.max(1, current - 1))}
                    disabled={employeePage === 1}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-700 disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Page {employeePage} of {employeeTotalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEmployeePage((current) => Math.min(employeeTotalPages, current + 1))}
                    disabled={employeePage === employeeTotalPages}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-700 disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {showsCustomerPicker && isOwner && (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-extrabold text-[#123A7A]">Pending Report Approvals</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Submitted reports waiting for owner approval across all visible customers.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
                  {pendingReportApprovals.length} pending
                </span>
                <button
                  type="button"
                  onClick={refreshPendingReportApprovals}
                  disabled={pendingApprovalsLoading}
                  className="rounded-md border border-[#123A7A] bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {pendingApprovalsLoading ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>
            </div>

            {pendingApprovalsError && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {pendingApprovalsError}
              </div>
            )}

            {pendingApprovalsLoading ? (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                Loading pending approvals...
              </div>
            ) : pendingReportApprovals.length === 0 ? (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                No submitted reports are waiting for approval.
              </div>
            ) : (
              <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {pendingReportApprovals.map((report) => (
                  <article key={report.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-bold text-[#123A7A]">{report.title || 'Untitled Report'}</h3>
                        <p className="mt-1 text-sm text-slate-600">
                          {report.company_name || 'Unknown Company'} · {report.equipment_name || 'Unknown Equipment'}
                        </p>
                      </div>
                      <span
                        className={
                          'rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ' +
                          getReportStatusBadge(report.status).color
                        }
                      >
                        {getReportStatusBadge(report.status).label}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-1 text-sm text-slate-600">
                      <p>
                        <span className="font-semibold text-slate-700">Date:</span> {report.report_date || '-'}
                      </p>
                      <p>
                        <span className="font-semibold text-slate-700">Inspector:</span>{' '}
                        {report.submitted_by_name || '-'}
                      </p>
                      <p className="max-h-10 overflow-hidden text-ellipsis">
                        <span className="font-semibold text-slate-700">Summary:</span> {report.summary || '-'}
                      </p>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setViewedReport(report)}
                        className="rounded-md bg-[#123A7A] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white transition hover:bg-[#0f3168]"
                      >
                        Review Report
                      </button>
                    </div>
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

          {canEditReports && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => {
                  setShowCreateEquipmentForm(true)
                  setEquipmentCreateError('')
                }}
                className="rounded-md border border-[#123A7A] bg-white px-3 py-2 text-sm font-semibold text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
              >
                + Add Equipment
              </button>
            </div>
          )}

          {equipmentCreateError && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {equipmentCreateError}
            </div>
          )}
          {equipmentCreateSuccess && (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {equipmentCreateSuccess}
            </div>
          )}


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
              {/* Equipment Tabs */}
              <div className="flex items-end gap-1 border-b border-slate-300 bg-slate-50 px-3 pt-2">
                <button
                  onClick={() => {
                    setEquipmentTableTab('active')
                    setEquipmentPage(1)
                  }}
                  className={`-mb-px rounded-t-lg border px-4 py-2.5 text-sm font-semibold transition ${
                    equipmentTableTab === 'active'
                      ? 'border-slate-300 border-b-white bg-white text-[#123A7A] shadow-sm'
                      : 'border-transparent bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-800'
                  }`}
                >
                  Active Equipment ({activeEquipment.length})
                </button>
                <button
                  onClick={() => {
                    setEquipmentTableTab('decommissioned')
                    setEquipmentPage(1)
                  }}
                  className={`-mb-px rounded-t-lg border px-4 py-2.5 text-sm font-semibold transition ${
                    equipmentTableTab === 'decommissioned'
                      ? 'border-slate-300 border-b-white bg-white text-[#123A7A] shadow-sm'
                      : 'border-transparent bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-800'
                  }`}
                >
                  Decommissioned Equipment ({decommissionedEquipment.length})
                </button>
              </div>

              {isMobileViewport && (
                <div className="space-y-3 p-3">
                {visibleEquipment.map((item) => {
                  const inspectionStatus = getInspectionStatusBadge(item.next_inspection_due)
                  const isExpandedEquipmentCard = String(expandedEquipmentCardId) === String(item.id)
                  const isInlineSelectedEquipment =
                    equipmentTableTab === 'active' &&
                    activeSelectedEquipment &&
                    String(activeSelectedEquipment.id) === String(item.id)
                  return (
                    <article id={`equipment-card-${item.id}`} key={item.id} className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-bold text-slate-800">{item.name}</h3>
                        <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                          {item.status || 'unknown'}
                        </span>
                      </div>
                      <div className="mt-2 grid gap-1 text-xs text-slate-600">
                        <p><span className="font-semibold text-slate-700">Asset Tag:</span> {item.asset_tag || '-'}</p>
                        {equipmentTableTab === 'active' && (
                          <>
                            <p>
                              <span className="font-semibold text-slate-700">Inspection:</span>{' '}
                              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${inspectionStatus.color}`}>
                                {inspectionStatus.label}
                              </span>
                            </p>
                            <p><span className="font-semibold text-slate-700">Next Due:</span> {item.next_inspection_due || '-'}</p>
                          </>
                        )}
                        {equipmentTableTab === 'decommissioned' && !isExpandedEquipmentCard && (
                          <p><span className="font-semibold text-slate-700">Decommissioned:</span> {item.decommissioned_at || '-'}</p>
                        )}
                        <div
                          className={`overflow-hidden transition-all duration-300 ease-out ${
                            isExpandedEquipmentCard ? 'max-h-32 opacity-100' : 'max-h-0 opacity-0'
                          }`}
                          aria-hidden={!isExpandedEquipmentCard}
                        >
                          <div className="grid gap-1 pt-1">
                            <p><span className="font-semibold text-slate-700">Serial:</span> {item.serial_number || '-'}</p>
                            {equipmentTableTab === 'active' && (
                              <p><span className="font-semibold text-slate-700">Location:</span> {item.location || '-'}</p>
                            )}
                            {equipmentTableTab === 'decommissioned' && (
                              <p><span className="font-semibold text-slate-700">Decommissioned:</span> {item.decommissioned_at || '-'}</p>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedEquipmentCardId((current) =>
                              String(current) === String(item.id) ? '' : String(item.id)
                            )
                          }
                          className="inline-flex items-center gap-1 rounded border border-slate-300 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700 transition hover:border-slate-400"
                        >
                          <span
                            className={`transition-transform duration-300 ease-out ${
                              isExpandedEquipmentCard ? 'rotate-180' : 'rotate-0'
                            }`}
                            aria-hidden="true"
                          >
                            ▾
                          </span>
                          {isExpandedEquipmentCard ? 'Less details' : 'More details'}
                        </button>
                        <div className="flex gap-2">
                        {equipmentTableTab === 'decommissioned' && isOwner && (
                          <button
                            type="button"
                            onClick={() => handleUpdateEquipmentStatus('active', item.id)}
                            disabled={updatingEquipmentStatus}
                            className="rounded border border-emerald-600 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-700 transition hover:bg-emerald-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Set Active
                          </button>
                        )}
                        {equipmentTableTab === 'active' && (
                          <button
                            type="button"
                            onClick={() => {
                              if (isInlineSelectedEquipment) {
                                handleCloseEquipmentDetails()
                                return
                              }
                              setSelectedEquipment(item)
                              setReportForm(buildEmptyReportForm())
                              setShowCreateReportForm(false)
                              setRevisionReportId('')
                              setReportRevisions([])
                            }}
                            className="rounded border border-[#123A7A] px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
                          >
                            {isInlineSelectedEquipment ? 'Hide' : 'View'}
                          </button>
                        )}
                        </div>
                      </div>

                      {isInlineSelectedEquipment && (
                        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-bold text-[#123A7A]">Equipment Details</p>
                            <button
                              type="button"
                              onClick={handleCloseEquipmentDetails}
                              className="rounded border border-slate-300 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-700"
                            >
                              Close
                            </button>
                          </div>

                          <div className="mt-2 grid gap-1 text-xs text-slate-700">
                            {canEditReports && (
                              <div>
                                <p><span className="font-semibold">Status:</span></p>
                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                  <select
                                    value={equipmentStatusDraft}
                                    onChange={(event) => setEquipmentStatusDraft(event.target.value)}
                                    disabled={updatingEquipmentStatus}
                                    className="rounded-md border border-slate-300 px-2 py-1 text-[11px]"
                                  >
                                    <option value="active">Active</option>
                                    <option value="decommissioned">Decommissioned</option>
                                  </select>
                                  <button
                                    type="button"
                                    onClick={handleSubmitEquipmentStatusUpdate}
                                    disabled={
                                      updatingEquipmentStatus ||
                                      equipmentStatusDraft === (activeSelectedEquipment.status || 'active')
                                    }
                                    className="rounded border border-[#123A7A] bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    Update Status
                                  </button>
                                  {updatingEquipmentStatus && <span className="text-[11px] text-slate-500">Updating...</span>}
                                </div>
                              </div>
                            )}
                            <p><span className="font-semibold">Asset Tag:</span> {activeSelectedEquipment.asset_tag || '-'}</p>
                            <p><span className="font-semibold">Serial:</span> {activeSelectedEquipment.serial_number || '-'}</p>
                            <p><span className="font-semibold">Location:</span> {activeSelectedEquipment.location || '-'}</p>
                            <p><span className="font-semibold">Interval:</span> {activeSelectedEquipment.inspection_interval_days || '-'} days</p>
                            <p><span className="font-semibold">Last Inspected:</span> {activeSelectedEquipment.last_inspected_at || '-'}</p>
                            <p><span className="font-semibold">Next Due:</span> {activeSelectedEquipment.next_inspection_due || '-'}</p>
                          </div>

                          {equipmentStatusError && (
                            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                              {equipmentStatusError}
                            </div>
                          )}

                          {reportError && (
                            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                              {reportError}
                            </div>
                          )}

                          {canEditReports && (
                            <div className="mt-3">
                              <button
                                type="button"
                                onClick={() => {
                                  setReportForm(buildEmptyReportForm())
                                  setShowCreateReportForm(true)
                                }}
                                className="rounded-md border border-[#123A7A] bg-white px-3 py-2 text-xs font-semibold text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
                              >
                                Create New Report
                              </button>
                            </div>
                          )}

                          <div className="mt-3 space-y-2">
                            {reportsLoading ? (
                              <p className="text-xs text-slate-500">Loading reports...</p>
                            ) : reports.length === 0 ? (
                              <p className="text-xs text-slate-500">No reports have been submitted for this equipment.</p>
                            ) : (
                              reports.map((report) => (
                                <article key={report.id} className="rounded border border-slate-200 bg-white p-2.5">
                                  {(() => {
                                    const statusBadge = getReportStatusBadge(report.status)
                                    return (
                                      <>
                                  <div className="flex items-start justify-between gap-2">
                                    <p className="text-xs font-semibold text-slate-800">{report.title || 'Untitled report'}</p>
                                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusBadge.color}`}>
                                      {statusBadge.label}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-[11px] text-slate-600">
                                    <span className="font-semibold text-slate-700">Date:</span> {report.report_date || '-'}
                                  </p>
                                  <div className="mt-2 flex justify-end">
                                    <button
                                      type="button"
                                      onClick={() => setViewedReport(report)}
                                      className="rounded border border-[#123A7A] px-2 py-1 text-[10px] font-semibold text-[#123A7A]"
                                    >
                                      View
                                    </button>
                                  </div>
                                      </>
                                    )
                                  })()}
                                </article>
                              ))
                            )}
                          </div>
                        </div>
                      )}
                    </article>
                  )
                })}
                </div>
              )}

              {!isMobileViewport && (
                <div className="overflow-x-auto">
                <table className="w-full min-w-[920px] border-collapse text-left text-sm">
                  <thead className="bg-[#123A7A] text-white">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Name</th>
                      <th className="px-4 py-3 font-semibold">Asset Tag</th>
                      <th className="px-4 py-3 font-semibold">Serial</th>
                      {equipmentTableTab === 'active' && <th className="px-4 py-3 font-semibold">Location</th>}
                      <th className="px-4 py-3 font-semibold">Status</th>
                      {equipmentTableTab === 'active' && (
                        <>
                          <th className="px-4 py-3 font-semibold">Inspection Status</th>
                          <th className="px-4 py-3 font-semibold">Next Due</th>
                        </>
                      )}
                      {equipmentTableTab === 'decommissioned' && (
                        <th className="px-4 py-3 font-semibold">Decommissioned Date</th>
                      )}
                      {equipmentTableTab === 'active' && <th className="px-4 py-3 font-semibold">Reports</th>}
                      {equipmentTableTab === 'decommissioned' && isOwner && <th className="px-4 py-3 font-semibold">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleEquipment.map((item) => {
                      const inspectionStatus = getInspectionStatusBadge(item.next_inspection_due)
                      return (
                        <tr key={item.id} className="border-t border-slate-200 odd:bg-white even:bg-slate-50/60">
                          <td className="px-4 py-3 font-semibold text-slate-800">{item.name}</td>
                          <td className="px-4 py-3 text-slate-700">{item.asset_tag || '-'}</td>
                          <td className="px-4 py-3 text-slate-700">{item.serial_number || '-'}</td>
                          {equipmentTableTab === 'active' && <td className="px-4 py-3 text-slate-700">{item.location || '-'}</td>}
                          <td className="px-4 py-3">
                            <span className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
                              {item.status || 'unknown'}
                            </span>
                          </td>
                          {equipmentTableTab === 'active' && (
                            <>
                              <td className="px-4 py-3">
                                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${inspectionStatus.color}`}>
                                  {inspectionStatus.label}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-slate-700">{item.next_inspection_due || '-'}</td>
                            </>
                          )}
                          {equipmentTableTab === 'decommissioned' && (
                            <td className="px-4 py-3 text-slate-700">{item.decommissioned_at || '-'}</td>
                          )}
                          {equipmentTableTab === 'decommissioned' && isOwner && (
                            <td className="px-4 py-3 text-slate-700">
                              <button
                                type="button"
                                onClick={() => handleUpdateEquipmentStatus('active', item.id)}
                                disabled={updatingEquipmentStatus}
                                className="rounded border border-emerald-600 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-700 transition hover:bg-emerald-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Set Active
                              </button>
                            </td>
                          )}
                          {equipmentTableTab === 'active' && (
                            <td className="px-4 py-3 text-slate-700">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedEquipment(item)
                                  setReportForm(buildEmptyReportForm())
                                  setShowCreateReportForm(false)
                                  setRevisionReportId('')
                                  setReportRevisions([])
                                }}
                                className="rounded border border-[#123A7A] px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
                              >
                                View
                              </button>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                </div>
              )}
                {currentTableEquipment.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  <p>
                      Showing {equipmentRangeStart}-{equipmentRangeEnd} of {currentTableEquipment.length} equipment items.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEquipmentPage((current) => Math.max(1, current - 1))}
                      disabled={equipmentPage === 1}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 transition hover:border-[#123A7A] hover:text-[#123A7A] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <span className="min-w-24 text-center font-semibold text-slate-700">
                      Page {equipmentPage} of {equipmentTotalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setEquipmentPage((current) => Math.min(equipmentTotalPages, current + 1))}
                      disabled={equipmentPage === equipmentTotalPages}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 transition hover:border-[#123A7A] hover:text-[#123A7A] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          </section>
        )}

        {!showsCustomerPicker && activeSelectedEquipment && !isMobileViewport && (
          <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-extrabold text-[#123A7A]">
                  Equipment Details: {activeSelectedEquipment.name}
                </h2>
              </div>
              <button
                type="button"
                onClick={handleCloseEquipmentDetails}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-[#123A7A] transition hover:border-[#123A7A]"
              >
                Close Details
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="grid gap-2 text-sm text-slate-700 md:grid-cols-2">
                <p><span className="font-semibold">Name:</span> {activeSelectedEquipment.name || '-'}</p>
                <div>
                  <span className="font-semibold">Status:</span>{' '}
                  {canEditReports ? (
                    <div className="mt-1 flex gap-2">
                      <select
                        value={equipmentStatusDraft}
                        onChange={(e) => setEquipmentStatusDraft(e.target.value)}
                        disabled={updatingEquipmentStatus}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                      >
                        <option value="active">Active</option>
                        <option value="decommissioned">Decommissioned</option>
                      </select>
                      <button
                        type="button"
                        onClick={handleSubmitEquipmentStatusUpdate}
                        disabled={
                          updatingEquipmentStatus ||
                          equipmentStatusDraft === (activeSelectedEquipment.status || 'active')
                        }
                        className="rounded border border-[#123A7A] bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Update Status
                      </button>
                      {updatingEquipmentStatus && <span className="text-xs text-slate-500">Updating...</span>}
                    </div>
                  ) : (
                    <span>{activeSelectedEquipment.status || '-'}</span>
                  )}
                </div>
                <p><span className="font-semibold">Asset Tag:</span> {activeSelectedEquipment.asset_tag || '-'}</p>
                <p><span className="font-semibold">Serial Number:</span> {activeSelectedEquipment.serial_number || '-'}</p>
                <p><span className="font-semibold">Location:</span> {activeSelectedEquipment.location || '-'}</p>
                <p>
                  <span className="font-semibold">Inspection Interval:</span>{' '}
                  {activeSelectedEquipment.inspection_interval_days || '-'} days
                </p>
                <p><span className="font-semibold">Last Inspected:</span> {activeSelectedEquipment.last_inspected_at || '-'}</p>
                <p><span className="font-semibold">Next Inspection Due:</span> {activeSelectedEquipment.next_inspection_due || '-'}</p>
                <p className="md:col-span-2"><span className="font-semibold">Notes:</span> {activeSelectedEquipment.notes || '-'}</p>
              </div>
            </div>

            {equipmentStatusError && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {equipmentStatusError}
              </div>
            )}

            {reportError && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {reportError}
              </div>
            )}

            {canEditReports && (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => {
                    setReportForm(buildEmptyReportForm())
                    setShowCreateReportForm(true)
                  }}
                  className="rounded-md border border-[#123A7A] bg-white px-3 py-2 text-sm font-semibold text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
                >
                  Create New Report
                </button>
              </div>
            )}


            <div className="mt-6 overflow-hidden rounded-xl border border-slate-200">
              {isMobileViewport && (
                <div className="space-y-3 p-3">
                {reportsLoading ? (
                  <p className="text-sm text-slate-500">Loading reports...</p>
                ) : reports.length === 0 ? (
                  <p className="text-sm text-slate-500">No reports have been submitted for this equipment.</p>
                ) : (
                  reports.map((report) => (
                    <article key={report.id} className="rounded-lg border border-slate-200 bg-white p-3">
                      {(() => {
                        const isExpandedReportCard = String(expandedReportCardId) === String(report.id)
                        return (
                          <>
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-bold text-slate-800">{report.title || 'Untitled report'}</h3>
                        <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                          {report.status || '-'}
                        </span>
                      </div>
                      <div className="mt-2 grid gap-1 text-xs text-slate-600">
                        <p><span className="font-semibold text-slate-700">Date:</span> {report.report_date || '-'}</p>
                        <div
                          className={`overflow-hidden transition-all duration-300 ease-out ${
                            isExpandedReportCard ? 'max-h-32 opacity-100' : 'max-h-0 opacity-0'
                          }`}
                          aria-hidden={!isExpandedReportCard}
                        >
                          <div className="grid gap-1 pt-1">
                            <p><span className="font-semibold text-slate-700">Inspector:</span> {report.submitted_by_name || '-'}</p>
                            <p><span className="font-semibold text-slate-700">Summary:</span> {report.summary || '-'}</p>
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedReportCardId((current) =>
                              String(current) === String(report.id) ? '' : String(report.id)
                            )
                          }
                          className="inline-flex items-center gap-1 rounded border border-slate-300 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700 transition hover:border-slate-400"
                        >
                          <span
                            className={`transition-transform duration-300 ease-out ${
                              isExpandedReportCard ? 'rotate-180' : 'rotate-0'
                            }`}
                            aria-hidden="true"
                          >
                            ▾
                          </span>
                          {isExpandedReportCard ? 'Less details' : 'More details'}
                        </button>
                        <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => setViewedReport(report)}
                          className="rounded border border-[#123A7A] px-2 py-1 text-xs font-semibold text-[#123A7A]"
                        >
                          View
                        </button>
                        </div>
                      </div>
                          </>
                        )
                      })()}
                    </article>
                  ))
                )}
                </div>
              )}

              {!isMobileViewport && (
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
                      reports.map((report) => {
                        const statusBadge = getReportStatusBadge(report.status)
                        return (
                          <tr key={report.id} className="border-t border-slate-200 odd:bg-white even:bg-slate-50/60">
                            <td className="px-4 py-3 font-semibold text-slate-800">{report.title}</td>
                            <td className="px-4 py-3 text-slate-700">{report.report_date}</td>
                            <td className="px-4 py-3">
                              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${statusBadge.color}`}>
                                {statusBadge.label}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-slate-700">{report.submitted_by_name || '-'}</td>
                            <td className="px-4 py-3 text-slate-700">{report.summary || '-'}</td>
                            <td className="px-4 py-3 text-slate-700">
                              <button
                                type="button"
                                onClick={() => setViewedReport(report)}
                                className="rounded border border-[#123A7A] px-2 py-1 text-xs font-semibold text-[#123A7A]"
                              >
                                View
                              </button>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
                </div>
              )}
            </div>
          </section>
        )}

        {isOwner && showCreateCustomerForm && (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 pb-6 pt-24 sm:items-center sm:pt-6"
            onClick={() => setShowCreateCustomerForm(false)}
          >
            <form
              className="max-h-[calc(100vh-7rem)] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:max-h-[calc(100vh-3rem)]"
              onSubmit={handleCreateCustomer}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold text-[#123A7A]">Add New Customer</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    Create a new customer company and their portal login.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCreateCustomerForm(false)}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700"
                >
                  Close
                </button>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="text-sm font-semibold text-slate-700">
                  Company Name
                  <input
                    type="text"
                    value={customerForm.company_name}
                    onChange={(event) =>
                      setCustomerForm((current) => ({ ...current, company_name: event.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    required
                  />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Company Email
                  <input
                    type="email"
                    value={customerForm.company_contact_email}
                    onChange={(event) =>
                      setCustomerForm((current) => ({ ...current, company_contact_email: event.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Company Phone
                  <input
                    type="text"
                    value={customerForm.company_contact_phone}
                    onChange={(event) =>
                      setCustomerForm((current) => ({ ...current, company_contact_phone: event.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-sm font-semibold text-slate-700 md:col-span-2">
                  Company Address
                  <input
                    type="text"
                    value={customerForm.company_address}
                    onChange={(event) =>
                      setCustomerForm((current) => ({ ...current, company_address: event.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Customer Username
                  <input
                    type="text"
                    value={customerForm.customer_username}
                    onChange={(event) =>
                      setCustomerForm((current) => ({ ...current, customer_username: event.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    required
                  />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Customer Email
                  <input
                    type="email"
                    value={customerForm.customer_email}
                    onChange={(event) =>
                      setCustomerForm((current) => ({ ...current, customer_email: event.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    required
                  />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Customer First Name
                  <input
                    type="text"
                    value={customerForm.customer_first_name}
                    onChange={(event) =>
                      setCustomerForm((current) => ({ ...current, customer_first_name: event.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Customer Last Name
                  <input
                    type="text"
                    value={customerForm.customer_last_name}
                    onChange={(event) =>
                      setCustomerForm((current) => ({ ...current, customer_last_name: event.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-sm font-semibold text-slate-700 md:max-w-md">
                  Temporary Password
                  <input
                    type="password"
                    value={customerForm.customer_password}
                    onChange={(event) =>
                      setCustomerForm((current) => ({ ...current, customer_password: event.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    minLength={8}
                    required
                  />
                </label>
              </div>

              <button
                type="submit"
                disabled={creatingCustomer}
                className="mt-4 rounded-md bg-[#123A7A] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f3168] disabled:opacity-70"
              >
                {creatingCustomer ? 'Creating customer...' : 'Create Customer'}
              </button>
            </form>
          </div>
        )}

        {isOwner && showCreateEmployeeForm && (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 pb-6 pt-24 sm:items-center sm:pt-6"
            onClick={() => setShowCreateEmployeeForm(false)}
          >
            <form
              className="max-h-[calc(100vh-7rem)] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:max-h-[calc(100vh-3rem)]"
              onSubmit={handleCreateEmployeeAssignment}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold text-[#123A7A]">Add Employee</h3>
                  <p className="mt-1 text-sm text-slate-600">Create a new portal employee account and assign access.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCreateEmployeeForm(false)}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700"
                >
                  Close
                </button>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="text-sm font-semibold text-slate-700">
                  Username (Auto-generated)
                  <input
                    type="text"
                    value={generatedEmployeeUsername}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    placeholder="a_surn"
                    readOnly
                  />
                  <p className="mt-1 text-xs font-normal text-slate-500">
                    Format: first letter of first name + underscore + first 4 letters of surname. A number is appended automatically if needed.
                  </p>
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Email
                  <input
                    type="email"
                    value={employeeForm.email}
                    onChange={(event) => setEmployeeForm((current) => ({ ...current, email: event.target.value }))}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    required
                  />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  First Name
                  <input
                    type="text"
                    value={employeeForm.first_name}
                    onChange={(event) => setEmployeeForm((current) => ({ ...current, first_name: event.target.value }))}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    required
                  />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Last Name
                  <input
                    type="text"
                    value={employeeForm.last_name}
                    onChange={(event) => setEmployeeForm((current) => ({ ...current, last_name: event.target.value }))}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    required
                  />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Temporary Password
                  <input
                    type="password"
                    value={employeeForm.password}
                    onChange={(event) => setEmployeeForm((current) => ({ ...current, password: event.target.value }))}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    required
                  />
                </label>
                <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
                  Employee Type
                  <select
                    value={employeeForm.role}
                    onChange={(event) => setEmployeeForm((current) => ({ ...current, role: event.target.value }))}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="engineer">Engineer</option>
                    <option value="office_staff">Office</option>
                  </select>
                </label>
                <div className="text-sm font-semibold text-slate-700 md:col-span-2">
                  Allowed Companies
                  <div className="mt-2 max-h-44 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-2">
                    <div className="flex flex-wrap gap-2">
                    {companies.map((companyItem) => {
                      const checked = employeeForm.allowed_company_ids.includes(companyItem.id)
                      return (
                        <label
                          key={`create-${companyItem.id}`}
                          className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) =>
                              setEmployeeForm((current) => {
                                if (event.target.checked) {
                                  return {
                                    ...current,
                                    allowed_company_ids: [...new Set([...current.allowed_company_ids, companyItem.id])],
                                  }
                                }
                                return {
                                  ...current,
                                  allowed_company_ids: current.allowed_company_ids.filter((id) => id !== companyItem.id),
                                }
                              })
                            }
                          />
                          <span>{companyItem.name}</span>
                        </label>
                      )
                    })}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  type="submit"
                  disabled={creatingStaffAssignment}
                  className="rounded-md bg-[#123A7A] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f3168] disabled:opacity-70"
                >
                  {creatingStaffAssignment ? 'Creating...' : 'Create Employee'}
                </button>
              </div>
            </form>
          </div>
        )}

        {isOwner && companyPickerUserId && activeCompanyPickerAssignment && (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 pb-6 pt-24 sm:items-center sm:pt-6"
            onClick={() => {
              setCompanyPickerUserId('')
              setCompanyPickerSearchInput('')
            }}
          >
            <div
              className="max-h-[calc(100vh-7rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:max-h-[calc(100vh-3rem)]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold text-[#123A7A]">Edit Company Access</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    {activeCompanyPickerAssignment.username} can access selected companies.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCompanyPickerUserId('')
                    setCompanyPickerSearchInput('')
                  }}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700"
                >
                  Close
                </button>
              </div>

              <div className="mt-4">
                <input
                  type="search"
                  value={companyPickerSearchInput}
                  onChange={(event) => setCompanyPickerSearchInput(event.target.value)}
                  placeholder="Search companies"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-[#123A7A]"
                />
              </div>

              <div className="mt-4 max-h-80 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3">
                {filteredCompanyPickerCompanies.length === 0 ? (
                  <p className="text-sm text-slate-500">No companies match your search.</p>
                ) : (
                  <div className="space-y-2">
                    {filteredCompanyPickerCompanies.map((companyItem) => {
                      const checked = (activeCompanyPickerAssignment.allowed_company_ids || []).includes(companyItem.id)
                      return (
                        <label
                          key={`picker-${activeCompanyPickerAssignment.user_id}-${companyItem.id}`}
                          className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                        >
                          <span>{companyItem.name}</span>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) =>
                              setStaffAssignments((current) =>
                                current.map((item) => {
                                  if (String(item.user_id) !== String(activeCompanyPickerAssignment.user_id)) {
                                    return item
                                  }
                                  const existing = item.allowed_company_ids || []
                                  if (event.target.checked) {
                                    return {
                                      ...item,
                                      allowed_company_ids: [...new Set([...existing, companyItem.id])],
                                    }
                                  }
                                  return {
                                    ...item,
                                    allowed_company_ids: existing.filter((id) => id !== companyItem.id),
                                  }
                                }),
                              )
                            }
                          />
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => handleSaveEmployeeAssignment(activeCompanyPickerAssignment)}
                  disabled={savingStaffUserId === Number(activeCompanyPickerAssignment.user_id)}
                  className="rounded-md border border-[#123A7A] bg-white px-4 py-2 text-sm font-semibold text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingStaffUserId === Number(activeCompanyPickerAssignment.user_id)
                    ? 'Saving...'
                    : 'Save Permissions'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCompanyPickerUserId('')
                    setCompanyPickerSearchInput('')
                  }}
                  className="rounded-md bg-slate-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {canEditReports && showCreateEquipmentForm && (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 pb-6 pt-24 sm:items-center sm:pt-6"
            onClick={() => setShowCreateEquipmentForm(false)}
          >
            <form
              className="max-h-[calc(100vh-7rem)] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:max-h-[calc(100vh-3rem)]"
              onSubmit={handleCreateEquipment}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-bold text-[#123A7A]">Add Equipment</h3>
                <button
                  type="button"
                  onClick={() => setShowCreateEquipmentForm(false)}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700"
                >
                  Close
                </button>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="text-sm font-semibold text-slate-700">
                  Name
                  <input
                    type="text"
                    value={equipmentForm.name}
                    onChange={(event) => setEquipmentForm((current) => ({ ...current, name: event.target.value }))}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    required
                  />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Asset Tag
                  <input
                    type="text"
                    value={equipmentForm.asset_tag}
                    onChange={(event) =>
                      setEquipmentForm((current) => ({ ...current, asset_tag: event.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Serial Number
                  <input
                    type="text"
                    value={equipmentForm.serial_number}
                    onChange={(event) =>
                      setEquipmentForm((current) => ({ ...current, serial_number: event.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Location
                  <input
                    type="text"
                    value={equipmentForm.location}
                    onChange={(event) =>
                      setEquipmentForm((current) => ({ ...current, location: event.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Status
                  <select
                    value={equipmentForm.status}
                    onChange={(event) =>
                      setEquipmentForm((current) => ({ ...current, status: event.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="retired">Retired</option>
                  </select>
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Inspection Interval (days)
                  <input
                    type="number"
                    min={1}
                    value={equipmentForm.inspection_interval_days}
                    onChange={(event) =>
                      setEquipmentForm((current) => ({ ...current, inspection_interval_days: event.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Last Inspected
                  <input
                    type="date"
                    value={equipmentForm.last_inspected_at}
                    onChange={(event) =>
                      setEquipmentForm((current) => ({ ...current, last_inspected_at: event.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 md:col-span-2">
                  <span className="font-semibold text-slate-800">Next Inspection Due Preview:</span>{' '}
                  {equipmentNextDuePreview || 'Set a last inspected date to see the calculated due date.'}
                </div>
                <label className="text-sm font-semibold text-slate-700 md:col-span-2">
                  Notes
                  <textarea
                    value={equipmentForm.notes}
                    onChange={(event) => setEquipmentForm((current) => ({ ...current, notes: event.target.value }))}
                    className="mt-1 min-h-20 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
              </div>

              <button
                type="submit"
                disabled={creatingEquipment}
                className="mt-4 rounded-md bg-[#123A7A] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f3168] disabled:opacity-70"
              >
                {creatingEquipment ? 'Creating equipment...' : 'Create Equipment'}
              </button>
            </form>
          </div>
        )}

        {canEditReports && showCreateReportForm && (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 pb-6 pt-24 sm:items-center sm:pt-6"
            onClick={() => {
              setShowCreateReportForm(false)
              setReportForm(buildEmptyReportForm())
            }}
          >
            <form
              className="max-h-[calc(100vh-7rem)] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:max-h-[calc(100vh-3rem)]"
              onSubmit={handleCreateReport}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-bold text-[#123A7A]">Create New Report</h3>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateReportForm(false)
                    setReportForm(buildEmptyReportForm())
                  }}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700"
                >
                  Close
                </button>
              </div>
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
                    {reportStatusOptions().map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-semibold text-slate-700 md:col-span-2">
                  Images
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(event) =>
                      setReportForm((current) => ({
                        ...current,
                        images: Array.from(event.target.files || []),
                      }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                  {reportForm.images.length > 0 && (
                    <p className="mt-1 text-xs text-slate-500">{reportForm.images.length} image(s) selected</p>
                  )}
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
          </div>
        )}

        {viewedReport && (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 pb-6 pt-24 sm:items-center sm:pt-6"
            onClick={() => setViewedReport(null)}
          >
            <div
              className="max-h-[calc(100vh-7rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:max-h-[calc(100vh-3rem)]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#C61F2A]">Report Details</p>
                  <h3 className="mt-1 text-xl font-extrabold text-[#123A7A]">{viewedReport.title || 'Untitled Report'}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setViewedReport(null)}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700"
                >
                  Close
                </button>
              </div>

              <div className="mt-4 grid gap-2 text-sm text-slate-700 md:grid-cols-2">
                <p><span className="font-semibold">Date:</span> {viewedReport.report_date || '-'}</p>
                <p><span className="font-semibold">Status:</span> {viewedReport.status || '-'}</p>
                <p><span className="font-semibold">Inspector:</span> {viewedReport.submitted_by_name || '-'}</p>
                <p><span className="font-semibold">Report ID:</span> {viewedReport.id}</p>
                <p className="md:col-span-2"><span className="font-semibold">Summary:</span> {viewedReport.summary || '-'}</p>
                <p className="md:col-span-2"><span className="font-semibold">Findings:</span> {viewedReport.findings || '-'}</p>
                <p className="md:col-span-2"><span className="font-semibold">Recommendations:</span> {viewedReport.recommendations || '-'}</p>
              </div>

              {Array.isArray(viewedReport.images) && viewedReport.images.length > 0 && (
                <div className="mt-5">
                  <p className="text-sm font-semibold text-slate-700">Images</p>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {viewedReport.images.map((image) => (
                      <button
                        key={image.id}
                        type="button"
                        onClick={() => handleOpenReportImage(image, viewedReport.images)}
                        className="group block overflow-hidden rounded-md border border-slate-200 text-left"
                      >
                        <img
                          src={image.image_url}
                          alt="Report attachment"
                          className="h-24 w-full object-cover transition group-hover:scale-105"
                          loading="lazy"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-5 flex flex-wrap justify-end gap-2">
                {isOwner && viewedReport.status === 'submitted' && (
                  <button
                    type="button"
                    onClick={handleApproveViewedReport}
                    disabled={approvingReport}
                    className="rounded border border-emerald-300 bg-emerald-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {approvingReport ? 'Approving...' : 'Approve Report'}
                  </button>
                )}
                {isOwner && (
                  <button
                    type="button"
                    onClick={() => handleLoadRevisions(viewedReport.id)}
                    className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-700 transition hover:bg-slate-100"
                  >
                    Revisions
                  </button>
                )}
                {canEditReport(viewedReport) && (
                  <button
                    type="button"
                    onClick={() => handleStartEdit(viewedReport)}
                    className="rounded border border-[#123A7A] bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
                  >
                    Edit Report
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {selectedReportImage && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 px-4 py-6"
            onClick={handleCloseReportImage}
          >
            <div
              className="w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#C61F2A]">Image Preview</p>
                  <p className="text-sm text-slate-600">
                    {Array.isArray(selectedReportImage.images) && selectedReportImage.images.length > 0
                      ? `Image ${selectedReportImage.images.findIndex(
                          (image) => String(image.id) === String(selectedReportImage.image?.id),
                        ) + 1} of ${selectedReportImage.images.length}`
                      : 'Image preview'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleMoveReportImage(-1)}
                    disabled={
                      !selectedReportImage ||
                      !Array.isArray(selectedReportImage.images) ||
                      selectedReportImage.images.findIndex(
                        (image) => String(image.id) === String(selectedReportImage.image?.id),
                      ) <= 0
                    }
                    className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMoveReportImage(1)}
                    disabled={
                      !selectedReportImage ||
                      !Array.isArray(selectedReportImage.images) ||
                      selectedReportImage.images.findIndex(
                        (image) => String(image.id) === String(selectedReportImage.image?.id),
                      ) >= selectedReportImage.images.length - 1
                    }
                    className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                  </button>
                  <button
                    type="button"
                    onClick={handleCloseReportImage}
                    className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700"
                  >
                    Close
                  </button>
                </div>
              </div>
              <div className="bg-slate-100">
                <img
                  src={selectedReportImage.image?.image_url}
                  alt="Report preview"
                  className="max-h-[75vh] w-full object-contain"
                />
              </div>
            </div>
          </div>
        )}

        {showEditReportModal && (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 pb-6 pt-24 sm:items-center sm:pt-6"
            onClick={handleCancelEdit}
          >
            <div
              className="max-h-[calc(100vh-7rem)] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:max-h-[calc(100vh-3rem)]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-bold text-[#123A7A]">Edit Report</h3>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700"
                >
                  Close
                </button>
              </div>
              <form className="mt-4" onSubmit={handleCreateReport}>
                <div className="grid gap-3 md:grid-cols-2">
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
                      {reportStatusOptions().map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm font-semibold text-slate-700 md:col-span-2">
                    Add Images
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(event) =>
                        setReportForm((current) => ({
                          ...current,
                          images: Array.from(event.target.files || []),
                        }))
                      }
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                    {reportForm.images.length > 0 && (
                      <p className="mt-1 text-xs text-slate-500">{reportForm.images.length} image(s) selected</p>
                    )}
                  </label>
                  {reportForm.existingImages.length > 0 && (
                    <div className="md:col-span-2">
                      <p className="text-sm font-semibold text-slate-700">Current Images</p>
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {reportForm.existingImages.map((image) => (
                          <div
                            key={image.id}
                            className="group relative overflow-hidden rounded-md border border-slate-200 bg-slate-50"
                          >
                            <button
                              type="button"
                              onClick={() => handleOpenReportImage(image, reportForm.existingImages)}
                              className="block w-full"
                            >
                              <img
                                src={image.image_url}
                                alt="Report attachment"
                                className="h-24 w-full object-cover transition group-hover:scale-105"
                                loading="lazy"
                              />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveReportImage(image.id)}
                              className="absolute right-2 top-2 rounded-full bg-white/95 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-rose-700 shadow-sm transition hover:bg-white"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                      {reportForm.removedImageIds.length > 0 && (
                        <p className="mt-2 text-xs text-slate-500">
                          {reportForm.removedImageIds.length} image(s) marked for removal.
                        </p>
                      )}
                    </div>
                  )}
                </div>
                <div className="mt-4 flex justify-end">
                  <button
                    type="submit"
                    disabled={savingReportEdit}
                    className="rounded-md bg-[#123A7A] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f3168] disabled:opacity-70"
                  >
                    {savingReportEdit ? 'Saving...' : 'Save Report'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {showRevisionsModal && (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 pb-6 pt-24 sm:items-center sm:pt-6"
            onClick={() => {
              setShowRevisionsModal(false)
              setRevisionReportId('')
              setReportRevisions([])
            }}
          >
            <div
              className="max-h-[calc(100vh-7rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:max-h-[calc(100vh-3rem)]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-bold text-[#123A7A]">Revision History</h3>
                <button
                  type="button"
                  onClick={() => {
                    setShowRevisionsModal(false)
                    setRevisionReportId('')
                    setReportRevisions([])
                  }}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700"
                >
                  Close
                </button>
              </div>
              {revisionsLoading ? (
                <p className="mt-2 text-sm text-slate-500">Loading revisions...</p>
              ) : reportRevisions.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">No revisions recorded yet for this report.</p>
              ) : (
                <ul className="mt-3 space-y-2 text-sm text-slate-700">
                  {reportRevisions.map((revision) => (
                    <li key={revision.id} className="rounded border border-slate-200 bg-white p-3">
                      <p className="font-semibold text-slate-800">
                        {revision.edited_by_name || 'Unknown user'}
                        {' '}
                        <span className="text-slate-400">-</span>
                        {' '}
                        <span className="font-medium text-slate-600">
                          {formatRevisionDateTime(revision.changed_at)}
                        </span>
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
          </div>
        )}

        {showDecommissionConfirm && activeSelectedEquipment && (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 pb-6 pt-24 sm:items-center sm:pt-6"
            onClick={() => setShowDecommissionConfirm(false)}
          >
            <div
              className="max-h-[calc(100vh-7rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:max-h-[calc(100vh-3rem)]"
              onClick={(event) => event.stopPropagation()}
            >
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#C61F2A]">Confirm Action</p>
              <h3 className="mt-2 text-xl font-extrabold text-[#123A7A]">Decommission Equipment?</h3>
              <p className="mt-3 text-sm text-slate-600">
                This will move
                {' '}
                <span className="font-semibold text-slate-800">{activeSelectedEquipment.name}</span>
                {' '}
                into the decommissioned tab. You can reactivate it later from that tab if this was accidental.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowDecommissionConfirm(false)}
                  className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-700 transition hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDecommission}
                  disabled={updatingEquipmentStatus}
                  className="rounded border border-[#C61F2A] bg-[#C61F2A] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white transition hover:bg-[#a91923] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Yes, Decommission
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </PortalLayout>
  )
}
