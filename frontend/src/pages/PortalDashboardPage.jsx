import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import CustomerListSection from '../components/CustomerListSection'
import EmployeeControlsSection from '../components/EmployeeControlsSection'
import EquipmentTableSection from '../components/EquipmentTableSection'
import Modal from '../components/Modal'
import PaginationControls from '../components/PaginationControls'
import PortalToast from '../components/PortalToast'
import PendingApprovalsSection from '../components/PendingApprovalsSection'
import PortalLayout from '../components/PortalLayout'
import {
  CompanyProfileSkeleton,
  CertificatesSkeleton,
  ReportsSkeleton,
  EquipmentActivitySkeleton,
} from '../components/PortalLoadingSkeletons'
import usePageMeta from '../utils/usePageMeta'
import { exportRowsToCsv } from '../utils/csvExport'
import {
  changePortalPassword,
  createPortalSite,
  createStaffAssignment,
  deleteEquipmentCertificate,
  deleteStaffAssignment,
  downloadCertificate,
  reactivateStaffAssignment,
  createPortalCustomer,
  createPortalEquipment,
  clearPortalSession,
  createEquipmentReport,
  deleteReport,
  getEquipmentActivity,
  getEquipmentReports,
  getPortalCompanies,
  getPortalCompanyHeader,
  getPortalDashboardStats,
  getPortalEquipment,
  getPortalMe,
  getSiteCertificates,
  getAccessToken,
  getPendingReportApprovals,
  generateSiteCertificates,
  recoverEquipmentCertificate,
  recoverReport,
  getReportRevisions,
  getStaffAssignments,
  hasPortalSession,
  portalLogout,
  refreshPortalSession,
  deletePortalSite,
  updatePortalCustomer,
  updatePortalSite,
  updateStaffAssignment,
  updateReport,
  updatePortalEquipment,
} from '../utils/portalApi'

const SESSION_WARNING_WINDOW_MS = 2 * 60 * 1000
const SESSION_WARNING_CHECK_INTERVAL_MS = 15 * 1000
const REPORT_DRAFT_STORAGE_KEY = 'manley-portal-report-draft-v1'
const EQID_SYNC_DEBUG_STORAGE_KEY = 'manley-debug-eqid-sync'
let cachedEqIdSyncDebugEnabled = null
const REPORT_CHECKLIST_STATUS_GOOD = 'good_order'
const REPORT_CHECKLIST_STATUS_WORN = 'worn_serviceable'
const REPORT_CHECKLIST_STATUS_ATTENTION = 'attention_required'
const REPORT_CHECKLIST_STATUS_NOT_PRESENTED = 'not_presented'
const NOT_PRESENTED_DEFAULT_SUMMARY = 'Equipment was not presented for inspection at the time of visit.'
const EQUIPMENT_STATUS_FILTER_ALL = 'all'
const EQUIPMENT_STATUS_FILTER_GOOD = 'good_order'
const EQUIPMENT_STATUS_FILTER_WORN = 'worn_serviceable'
const EQUIPMENT_STATUS_FILTER_ATTENTION = 'attention_required'
const EQUIPMENT_STATUS_FILTER_NOT_PRESENTED = 'not_presented'
const EQUIPMENT_STATUS_FILTER_NO_REPORT = 'no_approved_report'
const portalQueryKeys = {
  profile: () => ['portal-profile'],
  companies: () => ['portal-companies'],
  companyHeader: (companyId = '') => ['portal-company-header', String(companyId || '')],
  equipment: ({ companyId = '', siteId = '', search = '' } = {}) => [
    'portal-equipment',
    String(companyId || ''),
    String(siteId || ''),
    String(search || ''),
  ],
  equipmentRoot: () => ['portal-equipment'],
  reports: (equipmentId = '') => ['portal-reports', String(equipmentId || '')],
  reportsRoot: () => ['portal-reports'],
  equipmentActivity: (equipmentId = '') => ['portal-equipment-activity', String(equipmentId || '')],
  equipmentActivityRoot: () => ['portal-equipment-activity'],
  generatedCertificates: (siteId = '') => ['portal-generated-certificates', String(siteId || '')],
  generatedCertificatesRoot: () => ['portal-generated-certificates'],
  pendingApprovals: (role = '') => ['portal-pending-approvals', String(role || '')],
  pendingApprovalsRoot: () => ['portal-pending-approvals'],
  dashboardStats: (role = '') => ['portal-dashboard-stats', String(role || '')],
  dashboardStatsRoot: () => ['portal-dashboard-stats'],
  staffAssignments: (status = '') => ['portal-staff-assignments', String(status || '')],
  staffAssignmentsRoot: () => ['portal-staff-assignments'],
}
const REPORT_SUBMISSION_CONFIRMATION_ITEMS = [
  'We have undertaken the test / thorough examination as prescribed.',
  'We have identified defects which are or could be a danger to persons.',
  'This test/thorough examination has been carried out by a competent person.',
  'The particulars in this report of thorough examination are correct.',
]
const REPORT_TEMPLATE_CHECKLIST_LABELS = [
  'Initial Test Run',
  'Isolator',
  'Pendant Cable Box',
  'Pendant Suspension & Terminators',
  'Conducts & Cables',
  'Hoist Control Gear',
  'Travel Control Gear',
  'Traverse Control Gear',
  'Downshop Conductors',
  'Travel Wheels',
  'Travel Gears',
  'Travel Brakes',
  'Travel Motors',
  'Travel Gearbox/Oil Level',
  'Travel Bearings',
  'Travel Limits/Stops',
  'Traverse Wheels',
  'Traverse Gears',
  'Traverse Brakes',
  'Traverse Gear/Oil Level',
  'Traverse Motor',
  'Traverse Bearings - Bushes',
  'Traverse Limits / Stops',
  'Travel Buffers',
  'Anti Collision',
  'Pendant Controls',
  'Remote Control',
  'Slipping Clutch/Adjustment',
  'Hoist Ropes',
  'Rope Guide & Pressure Band',
  'Return Sheave',
  'Bottom Block & Hook',
  'Hoist Motor',
  'Hoist Brake',
  'Hoist Gearbox/Oil Level',
  'Hoist Limits',
  'Hoist Bearing - Bushes',
  'General Structure',
  'Crane Platforms',
  'Rail',
  'Load Chain',
  'Load Sprocket',
  'Chain Guide',
  'Chain Anchor Suspension',
  'Suspension Hook / Eye',
  'Suspension Pins / Bolts',
  'Over Load Limiting Device',
  'Over Load Protection',
  'Control Panel',
  'Cooling Fan/Cover',
]

function buildDefaultReportChecklistItems() {
  return REPORT_TEMPLATE_CHECKLIST_LABELS.map((label) => ({
    label,
    status: REPORT_CHECKLIST_STATUS_GOOD,
    finding: '',
    recommendation: '',
    days_before_reinspection: '',
  }))
}

function normalizeReportChecklistItems(items) {
  const incomingItems = Array.isArray(items) ? items : []
  const byLabel = new Map(
    incomingItems
      .map((item) => {
        if (!item || typeof item !== 'object') return null
        return [String(item.label || '').trim(), item]
      })
      .filter(Boolean),
  )

  return REPORT_TEMPLATE_CHECKLIST_LABELS.map((label) => {
    const existing = byLabel.get(label)
    const status = String(existing?.status || REPORT_CHECKLIST_STATUS_GOOD).trim()
    const normalizedStatus = [
      REPORT_CHECKLIST_STATUS_GOOD,
      REPORT_CHECKLIST_STATUS_WORN,
      REPORT_CHECKLIST_STATUS_ATTENTION,
      REPORT_CHECKLIST_STATUS_NOT_PRESENTED,
    ].includes(status)
      ? status
      : REPORT_CHECKLIST_STATUS_GOOD

    return {
      label,
      status: normalizedStatus,
      finding: String(existing?.finding ?? existing?.note ?? ''),
      recommendation: String(existing?.recommendation ?? ''),
      days_before_reinspection: String(existing?.days_before_reinspection ?? ''),
    }
  })
}

function getChecklistStatusLabel(status) {
  if (status === REPORT_CHECKLIST_STATUS_WORN) return 'Worn but Servicable'
  if (status === REPORT_CHECKLIST_STATUS_ATTENTION) return 'Attention Required'
  if (status === REPORT_CHECKLIST_STATUS_NOT_PRESENTED) return 'Not Presented'
  return 'Good Order'
}

function getChecklistSections(items) {
  const normalized = normalizeReportChecklistItems(items)
  return {
    worn: normalized.filter((item) => item.status === REPORT_CHECKLIST_STATUS_WORN),
    attention: normalized.filter((item) => item.status === REPORT_CHECKLIST_STATUS_ATTENTION),
    notPresented: normalized.filter((item) => item.status === REPORT_CHECKLIST_STATUS_NOT_PRESENTED),
  }
}

function isChecklistMarkedNotPresented(checklistSections) {
  return (
    Array.isArray(checklistSections?.notPresented) &&
    checklistSections.notPresented.length > 0 &&
    Array.isArray(checklistSections?.worn) &&
    checklistSections.worn.length === 0 &&
    Array.isArray(checklistSections?.attention) &&
    checklistSections.attention.length === 0
  )
}

function getChecklistImagesByLabel(images) {
  const byLabel = {}
  ;(Array.isArray(images) ? images : []).forEach((image) => {
    const label = String(image?.checklist_label || '').trim()
    if (!label) return
    if (!byLabel[label]) byLabel[label] = []
    byLabel[label].push(image)
  })
  return byLabel
}

function flattenChecklistImageUploads(checklistImageFilesByLabel) {
  const entries = Object.entries(checklistImageFilesByLabel || {})
  const checklist_images = []
  const checklist_image_labels = []
  entries.forEach(([label, files]) => {
    ;(Array.isArray(files) ? files : []).filter(Boolean).forEach((file) => {
      checklist_images.push(file)
      checklist_image_labels.push(label)
    })
  })
  return { checklist_images, checklist_image_labels }
}

function getMissingChecklistDetailsError(items) {
  const normalized = normalizeReportChecklistItems(items)
  const missingFinding = normalized.find(
    (item) =>
      [REPORT_CHECKLIST_STATUS_WORN, REPORT_CHECKLIST_STATUS_ATTENTION].includes(item.status) &&
      String(item.finding || '').trim() === '',
  )
  if (missingFinding) {
    return {
      label: missingFinding.label,
      field: 'finding',
    }
  }

  const missingRecommendation = normalized.find(
    (item) =>
      [REPORT_CHECKLIST_STATUS_WORN, REPORT_CHECKLIST_STATUS_ATTENTION].includes(item.status) &&
      String(item.recommendation || '').trim() === '',
  )
  if (missingRecommendation) {
    return {
      label: missingRecommendation.label,
      field: 'recommendation',
    }
  }

  return null
}

function buildReportSnapshot(source) {
  return {
    title: String(source?.title || ''),
    summary: String(source?.summary || ''),
    findings: String(source?.findings || ''),
    recommendations: String(source?.recommendations || ''),
    report_date: String(source?.report_date || ''),
    status: String(source?.status || ''),
    checklist_items: normalizeReportChecklistItems(source?.checklist_items),
  }
}

function getChecklistChangeRows(beforeItems, afterItems) {
  const beforeByLabel = new Map(
    normalizeReportChecklistItems(beforeItems).map((item) => [item.label, item]),
  )
  const afterByLabel = new Map(
    normalizeReportChecklistItems(afterItems).map((item) => [item.label, item]),
  )

  return REPORT_TEMPLATE_CHECKLIST_LABELS
    .map((label) => {
      const before = beforeByLabel.get(label) || {
        label,
        status: REPORT_CHECKLIST_STATUS_GOOD,
        finding: '',
        recommendation: '',
      }
      const after = afterByLabel.get(label) || {
        label,
        status: REPORT_CHECKLIST_STATUS_GOOD,
        finding: '',
        recommendation: '',
        days_before_reinspection: '',
      }

      if (
        String(before.status) === String(after.status) &&
        String(before.finding || '') === String(after.finding || '') &&
        String(before.recommendation || '') === String(after.recommendation || '')
      ) {
        return null
      }

      return {
        label,
        beforeStatus: before.status,
        afterStatus: after.status,
        beforeFinding: String(before.finding || ''),
        afterFinding: String(after.finding || ''),
        beforeRecommendation: String(before.recommendation || ''),
        afterRecommendation: String(after.recommendation || ''),
          beforeDaysBeforeReinspection: String(before.days_before_reinspection || ''),
          afterDaysBeforeReinspection: String(after.days_before_reinspection || ''),
      }
    })
    .filter(Boolean)
}

function getRevisionFieldChanges(beforeSnapshot, afterSnapshot) {
  const fieldDefinitions = [
    { key: 'title', label: 'Title' },
    { key: 'summary', label: 'Summary' },
    { key: 'findings', label: 'Findings' },
    { key: 'recommendations', label: 'Recommendations' },
    { key: 'report_date', label: 'Report Date' },
    { key: 'status', label: 'Status' },
  ]

  const fieldChanges = fieldDefinitions
    .map(({ key, label }) => {
      const beforeValue = String(beforeSnapshot?.[key] || '')
      const afterValue = String(afterSnapshot?.[key] || '')
      if (beforeValue === afterValue) return null
      return {
        key,
        label,
        beforeValue,
        afterValue,
      }
    })
    .filter(Boolean)

  return {
    fieldChanges,
    checklistChanges: getChecklistChangeRows(beforeSnapshot?.checklist_items, afterSnapshot?.checklist_items),
  }
}

const ReportChecklistEditor = memo(function ReportChecklistEditor({
  checklistItems,
  onChange,
  onApplyNotPresentedPreset,
  pendingChecklistImagesByLabel,
  existingChecklistImagesByLabel,
  onAddChecklistItemImages,
  onRemovePendingChecklistItemImage,
  onOpenChecklistItemImage,
}) {
  const [localItems, setLocalItems] = useState(() => normalizeReportChecklistItems(checklistItems))

  useEffect(() => {
    setLocalItems(normalizeReportChecklistItems(checklistItems))
  }, [checklistItems])

  function updateLocalItem(index, patch) {
    setLocalItems((current) => {
      const nextItems = normalizeReportChecklistItems(current)
      nextItems[index] = {
        ...nextItems[index],
        ...patch,
      }
      return nextItems
    })
  }

  function updateStatus(index, status) {
    const nextItems = normalizeReportChecklistItems(localItems)
    nextItems[index] = {
      ...nextItems[index],
      status,
    }
    setLocalItems(nextItems)
    onChange(nextItems)
  }

  function commitDetails() {
    onChange(localItems)
  }

  return (
    <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3 md:col-span-2">
      <div className="mb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-bold text-[#123A7A]">Inspection Template Checklist</h4>
          <button
            type="button"
            onClick={onApplyNotPresentedPreset}
            className="rounded border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-rose-700 transition hover:bg-rose-100"
          >
            Mark Not Presented
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-600">
          Mark each check item. Findings and recommendations are required for Worn but Servicable and Attention Required.
        </p>
      </div>

      <div className="space-y-3">
        {localItems.map((item, index) => {
          const needsDetails = [REPORT_CHECKLIST_STATUS_WORN, REPORT_CHECKLIST_STATUS_ATTENTION].includes(item.status)

          return (
            <div key={item.label} className="rounded-md border border-slate-200 bg-white p-3">
              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_220px] md:items-start">
                <p className="text-sm font-semibold text-slate-800">{item.label}</p>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Condition
                  <select
                    value={item.status}
                    onChange={(event) => updateStatus(index, event.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  >
                    <option value={REPORT_CHECKLIST_STATUS_GOOD}>Good Order</option>
                    <option value={REPORT_CHECKLIST_STATUS_WORN}>Worn but Servicable</option>
                    <option value={REPORT_CHECKLIST_STATUS_ATTENTION}>Attention Required</option>
                    <option value={REPORT_CHECKLIST_STATUS_NOT_PRESENTED}>Not Presented</option>
                  </select>
                </label>
              </div>

              {needsDetails && (
                <label className="mt-2 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Findings (required)
                  <textarea
                    value={item.finding}
                    onChange={(event) => updateLocalItem(index, { finding: event.target.value })}
                    onBlur={commitDetails}
                    className="mt-1 min-h-16 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </label>
              )}

              {needsDetails && (
                <label className="mt-2 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Recommendations (required)
                  <textarea
                    value={item.recommendation}
                    onChange={(event) => updateLocalItem(index, { recommendation: event.target.value })}
                    onBlur={commitDetails}
                    className="mt-1 min-h-16 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </label>
              )}

              {needsDetails && (
                <label className="mt-2 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Days before reinspection
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={item.days_before_reinspection}
                    onChange={(event) => updateLocalItem(index, { days_before_reinspection: event.target.value })}
                    onBlur={commitDetails}
                    className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </label>
              )}

              {needsDetails && (
                <label className="mt-2 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Checklist Photos (optional)
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(event) => {
                      onAddChecklistItemImages(item.label, event.target.files)
                      event.target.value = ''
                    }}
                    className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  {(pendingChecklistImagesByLabel?.[item.label] || []).length > 0 && (
                    <div className="mt-2 space-y-1">
                      {(pendingChecklistImagesByLabel?.[item.label] || []).map((file, fileIndex) => (
                        <div
                          key={`${item.label}-${file.name}-${file.lastModified}-${fileIndex}`}
                          className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700"
                        >
                          <span className="truncate" title={file.name}>{file.name}</span>
                          <button
                            type="button"
                            onClick={() => onRemovePendingChecklistItemImage(item.label, fileIndex)}
                            className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-semibold uppercase tracking-wide text-slate-600"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {(existingChecklistImagesByLabel?.[item.label] || []).length > 0 && (
                    <div className="mt-2 space-y-1">
                      {(existingChecklistImagesByLabel?.[item.label] || []).map((image) => (
                        <div
                          key={`${item.label}-${image.id}`}
                          className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                        >
                          <span className="truncate">Attached image #{image.id}</span>
                          <button
                            type="button"
                            onClick={() => onOpenChecklistItemImage(image, existingChecklistImagesByLabel?.[item.label] || [])}
                            className="rounded border border-[#123A7A] bg-white px-1.5 py-0.5 font-semibold uppercase tracking-wide text-[#123A7A]"
                          >
                            View
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </label>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
})

function parsePositiveInt(value, fallback = 1) {
  const parsed = Number.parseInt(String(value || ''), 10)
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return parsed
}

function parseEnum(value, validOptions, fallback) {
  if (validOptions.includes(value)) return value
  return fallback
}

function buildStableQueryString(params) {
  const sortedEntries = Array.from(params.entries()).sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey),
  )
  return new URLSearchParams(sortedEntries).toString()
}

function isEqIdSyncDebugEnabled() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false
  if (cachedEqIdSyncDebugEnabled !== null) return cachedEqIdSyncDebugEnabled

  try {
    cachedEqIdSyncDebugEnabled = window.localStorage?.getItem(EQID_SYNC_DEBUG_STORAGE_KEY) === '1'
    return cachedEqIdSyncDebugEnabled
  } catch {
    cachedEqIdSyncDebugEnabled = false
    return false
  }
}

function logEqIdSyncDebug(eventName, data = {}) {
  if (!isEqIdSyncDebugEnabled()) return

  const timestamp = new Date().toISOString()
  console.debug(`[eqId-sync][${timestamp}] ${eventName}`, data)
}

function buildEquipmentDeepLink(companyId, equipmentId) {
  const nextEquipmentId = String(equipmentId || '').trim()
  if (!nextEquipmentId) return ''

  const params = new URLSearchParams()
  const nextCompanyId = String(companyId || '').trim()
  if (nextCompanyId) {
    params.set('companyId', nextCompanyId)
  }
  params.set('eqId', nextEquipmentId)

  const origin = typeof window !== 'undefined' ? String(window.location.origin || '').trim() : ''
  const relativePath = `/portal?${params.toString()}`
  if (!origin) return relativePath
  return `${origin}${relativePath}`
}

function printEquipmentQrLabel(title, equipmentName, equipmentAssetTag, qrDataUrl, deepLink) {
  const printWindow = window.open('', '_blank', 'width=480,height=640')
  if (!printWindow) return

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 24px; color: #0f172a; }
      .label { border: 2px solid #123A7A; border-radius: 14px; padding: 18px; max-width: 360px; }
      .badge { font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #475569; }
      h1 { margin: 6px 0 10px; font-size: 20px; color: #123A7A; }
      p { margin: 4px 0; font-size: 13px; }
      img { display: block; width: 240px; height: 240px; margin: 16px auto 10px; }
      .hint { margin-top: 8px; font-size: 11px; color: #64748b; word-break: break-all; }
      @media print {
        body { margin: 8mm; }
      }
    </style>
  </head>
  <body>
    <div class="label">
      <div class="badge">Equipment QR Label</div>
      <h1>${escapeHtml(equipmentName || 'Equipment')}</h1>
      <p><strong>Asset Tag:</strong> ${escapeHtml(equipmentAssetTag || '-')}</p>
      <img src="${escapeHtml(qrDataUrl)}" alt="Equipment QR Code" />
      <p class="hint">${escapeHtml(deepLink)}</p>
    </div>
    <script>window.onload = function () { window.print(); }<\/script>
  </body>
</html>`

  printWindow.document.open()
  printWindow.document.write(html)
  printWindow.document.close()
}

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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildPrintDocument(title, contentHtml) {
  const logoUrl = `${window.location.origin}/logo-navbar.png`
  const generatedDate = new Date().toLocaleDateString('en-IE', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: Arial, sans-serif; margin: 24px; color: #0f172a; }
      /* ── Branded header ── */
      .print-header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 14px; border-bottom: 3px solid #123A7A; margin-bottom: 20px; }
      .print-header img { height: 56px; width: auto; }
      .print-header-contact { text-align: right; font-size: 12px; color: #334155; line-height: 1.7; }
      .print-header-contact strong { display: block; font-size: 15px; color: #123A7A; letter-spacing: 0.02em; }
      /* ── Content ── */
      h1 { margin: 0 0 12px; font-size: 22px; color: #123A7A; }
      h2 { margin: 18px 0 8px; font-size: 15px; color: #123A7A; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
      p { margin: 6px 0; line-height: 1.45; }
      .meta { margin-bottom: 14px; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 6px; background: #f8fafc; font-size: 13px; }
      .meta p { margin: 4px 0; }
      .section { margin-top: 16px; }
      .card { border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px 12px; margin-top: 10px; font-size: 13px; }
      ul { margin: 8px 0 0 18px; }
      li { margin: 6px 0; }
      table { width: 100%; border-collapse: collapse; margin-top: 10px; }
      th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: left; font-size: 13px; }
      th { background: #EBF0F9; color: #123A7A; font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; }
      tr:nth-child(even) td { background: #f8fafc; }
      .muted { color: #475569; font-size: 12px; }
      /* ── Footer ── */
      .print-footer { margin-top: 32px; padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; display: flex; justify-content: space-between; }
      @media print {
        body { margin: 12mm; }
        .print-footer { position: fixed; bottom: 8mm; left: 12mm; right: 12mm; }
      }
    </style>
  </head>
  <body>
    <div class="print-header">
      <img src="${logoUrl}" alt="Manley Lifting" />
      <div class="print-header-contact">
        <strong>Manley Lifting</strong>
        Oulart, Co. Wexford, Ireland<br />
        michael@manleylifting.ie<br />
        www.manleylifting.ie
      </div>
    </div>
    ${contentHtml}
    <div class="print-footer">
      <span>Manley Lifting &mdash; www.manleylifting.ie</span>
      <span>Generated: ${generatedDate}</span>
    </div>
    <script>window.onload = function () { window.print(); }<\/script>
  </body>
</html>`
}

function formatDateDDMMYYYY(value) {
  const raw = String(value || '').trim()
  if (!raw) return '-'

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatch) {
    return `${isoMatch[3]}-${isoMatch[2]}-${isoMatch[1]}`
  }

  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw

  const day = String(parsed.getDate()).padStart(2, '0')
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const year = parsed.getFullYear()
  return `${day}-${month}-${year}`
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

function getActivityActionLabel(action) {
  const normalized = String(action || '').trim().toLowerCase()
  if (normalized === 'equipment.status_changed') return 'Equipment status changed'
  if (normalized === 'certificate.uploaded') return 'Certificate uploaded'
  if (normalized === 'certificate.deleted') return 'Certificate deleted'
  if (normalized === 'certificate.recovered') return 'Certificate recovered'
  if (normalized === 'report.deleted') return 'Report deleted'
  if (normalized === 'report.recovered') return 'Report recovered'
  if (normalized === 'report.approved') return 'Report approved'

  return normalized
    ? normalized
        .replace(/[._-]+/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase())
    : 'Activity updated'
}

function getActivityActionBadge(action) {
  const normalized = String(action || '').trim().toLowerCase()

  if (normalized === 'equipment.status_changed') {
    return { color: 'bg-amber-100 text-amber-800 border-amber-300' }
  }

  if (normalized === 'certificate.uploaded') {
    return { color: 'bg-blue-100 text-blue-800 border-blue-300' }
  }

  if (normalized === 'certificate.deleted') {
    return { color: 'bg-red-100 text-red-800 border-red-300' }
  }

  if (normalized === 'certificate.recovered') {
    return { color: 'bg-emerald-100 text-emerald-800 border-emerald-300' }
  }

  if (normalized === 'report.deleted') {
    return { color: 'bg-rose-100 text-rose-800 border-rose-300' }
  }

  if (normalized === 'report.recovered') {
    return { color: 'bg-emerald-100 text-emerald-800 border-emerald-300' }
  }

  if (normalized === 'report.approved') {
    return { color: 'bg-emerald-100 text-emerald-800 border-emerald-300' }
  }

  return { color: 'bg-slate-100 text-slate-700 border-slate-300' }
}

function formatActivityDetails(details) {
  if (!details || typeof details !== 'object') return 'No additional details'

  const entries = Object.entries(details)
  if (entries.length === 0) return 'No additional details'

  return entries
    .map(([key, value]) => {
      const label = String(key)
        .replace(/[._-]+/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase())

      let nextValue = '-'
      if (Array.isArray(value)) {
        nextValue = value.filter(Boolean).join(', ') || '-'
      } else if (value && typeof value === 'object') {
        const nested = Object.entries(value)
          .map(([nestedKey, nestedValue]) => `${nestedKey}: ${String(nestedValue ?? '-')}`)
          .join(', ')
        nextValue = nested || '-'
      } else if (value !== null && value !== undefined && value !== '') {
        nextValue = String(value)
      }

      return `${label}: ${nextValue}`
    })
    .join(' • ')
}

function formatActivityTimestamp(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString()
}

function formatGeneratedCertificateTimestamp(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString()
}

function getActivityCertificateId(entry) {
  const details = entry?.details || {}
  const certificateId = Number(details.certificate_id || entry?.target_id || 0)
  if (!Number.isFinite(certificateId) || certificateId <= 0) return 0
  return certificateId
}

function getActivityReportId(entry) {
  const details = entry?.details || {}
  const reportId = Number(details.report_id || entry?.target_id || 0)
  if (!Number.isFinite(reportId) || reportId <= 0) return 0
  return reportId
}

function getActivityRecoveryState(entry, nowMs, recoveredAtMsByRecoverableTarget) {
  const action = String(entry?.action || '').trim().toLowerCase()
  const isCertificateAction = action.startsWith('certificate.')
  const isReportAction = action.startsWith('report.')
  const targetType = isCertificateAction ? 'certificate' : isReportAction ? 'report' : ''
  const targetId = targetType === 'certificate' ? getActivityCertificateId(entry) : getActivityReportId(entry)

  if (action === 'certificate.recovered' || action === 'report.recovered') {
    if (!targetId || !targetType) {
      return { targetType: '', targetId: 0, canRecover: false, expiresAtMs: 0, label: '', status: 'none' }
    }
    return { targetType, targetId, canRecover: false, expiresAtMs: 0, label: 'Recovered', status: 'recovered' }
  }

  if (action !== 'certificate.deleted' && action !== 'report.deleted') {
    return { targetType: '', targetId: 0, canRecover: false, expiresAtMs: 0, label: '', status: 'none' }
  }

  const details = entry?.details || {}
  if (!targetId || !targetType) {
    return { targetType: '', targetId: 0, canRecover: false, expiresAtMs: 0, label: '', status: 'none' }
  }

  const recoveryKey = `${targetType}:${targetId}`
  const deletedAtMs = new Date(entry?.created_at).getTime()
  const recoveredAtMs = Number(recoveredAtMsByRecoverableTarget?.get(recoveryKey) || 0)
  if (Number.isFinite(deletedAtMs) && deletedAtMs > 0 && recoveredAtMs > deletedAtMs) {
    return { targetType, targetId, canRecover: false, expiresAtMs: 0, label: 'Recovered', status: 'recovered' }
  }

  const expiryDate = new Date(details.recovery_expires_at)
  if (Number.isNaN(expiryDate.getTime())) {
    return { targetType, targetId, canRecover: false, expiresAtMs: 0, label: 'Recovery window unavailable', status: 'expired' }
  }

  const expiresAtMs = expiryDate.getTime()
  if (expiresAtMs <= nowMs) {
    return {
      targetType,
      targetId,
      canRecover: false,
      expiresAtMs,
      label: `Recovery expired ${formatActivityTimestamp(expiryDate.toISOString())}`,
      status: 'expired',
    }
  }

  return {
    targetType,
    targetId,
    canRecover: true,
    expiresAtMs,
    label: `Recover by ${formatActivityTimestamp(expiryDate.toISOString())}`,
    status: 'recoverable',
  }
}

function isKeyboardEditableTarget(target) {
  if (!target || typeof target !== 'object') return false
  const tagName = String(target.tagName || '').toLowerCase()
  return Boolean(target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select')
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
    checklist_items: buildDefaultReportChecklistItems(),
    checklistImageFilesByLabel: {},
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

function buildEmptyCustomerEditForm() {
  return {
    company_id: '',
    company_name: '',
    company_contact_email: '',
    company_contact_phone: '',
    company_address: '',
    deactivate_customer: false,
  }
}

function buildEmptyEquipmentForm() {
  return {
    name: '',
    asset_tag: '',
    serial_number: '',
    safe_working_load: '',
    location: '',
    status: 'active',
    inspection_interval_days: 365,
    last_inspected_at: '',
    notes: '',
  }
}

function buildEmptySiteForm() {
  return {
    name: '',
    address: '',
  }
}

function buildEmptySiteEditForm() {
  return {
    name: '',
    address: '',
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

function buildEmptyPasswordForm() {
  return {
    current_password: '',
    new_password: '',
    confirm_password: '',
  }
}

function buildEmployeeUsername(firstName, lastName) {
  const first = String(firstName || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
  const last = String(lastName || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!first || !last) return ''

  return `${first.slice(0, 1)}_${last.slice(0, 4)}`
}

function formatLastUpdatedLabel(value, now) {
  if (!value) return 'Never'
  const timestamp = Number(value)
  if (!Number.isFinite(timestamp)) return 'Never'

  const elapsedMs = Math.max(0, now - timestamp)
  const elapsedMinutes = Math.floor(elapsedMs / 60000)
  if (elapsedMinutes < 1) return 'just now'
  if (elapsedMinutes < 60) return `${elapsedMinutes} min ago`

  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) return `${elapsedHours} hr ago`

  const elapsedDays = Math.floor(elapsedHours / 24)
  return `${elapsedDays} day${elapsedDays === 1 ? '' : 's'} ago`
}

function getSessionExpiryMs(accessToken) {
  const token = String(accessToken || '').trim()
  if (!token) return 0

  const segments = token.split('.')
  if (segments.length < 2) return 0

  try {
    const base64Value = segments[1].replace(/-/g, '+').replace(/_/g, '/')
    const paddingLength = (4 - (base64Value.length % 4)) % 4
    const paddedBase64 = base64Value + '='.repeat(paddingLength)
    const payloadText = atob(paddedBase64)
    const payload = JSON.parse(payloadText)
    const expiresAtSeconds = Number(payload?.exp || 0)
    if (!Number.isFinite(expiresAtSeconds) || expiresAtSeconds <= 0) return 0
    return expiresAtSeconds * 1000
  } catch {
    return 0
  }
}

function readReportDraft() {
  if (typeof window === 'undefined') return null
  try {
    const storage = window.localStorage
    if (!storage) return null
    const raw =
      typeof storage.getItem === 'function'
        ? storage.getItem(REPORT_DRAFT_STORAGE_KEY)
        : storage[REPORT_DRAFT_STORAGE_KEY]
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

function getMostRecentReport(reportList) {
  if (!Array.isArray(reportList) || reportList.length === 0) return null

  return reportList.reduce((latest, candidate) => {
    if (!latest) return candidate

    const latestDateMs = Date.parse(latest.report_date || '')
    const candidateDateMs = Date.parse(candidate.report_date || '')
    const latestIsValid = Number.isFinite(latestDateMs)
    const candidateIsValid = Number.isFinite(candidateDateMs)

    if (candidateIsValid && !latestIsValid) return candidate
    if (candidateIsValid && latestIsValid && candidateDateMs > latestDateMs) return candidate
    if (candidateIsValid && latestIsValid && candidateDateMs === latestDateMs) {
      return Number(candidate.id || 0) > Number(latest.id || 0) ? candidate : latest
    }

    return latest
  }, null)
}

function writeReportDraft(draft) {
  if (typeof window === 'undefined') return
  try {
    const storage = window.localStorage
    if (!storage) return
    if (typeof storage.setItem === 'function') {
      storage.setItem(REPORT_DRAFT_STORAGE_KEY, JSON.stringify(draft))
      return
    }
    storage[REPORT_DRAFT_STORAGE_KEY] = JSON.stringify(draft)
  } catch {
    // Ignore storage write errors so form edits are never blocked.
  }
}

function clearReportDraft() {
  if (typeof window === 'undefined') return
  const storage = window.localStorage
  if (!storage) return
  if (typeof storage.removeItem === 'function') {
    storage.removeItem(REPORT_DRAFT_STORAGE_KEY)
    return
  }
  delete storage[REPORT_DRAFT_STORAGE_KEY]
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
  usePageMeta({
    title: 'Customer Portal',
    description: 'Manage equipment, reports, certificates, and approvals in the Manley Lifting portal.',
    noIndex: true,
  })

  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const initialSearchQuery = String(searchParams.get('q') || '').trim()
  const initialReportYearFilter = String(searchParams.get('reportYear') || '').trim()
  const initialEquipmentTab = parseEnum(searchParams.get('eqTab'), ['active', 'decommissioned'], 'active')
  const initialInspectionUrgency = parseEnum(
    searchParams.get('eqUrgency'),
    ['all', 'overdue', 'due_soon', 'on_schedule'],
    'all',
  )
  const initialEquipmentStatusFilter = parseEnum(
    searchParams.get('eqStatus'),
    [
      EQUIPMENT_STATUS_FILTER_ALL,
      EQUIPMENT_STATUS_FILTER_GOOD,
      EQUIPMENT_STATUS_FILTER_WORN,
      EQUIPMENT_STATUS_FILTER_ATTENTION,
      EQUIPMENT_STATUS_FILTER_NOT_PRESENTED,
      EQUIPMENT_STATUS_FILTER_NO_REPORT,
    ],
    EQUIPMENT_STATUS_FILTER_ALL,
  )
  const initialEquipmentPage = parsePositiveInt(searchParams.get('eqPage'), 1)
  const initialCustomerPage = parsePositiveInt(searchParams.get('customersPage'), 1)
  const initialEmployeePage = parsePositiveInt(searchParams.get('employeesPage'), 1)
  const initialPendingApprovalsPage = parsePositiveInt(searchParams.get('pendingApprovalsPage'), 1)
  const initialEquipmentDeepLinkId = String(searchParams.get('eqId') || '').trim()
  const isAuthenticated = hasPortalSession()
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [profile, setProfile] = useState(null)
  const [companies, setCompanies] = useState([])
  const [company, setCompany] = useState(null)
  const [equipment, setEquipment] = useState([])
  const [pendingDeepLinkEquipmentId, setPendingDeepLinkEquipmentId] = useState(initialEquipmentDeepLinkId)
  const [searchInput, setSearchInput] = useState(initialSearchQuery)
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery)
  const [loggingOut, setLoggingOut] = useState(false)
  const [refreshingCustomers, setRefreshingCustomers] = useState(false)
  const [refreshingEquipment, setRefreshingEquipment] = useState(false)
  const [portalToast, setPortalToast] = useState(null)
  const [showSessionExpiryWarning, setShowSessionExpiryWarning] = useState(false)
  const [refreshingSession, setRefreshingSession] = useState(false)
  const [sessionWarningError, setSessionWarningError] = useState('')
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [customersLastUpdatedAt, setCustomersLastUpdatedAt] = useState(0)
  const [equipmentLastUpdatedAt, setEquipmentLastUpdatedAt] = useState(0)
  const [pendingApprovalsLastUpdatedAt, setPendingApprovalsLastUpdatedAt] = useState(0)
  const [selectedEquipment, setSelectedEquipment] = useState(null)
  const [reports, setReports] = useState([])
  const [reportYearFilter, setReportYearFilter] = useState(initialReportYearFilter)
  const [reportError, setReportError] = useState('')
  const [createReportError, setCreateReportError] = useState('')
  const [editReportError, setEditReportError] = useState('')
  const [viewedReportError, setViewedReportError] = useState('')
  const [revisionsError, setRevisionsError] = useState('')
  const [certificateError, setCertificateError] = useState('')
  const [generatingSiteCertificates, setGeneratingSiteCertificates] = useState(false)
  const [showGeneratedCertificatePreviewModal, setShowGeneratedCertificatePreviewModal] = useState(false)
  const [generatedCertificatePreviewUrl, setGeneratedCertificatePreviewUrl] = useState('')
  const [generatedCertificateFilename, setGeneratedCertificateFilename] = useState('')
  const [generatedCertificateActionId, setGeneratedCertificateActionId] = useState(0)
  const [confirmDeleteGeneratedCertificateId, setConfirmDeleteGeneratedCertificateId] = useState('')
  const [equipmentActivity, setEquipmentActivity] = useState([])
  const [equipmentActivityError, setEquipmentActivityError] = useState('')
  const [equipmentActivityPage, setEquipmentActivityPage] = useState(1)
  const [, setCertificateSuccess] = useState('')
  const [recoveringCertificateId, setRecoveringCertificateId] = useState(0)
  const [recoveringReportId, setRecoveringReportId] = useState(0)
  const [creatingReport, setCreatingReport] = useState(false)
  const [savingReportEdit, setSavingReportEdit] = useState(false)
  const [approvingReport, setApprovingReport] = useState(false)
  const [revisionReportId, setRevisionReportId] = useState('')
  const [reportRevisions, setReportRevisions] = useState([])
  const [selectedRevisionPreview, setSelectedRevisionPreview] = useState(null)
  const [revisionsLoading, setRevisionsLoading] = useState(false)
  const [pendingReportApprovals, setPendingReportApprovals] = useState([])
  const [pendingApprovalsLoading, setPendingApprovalsLoading] = useState(false)
  const [pendingApprovalsError, setPendingApprovalsError] = useState('')
  const [selectedPendingApprovalIds, setSelectedPendingApprovalIds] = useState([])
  const [bulkApprovingReports, setBulkApprovingReports] = useState(false)
  const [selectedEquipmentIds, setSelectedEquipmentIds] = useState([])
  const [bulkDecommissioningEquipment, setBulkDecommissioningEquipment] = useState(false)
  const [selectedCustomerIds, setSelectedCustomerIds] = useState([])
  const [bulkDeactivatingCustomers, setBulkDeactivatingCustomers] = useState(false)
  const [dashboardStats, setDashboardStats] = useState({
    overdue_count: 0,
    due_soon_count: 0,
    pending_approvals_count: 0,
  })
  const [dashboardStatsLoading, setDashboardStatsLoading] = useState(false)
  const [dashboardStatsError, setDashboardStatsError] = useState('')
  const [viewedReport, setViewedReport] = useState(null)
  const [selectedReportImage, setSelectedReportImage] = useState(null)
  const [confirmRemoveReportImageId, setConfirmRemoveReportImageId] = useState('')
  const [confirmDeleteDraftReportId, setConfirmDeleteDraftReportId] = useState('')
  const [deletingDraftReport, setDeletingDraftReport] = useState(false)
  const [reportUnsavedPrompt, setReportUnsavedPrompt] = useState('')
  const [showReportSubmissionConfirmModal, setShowReportSubmissionConfirmModal] = useState(false)
  const [reportSubmissionConfirmChecks, setReportSubmissionConfirmChecks] = useState(() =>
    REPORT_SUBMISSION_CONFIRMATION_ITEMS.map(() => false),
  )
  const [showEquipmentQrModal, setShowEquipmentQrModal] = useState(false)
  const [equipmentQrImageDataUrl, setEquipmentQrImageDataUrl] = useState('')
  const [equipmentQrLink, setEquipmentQrLink] = useState('')
  const [equipmentQrError, setEquipmentQrError] = useState('')
  const [generatingEquipmentQr, setGeneratingEquipmentQr] = useState(false)
  const [unsavedChangesPrompt, setUnsavedChangesPrompt] = useState('')
  const [showEditReportModal, setShowEditReportModal] = useState(false)
  const [showRevisionsModal, setShowRevisionsModal] = useState(false)
  const [reportForm, setReportForm] = useState(buildEmptyReportForm())
  const [showCreateReportForm, setShowCreateReportForm] = useState(false)
  const [customerForm, setCustomerForm] = useState(buildEmptyCustomerForm())
  const [creatingCustomer, setCreatingCustomer] = useState(false)
  const [customerCreateError, setCustomerCreateError] = useState('')
  const [, setCustomerCreateSuccess] = useState('')
  const [showCreateCustomerForm, setShowCreateCustomerForm] = useState(false)
  const [showEditCustomerForm, setShowEditCustomerForm] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState(false)
  const [confirmCustomerDeactivate, setConfirmCustomerDeactivate] = useState(false)
  const [customerEditForm, setCustomerEditForm] = useState(buildEmptyCustomerEditForm())
  const [customerEditError, setCustomerEditError] = useState('')
  const [, setCustomerEditSuccess] = useState('')
  const [customerStatsFilter, setCustomerStatsFilter] = useState('all')
  const [customerSearchInput, setCustomerSearchInput] = useState('')
  const [customerPage, setCustomerPage] = useState(initialCustomerPage)
  const [showCreateEmployeeForm, setShowCreateEmployeeForm] = useState(false)
  const [employeeForm, setEmployeeForm] = useState(buildEmptyEmployeeForm())
  const [activeStaffAssignments, setActiveStaffAssignments] = useState([])
  const [inactiveStaffAssignments, setInactiveStaffAssignments] = useState([])
  const [staffAssignmentsLoading, setStaffAssignmentsLoading] = useState(false)
  const [staffAssignmentsError, setStaffAssignmentsError] = useState('')
  const [, setStaffAssignmentsSuccess] = useState('')
  const [employeeControlsTab, setEmployeeControlsTab] = useState('active')
  const [employeeSearchInput, setEmployeeSearchInput] = useState('')
  const [employeePage, setEmployeePage] = useState(initialEmployeePage)
  const [pendingApprovalsPage, setPendingApprovalsPage] = useState(initialPendingApprovalsPage)
  const [companyPickerUserId, setCompanyPickerUserId] = useState('')
  const [companyPickerSearchInput, setCompanyPickerSearchInput] = useState('')
  const [savingStaffUserId, setSavingStaffUserId] = useState(0)
  const [removingStaffUserId, setRemovingStaffUserId] = useState(0)
  const [reactivatingStaffUserId, setReactivatingStaffUserId] = useState(0)
  const [creatingStaffAssignment, setCreatingStaffAssignment] = useState(false)
  const [confirmRemoveUserId, setConfirmRemoveUserId] = useState(0)
  const [showCreateEquipmentForm, setShowCreateEquipmentForm] = useState(false)
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false)
  const [passwordForm, setPasswordForm] = useState(buildEmptyPasswordForm())
  const [changingPassword, setChangingPassword] = useState(false)
  const [passwordChangeError, setPasswordChangeError] = useState('')
  const [, setPasswordChangeSuccess] = useState('')
  const [creatingEquipment, setCreatingEquipment] = useState(false)
  const [equipmentCreateError, setEquipmentCreateError] = useState('')
  const [, setEquipmentCreateSuccess] = useState('')
  const [equipmentForm, setEquipmentForm] = useState(buildEmptyEquipmentForm())
  const [selectedSiteId, setSelectedSiteId] = useState('')
  const [showCreateSiteForm, setShowCreateSiteForm] = useState(false)
  const [creatingSite, setCreatingSite] = useState(false)
  const [siteCreateError, setSiteCreateError] = useState('')
  const [siteForm, setSiteForm] = useState(buildEmptySiteForm())
  const [showEditSiteForm, setShowEditSiteForm] = useState(false)
  const [updatingSite, setUpdatingSite] = useState(false)
  const [siteEditError, setSiteEditError] = useState('')
  const [siteEditForm, setSiteEditForm] = useState(buildEmptySiteEditForm())
  const [deletingSite, setDeletingSite] = useState(false)
  const [equipmentPage, setEquipmentPage] = useState(initialEquipmentPage)
  const [updatingEquipmentStatus, setUpdatingEquipmentStatus] = useState(false)
  const [equipmentStatusError, setEquipmentStatusError] = useState('')
  const [equipmentStatusDraft, setEquipmentStatusDraft] = useState('active')
  const [showDecommissionConfirm, setShowDecommissionConfirm] = useState(false)
  const [equipmentTableTab, setEquipmentTableTab] = useState(initialEquipmentTab)
  const [equipmentSortKey, setEquipmentSortKey] = useState('next_due')
  const [equipmentSortDirection, setEquipmentSortDirection] = useState('asc')
  const [inspectionUrgencyFilter, setInspectionUrgencyFilter] = useState(initialInspectionUrgency)
  const [equipmentStatusFilter, setEquipmentStatusFilter] = useState(initialEquipmentStatusFilter)
  const [expandedEquipmentCardId, setExpandedEquipmentCardId] = useState('')
  const [expandedReportCardId, setExpandedReportCardId] = useState('')
  const [showReportHistory, setShowReportHistory] = useState(false)
  const previousSelectedEquipmentIdRef = useRef('')
  const previousDesktopSelectedEquipmentIdRef = useRef('')
  const skipNextEqIdSyncRef = useRef(false)
  const suppressQuerySyncUntilCustomerListRef = useRef(false)
  const scrollToCustomerListOnBackRef = useRef(false)
  const hasInitializedCustomerPageResetRef = useRef(false)
  const hasInitializedEmployeePageResetRef = useRef(false)
  const hasInitializedEquipmentPageResetRef = useRef(false)
  const initialCustomerEditFormRef = useRef(buildEmptyCustomerEditForm())
  const initialReportEditFormRef = useRef(buildEmptyReportForm())
  const employeeControlsSectionRef = useRef(null)
  const equipmentDetailsSectionRef = useRef(null)
  const customerListSectionRef = useRef(null)
  const generatedEmployeeBaseUsername = useMemo(
    () => buildEmployeeUsername(employeeForm.first_name, employeeForm.last_name),
    [employeeForm.first_name, employeeForm.last_name],
  )
  const existingEmployeeUsernames = useMemo(
    () => [...activeStaffAssignments, ...inactiveStaffAssignments].map((assignment) => assignment.username),
    [activeStaffAssignments, inactiveStaffAssignments],
  )
  const generatedEmployeeUsername = useMemo(
    () => buildUniqueEmployeeUsername(generatedEmployeeBaseUsername, existingEmployeeUsernames),
    [generatedEmployeeBaseUsername, existingEmployeeUsernames],
  )
  const selectedCompanyId = searchParams.get('companyId') || ''

  const equipmentPageSize = 10
  const customerPageSize = 6
  const employeePageSize = 5
  const pendingApprovalsPageSize = 6
  const equipmentActivityPageSize = 4

  const canEditReports = useMemo(
    () => ['owner', 'office_staff', 'staff', 'engineer'].includes(profile?.role),
    [profile?.role],
  )

  const availableReportYears = useMemo(() => {
    const years = new Set()
    reports.forEach((report) => {
      if (report.report_date) {
        const year = report.report_date.split('-')[0]
        years.add(year)
      }
    })
    return Array.from(years).sort().reverse()
  }, [reports])

  const filteredReports = useMemo(() => {
    if (!reportYearFilter) return reports
    return reports.filter((report) => report.report_date?.startsWith(reportYearFilter))
  }, [reports, reportYearFilter])
  const latestReport = useMemo(() => getMostRecentReport(reports), [reports])
  const showsCustomerPicker = canEditReports && !selectedCompanyId
  const isOwner = profile?.role === 'owner' || profile?.role === 'office_staff'
  const canManageSites = isOwner
  const canViewEquipmentActivity = isOwner
  const isStaff = profile?.role === 'staff' || profile?.role === 'engineer'
  const companySites = useMemo(() => (Array.isArray(company?.sites) ? company.sites : []), [company])
  const activeSite = useMemo(() => {
    if (!companySites.length) return null
    return companySites.find((site) => String(site.id) === String(selectedSiteId)) || companySites[0]
  }, [companySites, selectedSiteId])
  const generatedCertificatesSiteId = Number(activeSite?.id || selectedSiteId || 0)
  const activeSelectedEquipment = useMemo(() => {
    if (!selectedEquipment) return null
    return equipment.find((item) => String(item.id) === String(selectedEquipment.id)) || null
  }, [equipment, selectedEquipment])
  const reportsQuery = useQuery({
    queryKey: portalQueryKeys.reports(activeSelectedEquipment?.id),
    queryFn: () => getEquipmentReports(activeSelectedEquipment.id),
    enabled: Boolean(activeSelectedEquipment?.id),
    staleTime: 30 * 1000,
  })
  const reportsLoading = reportsQuery.isLoading || reportsQuery.isFetching

  const equipmentActivityQuery = useQuery({
    queryKey: portalQueryKeys.equipmentActivity(activeSelectedEquipment?.id),
    queryFn: () => getEquipmentActivity(activeSelectedEquipment.id),
    enabled: Boolean(activeSelectedEquipment?.id && canViewEquipmentActivity),
    staleTime: 60 * 1000,
  })
  const generatedCertificatesQuery = useQuery({
    queryKey: portalQueryKeys.generatedCertificates(generatedCertificatesSiteId),
    queryFn: () => getSiteCertificates(generatedCertificatesSiteId),
    enabled: Boolean(generatedCertificatesSiteId),
    staleTime: 5 * 60 * 1000,
  })
  const generatedCertificates = generatedCertificatesQuery.data || []
  const generatedCertificatesLoading = generatedCertificatesQuery.isLoading || generatedCertificatesQuery.isFetching
  const approveReportMutation = useMutation({
    mutationFn: ({ reportId }) => updateReport(reportId, { status: 'approved' }),
    onMutate: async ({ reportSnapshot }) => {
      const wasSubmitted = String(reportSnapshot?.status || '').toLowerCase() === 'submitted'
      const previousReports = reports
      const previousViewedReport = viewedReport
      const previousPendingApprovals = pendingReportApprovals
      const previousDashboardStats = dashboardStats

      setApprovingReport(true)
      setViewedReportError('')

      if (wasSubmitted && reportSnapshot?.id) {
        const optimisticReport = { ...reportSnapshot, status: 'approved' }
        setReports((current) =>
          current.map((report) =>
            String(report.id) === String(optimisticReport.id) ? optimisticReport : report,
          ),
        )
        setViewedReport(optimisticReport)
        setPendingReportApprovals((current) =>
          current.filter((report) => String(report.id) !== String(optimisticReport.id)),
        )
        setDashboardStats((current) => ({
          ...current,
          pending_approvals_count: Math.max(0, Number(current.pending_approvals_count || 0) - 1),
        }))
      }

      return {
        wasSubmitted,
        previousReports,
        previousViewedReport,
        previousPendingApprovals,
        previousDashboardStats,
      }
    },
    onSuccess: async (updatedReport) => {
      await invalidatePortalCaches([
        portalQueryKeys.reportsRoot(),
        portalQueryKeys.equipmentRoot(),
        portalQueryKeys.pendingApprovalsRoot(),
        portalQueryKeys.dashboardStatsRoot(),
      ])

      setReports((current) =>
        current.map((report) => (String(report.id) === String(updatedReport.id) ? updatedReport : report)),
      )
      setViewedReport(updatedReport)

      if (!selectedCompanyId) {
        await Promise.all([
          refreshPendingReportApprovals().catch(() => {}),
          refreshDashboardStats().catch(() => {}),
        ])
      }

      try {
        await fetchPortalEquipmentList({
          companyId: activeSelectedEquipment?.company_id || selectedCompanyId,
          siteId: selectedSiteId,
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
      } catch {
        // Keep the optimistic/final report status update even if equipment refresh fails.
      }
    },
    onError: (error, _variables, context) => {
      if (context?.wasSubmitted) {
        setReports(context.previousReports)
        setViewedReport(context.previousViewedReport)
        setPendingReportApprovals(context.previousPendingApprovals)
        setDashboardStats(context.previousDashboardStats)
      }
      setViewedReportError(String(error?.message || 'Unable to approve report.'))
    },
    onSettled: () => {
      setApprovingReport(false)
    },
  })
  const updateEquipmentStatusMutation = useMutation({
    mutationFn: ({ equipmentId, status }) => updatePortalEquipment(equipmentId, { status }),
    onMutate: async ({ equipmentId, status }) => {
      const previousEquipment = equipment
      const previousSelectedEquipment = selectedEquipment
      const selectedEquipmentIdToMaintain = selectedEquipment?.id || null

      const optimisticEquipment = equipment.map((item) =>
        String(item.id) === String(equipmentId)
          ? {
              ...item,
              status,
            }
          : item,
      )

      setUpdatingEquipmentStatus(true)
      setEquipmentStatusError('')
      setEquipment(optimisticEquipment)
      setEquipmentLastUpdatedAt(Date.now())
      if (selectedEquipmentIdToMaintain && String(selectedEquipmentIdToMaintain) === String(equipmentId)) {
        setSelectedEquipment((current) =>
          current
            ? {
                ...current,
                status,
              }
            : current,
        )
      }

      return {
        previousEquipment,
        previousSelectedEquipment,
        selectedEquipmentIdToMaintain,
      }
    },
    onSuccess: async (_result, variables, context) => {
      await invalidatePortalCaches([
        portalQueryKeys.equipmentRoot(),
        portalQueryKeys.dashboardStatsRoot(),
      ])

      const refreshedEquipment = await fetchPortalEquipmentList({
        companyId: variables.companyIdForRefresh,
        siteId: variables.siteId,
        search: variables.search,
      })
      setEquipment(refreshedEquipment)
      setEquipmentLastUpdatedAt(Date.now())
      if (context?.selectedEquipmentIdToMaintain) {
        const nextSelectedEquipment = refreshedEquipment.find(
          (item) => String(item.id) === String(context.selectedEquipmentIdToMaintain),
        )
        setSelectedEquipment(nextSelectedEquipment || null)
      }
      setEquipmentPage(1)
    },
    onError: (error, _variables, context) => {
      setEquipment(context?.previousEquipment || [])
      if (context?.selectedEquipmentIdToMaintain) {
        setSelectedEquipment(context.previousSelectedEquipment || null)
      }
      setEquipmentStatusError(String(error?.message || 'Unable to update equipment status.'))
    },
    onSettled: () => {
      setUpdatingEquipmentStatus(false)
    },
  })
  const bulkApproveReportsMutation = useMutation({
    mutationFn: ({ reportIds }) =>
      Promise.all(reportIds.map((reportId) => updateReport(reportId, { status: 'approved' }))),
    onMutate: async () => {
      setBulkApprovingReports(true)
      setPendingApprovalsError('')
    },
    onSuccess: async () => {
      await invalidatePortalCaches([
        portalQueryKeys.reportsRoot(),
        portalQueryKeys.equipmentRoot(),
        portalQueryKeys.pendingApprovalsRoot(),
        portalQueryKeys.dashboardStatsRoot(),
      ])

      setSelectedPendingApprovalIds([])
      await Promise.all([refreshPendingReportApprovals(true), refreshDashboardStats(true)])
      showSuccessToast('Selected submitted reports have been approved.', 'Reports Approved')
    },
    onError: (error) => {
      setPendingApprovalsError(String(error?.message || 'Unable to bulk approve reports.'))
    },
    onSettled: () => {
      setBulkApprovingReports(false)
    },
  })
  const bulkDecommissionEquipmentMutation = useMutation({
    mutationFn: ({ equipmentIds }) =>
      Promise.all(
        equipmentIds.map((equipmentId) => updatePortalEquipment(equipmentId, { status: 'decommissioned' })),
      ),
    onMutate: async () => {
      setBulkDecommissioningEquipment(true)
      setEquipmentStatusError('')
    },
    onSuccess: async () => {
      await invalidatePortalCaches([
        portalQueryKeys.equipmentRoot(),
        portalQueryKeys.dashboardStatsRoot(),
      ])

      setSelectedEquipmentIds([])
      await Promise.all([refreshEquipmentData(), refreshDashboardStats(true)])
      showSuccessToast('Selected equipment has been decommissioned.', 'Equipment Updated')
    },
    onError: (error) => {
      setEquipmentStatusError(String(error?.message || 'Unable to decommission selected equipment.'))
    },
    onSettled: () => {
      setBulkDecommissioningEquipment(false)
    },
  })
  const editCustomerMutation = useMutation({
    mutationFn: ({ payload }) => updatePortalCustomer(payload),
    onMutate: async () => {
      setEditingCustomer(true)
      setCustomerEditError('')
      setCustomerEditSuccess('')
    },
    onSuccess: async (updated, variables) => {
      await invalidatePortalCaches([
        portalQueryKeys.companies(),
      ])
      const refreshedCompanies = await fetchPortalCompanies()
      setCompanies(refreshedCompanies)
      setCustomersLastUpdatedAt(Date.now())
      setShowEditCustomerForm(false)
      setConfirmCustomerDeactivate(false)
      setCustomerEditForm(buildEmptyCustomerEditForm())
      const nextCustomerMessage = variables?.deactivateCustomer
        ? `Deactivated customer ${updated.name}.`
        : `Updated customer ${updated.name}.`
      setCustomerEditSuccess(nextCustomerMessage)
      showSuccessToast(
        nextCustomerMessage,
        variables?.deactivateCustomer ? 'Customer Deactivated' : 'Customer Updated',
      )
    },
    onError: (error) => {
      setCustomerEditError(String(error?.message || 'Unable to update customer.'))
    },
    onSettled: () => {
      setEditingCustomer(false)
    },
  })
  const createEmployeeAssignmentMutation = useMutation({
    mutationFn: ({ payload }) => createStaffAssignment(payload),
    onMutate: async () => {
      setCreatingStaffAssignment(true)
      setStaffAssignmentsError('')
      setStaffAssignmentsSuccess('')
    },
    onSuccess: async (created) => {
      await invalidatePortalCaches([
        portalQueryKeys.staffAssignmentsRoot(),
      ])
      await refreshStaffAssignments(true)
      setEmployeeForm(buildEmptyEmployeeForm())
      setShowCreateEmployeeForm(false)
      setStaffAssignmentsSuccess(`Created employee ${created.username}.`)
      showSuccessToast(`Created employee ${created.username}.`, 'Employee Created')
    },
    onError: (error) => {
      setStaffAssignmentsError(String(error?.message || 'Unable to create employee account.'))
    },
    onSettled: () => {
      setCreatingStaffAssignment(false)
    },
  })
  const saveEmployeeAssignmentMutation = useMutation({
    mutationFn: ({ assignment }) =>
      updateStaffAssignment({
        user_id: assignment.user_id,
        role: assignment.role,
        allowed_company_ids: assignment.allowed_company_ids || [],
      }),
    onMutate: async ({ assignment }) => {
      setSavingStaffUserId(Number(assignment.user_id))
      setStaffAssignmentsError('')
      setStaffAssignmentsSuccess('')
    },
    onSuccess: async (_result, variables) => {
      await invalidatePortalCaches([
        portalQueryKeys.staffAssignmentsRoot(),
      ])
      setStaffAssignmentsSuccess(`Updated permissions for ${variables.assignment.username}.`)
      showSuccessToast(`Updated permissions for ${variables.assignment.username}.`, 'Permissions Updated')
      await refreshStaffAssignments(true)
      if (String(companyPickerUserId) === String(variables.assignment.user_id)) {
        setCompanyPickerUserId('')
        setCompanyPickerSearchInput('')
      }
      window.requestAnimationFrame(() => {
        employeeControlsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    },
    onError: (error) => {
      setStaffAssignmentsError(String(error?.message || 'Unable to update employee permissions.'))
    },
    onSettled: () => {
      setSavingStaffUserId(0)
    },
  })
  const employeeRoleChangeMutation = useMutation({
    mutationFn: ({ assignment, nextRole }) =>
      updateStaffAssignment({
        user_id: assignment.user_id,
        role: nextRole,
        allowed_company_ids: assignment.allowed_company_ids || [],
      }),
    onMutate: async ({ assignment, nextRole }) => {
      const previousRole = assignment.role
      setActiveStaffAssignments((current) =>
        current.map((item) =>
          item.user_id === assignment.user_id
            ? { ...item, role: nextRole }
            : item,
        ),
      )
      setSavingStaffUserId(Number(assignment.user_id))
      setStaffAssignmentsError('')
      setStaffAssignmentsSuccess('')
      return { previousRole }
    },
    onSuccess: async (_result, variables) => {
      await invalidatePortalCaches([
        portalQueryKeys.staffAssignmentsRoot(),
      ])
      setStaffAssignmentsSuccess(`Updated employee type for ${variables.assignment.username}.`)
      showSuccessToast(`Updated employee type for ${variables.assignment.username}.`, 'Employee Updated')
      await refreshStaffAssignments(true)
    },
    onError: (error, variables, context) => {
      setActiveStaffAssignments((current) =>
        current.map((item) =>
          item.user_id === variables.assignment.user_id
            ? { ...item, role: context?.previousRole || item.role }
            : item,
        ),
      )
      setStaffAssignmentsError(String(error?.message || 'Unable to update employee type.'))
    },
    onSettled: () => {
      setSavingStaffUserId(0)
    },
  })
  const removeEmployeeAssignmentMutation = useMutation({
    mutationFn: ({ assignment }) => deleteStaffAssignment(assignment.user_id),
    onMutate: async ({ assignment }) => {
      setRemovingStaffUserId(Number(assignment.user_id))
      setStaffAssignmentsError('')
      setStaffAssignmentsSuccess('')
    },
    onSuccess: async (_result, variables) => {
      await invalidatePortalCaches([
        portalQueryKeys.staffAssignmentsRoot(),
      ])
      setStaffAssignmentsSuccess(`Deactivated employee ${variables.assignment.username}.`)
      showSuccessToast(`Deactivated employee ${variables.assignment.username}.`, 'Employee Deactivated')
      await refreshStaffAssignments(true)
    },
    onError: (error) => {
      setStaffAssignmentsError(String(error?.message || 'Unable to remove employee account.'))
    },
    onSettled: () => {
      setRemovingStaffUserId(0)
    },
  })
  const reactivateEmployeeAssignmentMutation = useMutation({
    mutationFn: ({ assignment }) => reactivateStaffAssignment(assignment.user_id),
    onMutate: async ({ assignment }) => {
      setReactivatingStaffUserId(Number(assignment.user_id))
      setStaffAssignmentsError('')
      setStaffAssignmentsSuccess('')
    },
    onSuccess: async (_result, variables) => {
      await invalidatePortalCaches([
        portalQueryKeys.staffAssignmentsRoot(),
      ])
      setStaffAssignmentsSuccess(`Reactivated employee ${variables.assignment.username}.`)
      showSuccessToast(`Reactivated employee ${variables.assignment.username}.`, 'Employee Reactivated')
      await refreshStaffAssignments(true)
    },
    onError: (error) => {
      setStaffAssignmentsError(String(error?.message || 'Unable to reactivate employee account.'))
    },
    onSettled: () => {
      setReactivatingStaffUserId(0)
    },
  })
  const createCustomerMutation = useMutation({
    mutationFn: ({ formData }) => createPortalCustomer(formData),
    onMutate: async () => {
      setCreatingCustomer(true)
      setCustomerCreateError('')
      setCustomerCreateSuccess('')
    },
    onSuccess: async (created) => {
      await invalidatePortalCaches([
        portalQueryKeys.companies(),
      ])
      const refreshedCompanies = await fetchPortalCompanies()
      setCompanies(refreshedCompanies)
      setCustomersLastUpdatedAt(Date.now())
      setCustomerForm(buildEmptyCustomerForm())
      setShowCreateCustomerForm(false)
      setCustomerCreateSuccess(`Created customer ${created.customer.username} for ${created.company.name}.`)
      showSuccessToast(
        `Created customer ${created.customer.username} for ${created.company.name}.`,
        'Customer Created',
      )
    },
    onError: (error) => {
      setCustomerCreateError(String(error?.message || 'Unable to create customer account.'))
    },
    onSettled: () => {
      setCreatingCustomer(false)
    },
  })
  const createSiteMutation = useMutation({
    mutationFn: ({ companyId, name, address }) =>
      createPortalSite({
        company_id: Number(companyId),
        name: String(name || '').trim(),
        address: String(address || '').trim(),
      }),
    onMutate: async () => {
      setCreatingSite(true)
      setSiteCreateError('')
    },
    onSuccess: async (createdSite, variables) => {
      await invalidatePortalCaches([
        portalQueryKeys.companyHeader(variables.companyId),
        portalQueryKeys.equipmentRoot(),
      ])
      const nextCompany = await fetchPortalCompanyHeader(variables.companyId)
      setCompany(nextCompany)
      setSelectedSiteId(String(createdSite.id))
      setEquipment([])
      setEquipmentPage(1)
      setSiteForm(buildEmptySiteForm())
      setShowCreateSiteForm(false)
      showSuccessToast(`Created site ${createdSite.name}.`, 'Site Created')
    },
    onError: (error) => {
      setSiteCreateError(String(error?.message || 'Unable to create site.'))
    },
    onSettled: () => {
      setCreatingSite(false)
    },
  })
  const updateSiteMutation = useMutation({
    mutationFn: ({ siteId, name, address }) =>
      updatePortalSite(siteId, {
        name: String(name || '').trim(),
        address: String(address || '').trim(),
      }),
    onMutate: async () => {
      setUpdatingSite(true)
      setSiteEditError('')
    },
    onSuccess: async (updatedSite, variables) => {
      await invalidatePortalCaches([
        portalQueryKeys.companyHeader(variables.companyId),
        portalQueryKeys.equipmentRoot(),
      ])
      const nextCompany = await fetchPortalCompanyHeader(variables.companyId)
      setCompany(nextCompany)
      setSelectedSiteId(String(updatedSite.id))
      setShowEditSiteForm(false)
      showSuccessToast(`Updated site ${updatedSite.name}.`, 'Site Updated')
    },
    onError: (error) => {
      setSiteEditError(String(error?.message || 'Unable to update site.'))
    },
    onSettled: () => {
      setUpdatingSite(false)
    },
  })
  const deleteSiteMutation = useMutation({
    mutationFn: ({ siteId }) => deletePortalSite(siteId),
    onMutate: async () => {
      setDeletingSite(true)
      setSiteEditError('')
    },
    onSuccess: async (_result, variables) => {
      await invalidatePortalCaches([
        portalQueryKeys.companyHeader(variables.companyId),
        portalQueryKeys.equipmentRoot(),
      ])
      const nextCompany = await fetchPortalCompanyHeader(variables.companyId)
      const nextSites = Array.isArray(nextCompany?.sites) ? nextCompany.sites : []
      const nextSiteId = nextSites[0]?.id || ''
      setCompany(nextCompany)
      setSelectedSiteId(nextSiteId ? String(nextSiteId) : '')
      setSelectedEquipment(null)
      setEquipment([])
      setEquipmentPage(1)
      showSuccessToast(`Deleted site ${variables.siteName}.`, 'Site Deleted')
    },
    onError: (error) => {
      setSiteEditError(String(error?.message || 'Unable to delete site.'))
    },
    onSettled: () => {
      setDeletingSite(false)
    },
  })
  const createEquipmentMutation = useMutation({
    mutationFn: ({ payload }) => createPortalEquipment(payload),
    onMutate: async () => {
      setCreatingEquipment(true)
      setEquipmentCreateError('')
      setEquipmentCreateSuccess('')
    },
    onSuccess: async (created, variables) => {
      await invalidatePortalCaches([
        portalQueryKeys.equipmentRoot(),
        portalQueryKeys.dashboardStatsRoot(),
      ])
      const refreshedEquipment = await fetchPortalEquipmentList({
        companyId: variables.companyId,
        siteId: variables.siteId,
        search: variables.search,
      })
      setEquipment(refreshedEquipment)
      setEquipmentLastUpdatedAt(Date.now())
      setEquipmentPage(1)
      setEquipmentForm(buildEmptyEquipmentForm())
      setShowCreateEquipmentForm(false)
      setEquipmentCreateSuccess(`Created equipment ${created.name}.`)
      showSuccessToast(`Created equipment ${created.name}.`, 'Equipment Created')
    },
    onError: (error) => {
      setEquipmentCreateError(String(error?.message || 'Unable to create equipment.'))
    },
    onSettled: () => {
      setCreatingEquipment(false)
    },
  })
  const editReportMutation = useMutation({
    mutationFn: ({ reportId, payload }) => updateReport(reportId, payload),
    onMutate: async () => {
      setSavingReportEdit(true)
      setEditReportError('')
    },
    onSuccess: async (updatedReport, variables) => {
      await invalidatePortalCaches([
        portalQueryKeys.reportsRoot(),
        portalQueryKeys.equipmentRoot(),
        portalQueryKeys.pendingApprovalsRoot(),
        portalQueryKeys.dashboardStatsRoot(),
        portalQueryKeys.equipmentActivityRoot(),
      ])

      if (activeSelectedEquipment?.id) {
        const refreshed = await fetchEquipmentReportsList(activeSelectedEquipment.id)
        setReports(refreshed)
        setViewedReport(
          refreshed.find((item) => String(item.id) === String(variables.reportId)) || updatedReport,
        )
      } else {
        setViewedReport(updatedReport)
      }

      if (isOwner && !selectedCompanyId) {
        await Promise.all([refreshPendingReportApprovals(), refreshDashboardStats()])
      }

      await refreshEquipmentListForCurrentSelection()
      clearReportDraft()
      setReportForm(buildEmptyReportForm())
      setShowEditReportModal(false)
      setReportUnsavedPrompt('')
    },
    onError: (error) => {
      setEditReportError(String(error?.message || 'Unable to save report changes.'))
    },
    onSettled: () => {
      setSavingReportEdit(false)
    },
  })
  const createReportMutation = useMutation({
    mutationFn: ({ equipmentId, payload }) => createEquipmentReport(equipmentId, payload),
    onMutate: async () => {
      setCreatingReport(true)
      setCreateReportError('')
    },
    onSuccess: async (_result, variables) => {
      await invalidatePortalCaches([
        portalQueryKeys.reportsRoot(),
        portalQueryKeys.equipmentRoot(),
        portalQueryKeys.pendingApprovalsRoot(),
        portalQueryKeys.dashboardStatsRoot(),
        portalQueryKeys.equipmentActivityRoot(),
      ])
      const refreshed = await fetchEquipmentReportsList(variables.equipmentId)
      setReports(refreshed)
      await refreshEquipmentListForCurrentSelection()
      clearReportDraft()
      setReportForm(buildEmptyReportForm())
      setShowCreateReportForm(false)
      setReportUnsavedPrompt('')
      setShowReportSubmissionConfirmModal(false)
      setReportSubmissionConfirmChecks(REPORT_SUBMISSION_CONFIRMATION_ITEMS.map(() => false))
    },
    onError: (error) => {
      setCreateReportError(String(error?.message || 'Unable to create report.'))
    },
    onSettled: () => {
      setCreatingReport(false)
    },
  })
  const saveCreateReportDraftMutation = useMutation({
    mutationFn: ({ equipmentId, payload }) => createEquipmentReport(equipmentId, payload),
    onMutate: async () => {
      setCreatingReport(true)
      setCreateReportError('')
    },
    onSuccess: async (_result, variables) => {
      await invalidatePortalCaches([
        portalQueryKeys.reportsRoot(),
        portalQueryKeys.equipmentRoot(),
        portalQueryKeys.equipmentActivityRoot(),
      ])
      const refreshed = await fetchEquipmentReportsList(variables.equipmentId)
      setReports(refreshed)
      await refreshEquipmentData()
      showSuccessToast('Report draft saved.', 'Draft Saved')
      setReportUnsavedPrompt('')
      await closeCreateReportForm(true)
    },
    onError: (error) => {
      setCreateReportError(String(error?.message || 'Unable to save report draft.'))
    },
    onSettled: () => {
      setCreatingReport(false)
    },
  })
  const equipmentActivityLoading = equipmentActivityQuery.isLoading || equipmentActivityQuery.isFetching
  const sortedEquipment = useMemo(() => {
    const sortDirection = equipmentSortDirection === 'desc' ? -1 : 1
    const compareEquipment = (left, right) => {
      if (equipmentSortKey === 'name') {
        const nameComparison = String(left.name || '').localeCompare(String(right.name || ''))
        if (nameComparison !== 0) return nameComparison * sortDirection
      }

      if (equipmentSortKey === 'asset_tag') {
        const assetTagComparison = String(left.asset_tag || '').localeCompare(String(right.asset_tag || ''))
        if (assetTagComparison !== 0) return assetTagComparison * sortDirection
      }

      if (equipmentSortKey === 'next_due') {
        const leftDue = getInspectionDueSortValue(left.next_inspection_due)
        const rightDue = getInspectionDueSortValue(right.next_inspection_due)
        if (leftDue !== rightDue) return (leftDue - rightDue) * sortDirection
      }

      const fallbackNameComparison = String(left.name || '').localeCompare(String(right.name || ''))
      if (fallbackNameComparison !== 0) return fallbackNameComparison

      return Number(left.id) - Number(right.id)
    }

    return {
      active: equipment
        .filter((item) => item.status !== 'decommissioned')
        .sort(compareEquipment),
      decommissioned: equipment
        .filter((item) => item.status === 'decommissioned')
        .sort(compareEquipment),
    }
  }, [equipment, equipmentSortDirection, equipmentSortKey])

  const activeEquipment = sortedEquipment.active || []
  const decommissionedEquipment = sortedEquipment.decommissioned || []
  const currentTableEquipment = useMemo(() => {
    if (equipmentTableTab === 'decommissioned') return decommissionedEquipment
    if (equipmentTableTab === 'all') return [...activeEquipment, ...decommissionedEquipment]
    return activeEquipment
  }, [activeEquipment, decommissionedEquipment, equipmentTableTab])
  const statusFilteredEquipment = useMemo(() => {
    if (equipmentTableTab !== 'active' || equipmentStatusFilter === EQUIPMENT_STATUS_FILTER_ALL) {
      return currentTableEquipment
    }

    return currentTableEquipment.filter((item) => {
      const itemStatusKey =
        String(item.inspection_status_key || '').trim().toLowerCase() || EQUIPMENT_STATUS_FILTER_NO_REPORT
      return itemStatusKey === equipmentStatusFilter
    })
  }, [currentTableEquipment, equipmentStatusFilter, equipmentTableTab])
  const urgencyFilteredEquipment = useMemo(() => {
    if (inspectionUrgencyFilter === 'all') return statusFilteredEquipment

    return statusFilteredEquipment.filter((item) => {
      const urgencyLabel = String(getInspectionStatusBadge(item.next_inspection_due).label || '').toLowerCase()
      if (inspectionUrgencyFilter === 'overdue') return urgencyLabel === 'overdue'
      if (inspectionUrgencyFilter === 'due_soon') return urgencyLabel === 'inspection due'
      if (inspectionUrgencyFilter === 'on_schedule') return urgencyLabel === 'on schedule'
      return true
    })
  }, [inspectionUrgencyFilter, statusFilteredEquipment])

  const equipmentTotalPages = Math.max(1, Math.ceil(urgencyFilteredEquipment.length / equipmentPageSize))
  const equipmentStartIndex = (equipmentPage - 1) * equipmentPageSize
  const visibleEquipment = useMemo(
    () => urgencyFilteredEquipment.slice(equipmentStartIndex, equipmentStartIndex + equipmentPageSize),
    [urgencyFilteredEquipment, equipmentStartIndex, equipmentPageSize],
  )
  const equipmentRangeStart = urgencyFilteredEquipment.length === 0 ? 0 : equipmentStartIndex + 1
  const equipmentRangeEnd = Math.min(equipmentStartIndex + equipmentPageSize, urgencyFilteredEquipment.length)

  const pendingApprovalsTotalPages = Math.max(1, Math.ceil(pendingReportApprovals.length / pendingApprovalsPageSize))
  const pendingApprovalsStartIndex = (pendingApprovalsPage - 1) * pendingApprovalsPageSize
  const visiblePendingApprovals = useMemo(
    () => pendingReportApprovals.slice(pendingApprovalsStartIndex, pendingApprovalsStartIndex + pendingApprovalsPageSize),
    [pendingReportApprovals, pendingApprovalsStartIndex, pendingApprovalsPageSize],
  )
  const pendingApprovalsRangeStart = pendingReportApprovals.length === 0 ? 0 : pendingApprovalsStartIndex + 1
  const pendingApprovalsRangeEnd = Math.min(pendingApprovalsStartIndex + pendingApprovalsPageSize, pendingReportApprovals.length)

  const equipmentActivityTotalPages = Math.max(1, Math.ceil(equipmentActivity.length / equipmentActivityPageSize))
  const equipmentActivityStartIndex = (equipmentActivityPage - 1) * equipmentActivityPageSize
  const visibleEquipmentActivity = useMemo(
    () => equipmentActivity.slice(equipmentActivityStartIndex, equipmentActivityStartIndex + equipmentActivityPageSize),
    [equipmentActivity, equipmentActivityStartIndex, equipmentActivityPageSize],
  )
  const equipmentActivityRangeStart = equipmentActivity.length === 0 ? 0 : equipmentActivityStartIndex + 1
  const equipmentActivityRangeEnd = Math.min(
    equipmentActivityStartIndex + equipmentActivityPageSize,
    equipmentActivity.length,
  )
  const recoveredAtMsByRecoverableTarget = useMemo(() => {
    const next = new Map()
    equipmentActivity
      .filter((entry) => {
        const action = String(entry?.action || '').trim().toLowerCase()
        return action === 'certificate.recovered' || action === 'report.recovered'
      })
      .forEach((entry) => {
        const action = String(entry?.action || '').trim().toLowerCase()
        const targetType = action.startsWith('certificate.') ? 'certificate' : action.startsWith('report.') ? 'report' : ''
        const targetId = targetType === 'certificate' ? getActivityCertificateId(entry) : getActivityReportId(entry)
        const recoveredAtMs = new Date(entry?.created_at).getTime()
        if (!targetType || !targetId || !Number.isFinite(recoveredAtMs) || recoveredAtMs <= 0) return

        const recoveryKey = `${targetType}:${targetId}`

        const previousRecoveredAtMs = Number(next.get(recoveryKey) || 0)
        if (recoveredAtMs > previousRecoveredAtMs) {
          next.set(recoveryKey, recoveredAtMs)
        }
      })

    return next
  }, [equipmentActivity])

  useEffect(() => {
    const validPendingIds = new Set(visiblePendingApprovals.map((item) => String(item.id)))
    setSelectedPendingApprovalIds((current) => {
      const next = current.filter((id) => validPendingIds.has(String(id)))
      if (next.length === current.length && next.every((id, index) => id === current[index])) {
        return current
      }
      return next
    })
  }, [visiblePendingApprovals])

  useEffect(() => {
    const validEquipmentIds = new Set(activeEquipment.map((item) => String(item.id)))
    setSelectedEquipmentIds((current) => {
      const next = current.filter((id) => validEquipmentIds.has(String(id)))
      if (next.length === current.length && next.every((id, index) => id === current[index])) {
        return current
      }
      return next
    })
  }, [activeEquipment])

  function buildExportDateSuffix() {
    return new Date().toISOString().slice(0, 10)
  }

  function handleExportCustomersCsv() {
    const rows = filteredCustomers.map((item) => ({
      id: item.id,
      name: item.name,
      contact_email: item.contact_email,
      contact_phone: item.contact_phone,
      address: item.address,
      inspections_due_count: Number(item.inspections_due_count || 0),
      inspections_overdue_count: Number(item.inspections_overdue_count || 0),
      is_active: item.is_active,
    }))

    exportRowsToCsv({
      filename: `customers-${buildExportDateSuffix()}.csv`,
      columns: [
        { key: 'id', header: 'ID' },
        { key: 'name', header: 'Customer Name' },
        { key: 'contact_email', header: 'Email' },
        { key: 'contact_phone', header: 'Phone' },
        { key: 'address', header: 'Address' },
        { key: 'inspections_due_count', header: 'Due (14d)' },
        { key: 'inspections_overdue_count', header: 'Overdue' },
        { key: 'is_active', header: 'Active' },
      ],
      rows,
    })

    setPortalToast({
      title: 'Customers Exported',
      message: `${rows.length} customer row${rows.length === 1 ? '' : 's'} exported to CSV.`,
    })
  }

  function handleExportEquipmentCsv() {
    const rows = urgencyFilteredEquipment.map((item) => ({
      id: item.id,
      name: item.name,
      asset_tag: item.asset_tag,
      serial_number: item.serial_number,
      safe_working_load: item.safe_working_load,
      location: item.location,
      status: item.status === 'decommissioned' ? 'decommissioned' : item.inspection_status_label || 'No Approved Report',
      inspection_interval_days: item.inspection_interval_days,
      last_inspected_at: item.last_inspected_at,
      next_inspection_due: item.next_inspection_due,
      notes: item.notes,
    }))

    exportRowsToCsv({
      filename: `equipment-${buildExportDateSuffix()}.csv`,
      columns: [
        { key: 'id', header: 'ID' },
        { key: 'name', header: 'Name' },
        { key: 'asset_tag', header: 'Asset Tag' },
        { key: 'serial_number', header: 'Serial Number' },
        { key: 'safe_working_load', header: 'Safe Working Load' },
        { key: 'location', header: 'Location' },
        { key: 'status', header: 'Status' },
        { key: 'inspection_interval_days', header: 'Inspection Interval (Days)' },
        { key: 'last_inspected_at', header: 'Last Inspected' },
        { key: 'next_inspection_due', header: 'Next Inspection Due' },
        { key: 'notes', header: 'Notes' },
      ],
      rows,
    })

    setPortalToast({
      title: 'Equipment Exported',
      message: `${rows.length} equipment row${rows.length === 1 ? '' : 's'} exported to CSV.`,
    })
  }

  function handleExportReportsCsv() {
    const rows = filteredReports.map((report) => ({
      id: report.id,
      equipment_id: report.equipment_id || activeSelectedEquipment?.id || '',
      equipment_name: report.equipment_name || activeSelectedEquipment?.name || '',
      title: report.title,
      report_date: report.report_date,
      status: report.status,
      submitted_by_name: report.submitted_by_name,
      summary: report.summary,
      findings: report.findings,
      recommendations: report.recommendations,
    }))

    exportRowsToCsv({
      filename: `reports-${buildExportDateSuffix()}.csv`,
      columns: [
        { key: 'id', header: 'Report ID' },
        { key: 'equipment_id', header: 'Equipment ID' },
        { key: 'equipment_name', header: 'Equipment Name' },
        { key: 'title', header: 'Title' },
        { key: 'report_date', header: 'Report Date' },
        { key: 'status', header: 'Status' },
        { key: 'submitted_by_name', header: 'Inspector' },
        { key: 'summary', header: 'Summary' },
        { key: 'findings', header: 'Findings' },
        { key: 'recommendations', header: 'Recommendations' },
      ],
      rows,
    })

    setPortalToast({
      title: 'Reports Exported',
      message: `${rows.length} report row${rows.length === 1 ? '' : 's'} exported to CSV.`,
    })
  }

  function togglePendingApprovalSelection(reportId) {
    const key = String(reportId)
    setSelectedPendingApprovalIds((current) =>
      current.includes(key) ? current.filter((id) => id !== key) : [...current, key],
    )
  }

  function toggleSelectAllPendingApprovals() {
    const allIds = pendingReportApprovals.map((item) => String(item.id))
    setSelectedPendingApprovalIds((current) => (current.length === allIds.length ? [] : allIds))
  }

  async function handleBulkApproveReports() {
    if (!isOwner || selectedPendingApprovalIds.length === 0 || bulkApprovingReports) return

    try {
      await bulkApproveReportsMutation.mutateAsync({
        reportIds: [...selectedPendingApprovalIds],
      })
    } catch {
      // Errors are handled in mutation callbacks.
    }
  }

  function toggleEquipmentSelection(equipmentId) {
    const key = String(equipmentId)
    setSelectedEquipmentIds((current) =>
      current.includes(key) ? current.filter((id) => id !== key) : [...current, key],
    )
  }

  function toggleSelectAllEquipment() {
    const allIds = activeEquipment.map((item) => String(item.id))
    setSelectedEquipmentIds((current) => (current.length === allIds.length ? [] : allIds))
  }

  async function handleBulkDecommissionEquipment() {
    if (!isOwner || selectedEquipmentIds.length === 0 || bulkDecommissioningEquipment) return

    try {
      await bulkDecommissionEquipmentMutation.mutateAsync({
        equipmentIds: [...selectedEquipmentIds],
      })
    } catch {
      // Errors are handled in mutation callbacks.
    }
  }

  function toggleCustomerSelection(customerId) {
    const key = String(customerId)
    setSelectedCustomerIds((current) =>
      current.includes(key) ? current.filter((id) => id !== key) : [...current, key],
    )
  }

  function toggleSelectAllCustomers() {
    const allIds = filteredCustomers.map((item) => String(item.id))
    setSelectedCustomerIds((current) => (current.length === allIds.length ? [] : allIds))
  }

  async function handleBulkDeactivateCustomers() {
    if (!isOwner || selectedCustomerIds.length === 0 || bulkDeactivatingCustomers) return

    setBulkDeactivatingCustomers(true)
    setCustomerEditError('')

    try {
      const targetCustomers = filteredCustomers.filter((item) => selectedCustomerIds.includes(String(item.id)))

      await Promise.all(
        targetCustomers.map((item) =>
          updatePortalCustomer({
            company_id: Number(item.id),
            company_name: item.name,
            company_contact_email: item.contact_email || '',
            company_contact_phone: item.contact_phone || '',
            company_address: item.address || '',
            is_active: false,
          }),
        ),
      )

      await invalidatePortalCaches([
        portalQueryKeys.companies(),
        portalQueryKeys.dashboardStatsRoot(),
      ])

      setSelectedCustomerIds([])
      await Promise.all([refreshCustomerCompanies(), refreshDashboardStats(true)])
      showSuccessToast('Selected customers have been deactivated.', 'Customers Updated')
    } catch (error) {
      setCustomerEditError(String(error?.message || 'Unable to deactivate selected customers.'))
    } finally {
      setBulkDeactivatingCustomers(false)
    }
  }

  function handlePrintViewedReport() {
    if (!viewedReport) return

    const checklistSections = getChecklistSections(viewedReport.checklist_items)
    const isNotPresentedReport = isChecklistMarkedNotPresented(checklistSections)
    const wornItemsHtml =
      checklistSections.worn.length === 0
        ? '<p class="muted">None reported.</p>'
        : `<ul>${checklistSections.worn
            .map(
              (item) =>
                `<li><strong>${escapeHtml(item.label)}</strong><br/>Finding: ${escapeHtml(item.finding || '-')}<br/>Recommendation: ${escapeHtml(item.recommendation || '-')}</li>`,
            )
            .join('')}</ul>`
    const attentionItemsHtml =
      checklistSections.attention.length === 0
        ? '<p class="muted">None reported.</p>'
        : `<ul>${checklistSections.attention
            .map(
              (item) =>
                `<li><strong>${escapeHtml(item.label)}</strong><br/>Finding: ${escapeHtml(item.finding || '-')}<br/>Recommendation: ${escapeHtml(item.recommendation || '-')}</li>`,
            )
            .join('')}</ul>`
    const notPresentedSectionHtml =
      checklistSections.notPresented.length > 0
        ? `
      <div class="section">
        <h2>Not Presented</h2>
        <div class="card">
          <ul>${checklistSections.notPresented
            .map((item) => `<li><strong>${escapeHtml(item.label)}</strong>: Not presented for examination.</li>`)
            .join('')}</ul>
        </div>
      </div>
      `
        : ''

    const reportHtml = `
      <h1>${escapeHtml(viewedReport.title || 'Inspection Report')}</h1>
      <div class="meta">
        <p><strong>Equipment:</strong> ${escapeHtml(viewedReport.equipment_name || activeSelectedEquipment?.name || '-')}</p>
        <p><strong>Date:</strong> ${escapeHtml(viewedReport.report_date || '-')}</p>
        <p><strong>Status:</strong> ${escapeHtml(viewedReport.status || '-')}</p>
        <p><strong>Inspector:</strong> ${escapeHtml(viewedReport.submitted_by_name || '-')}</p>
      </div>
      <div class="section">
        <h2>Summary</h2>
        <p>${escapeHtml(viewedReport.summary || '-')}</p>
      </div>
      ${
        isNotPresentedReport
          ? `
      <div class="section">
        <h2>Status</h2>
        <div class="card" style="border:1px solid #fecaca;background:#fee2e2;color:#991b1b;font-weight:700;">Not Presented</div>
      </div>
      `
          : `
      <div class="section">
        <h2>Worn but Servicable</h2>
        <div class="card">${wornItemsHtml}</div>
      </div>
      <div class="section">
        <h2>Attention Required</h2>
        <div class="card">${attentionItemsHtml}</div>
      </div>
      ${notPresentedSectionHtml}
      `
      }
    `

    const printWindow = window.open('', '_blank', 'width=980,height=760')
    if (!printWindow) return
    printWindow.document.open()
    printWindow.document.write(buildPrintDocument(`Report - ${viewedReport.title || 'Inspection Report'}`, reportHtml))
    printWindow.document.close()
  }

  const equipmentNextDuePreview = useMemo(
    () => calculateNextInspectionDue(equipmentForm.last_inspected_at, equipmentForm.inspection_interval_days),
    [equipmentForm.inspection_interval_days, equipmentForm.last_inspected_at],
  )
  const normalizedCustomerSearch = customerSearchInput.trim().toLowerCase()
  const filteredCustomers = useMemo(() => {
    return companies.filter((item) => {
      const dueCount = Number(item.inspections_due_count || 0)
      const overdueCount = Number(item.inspections_overdue_count || 0)

      if (customerStatsFilter === 'overdue' && overdueCount < 1) {
        return false
      }

      if (customerStatsFilter === 'due_soon' && dueCount < 1) {
        return false
      }

      if (!normalizedCustomerSearch) return true

      const haystack = [item.name, item.contact_email, item.contact_phone]
        .map((value) => String(value || '').toLowerCase())
        .join(' ')
      return haystack.includes(normalizedCustomerSearch)
    })
  }, [companies, customerStatsFilter, normalizedCustomerSearch])
  const customerTotalPages = Math.max(1, Math.ceil(filteredCustomers.length / customerPageSize))
  const customerStartIndex = (customerPage - 1) * customerPageSize
  const visibleCustomers = filteredCustomers.slice(customerStartIndex, customerStartIndex + customerPageSize)

  useEffect(() => {
    const validCustomerIds = new Set(filteredCustomers.map((item) => String(item.id)))
    setSelectedCustomerIds((current) => current.filter((id) => validCustomerIds.has(String(id))))
  }, [filteredCustomers])

  const normalizedEmployeeSearch = employeeSearchInput.trim().toLowerCase()
  const currentStaffAssignments = useMemo(
    () => (employeeControlsTab === 'inactive' ? inactiveStaffAssignments : activeStaffAssignments),
    [employeeControlsTab, activeStaffAssignments, inactiveStaffAssignments],
  )
  const filteredStaffAssignments = useMemo(() => {
    if (!normalizedEmployeeSearch) return currentStaffAssignments
    return currentStaffAssignments.filter((assignment) => {
      const haystack = [assignment.username, assignment.email, assignment.full_name]
        .map((value) => String(value || '').toLowerCase())
        .join(' ')
      return haystack.includes(normalizedEmployeeSearch)
    })
  }, [currentStaffAssignments, normalizedEmployeeSearch])
  const employeeTotalPages = Math.max(1, Math.ceil(filteredStaffAssignments.length / employeePageSize))
  const employeeStartIndex = (employeePage - 1) * employeePageSize
  const visibleStaffAssignments = filteredStaffAssignments.slice(
    employeeStartIndex,
    employeeStartIndex + employeePageSize,
  )
  const activeCompanyPickerAssignment = useMemo(
    () => activeStaffAssignments.find((item) => String(item.user_id) === String(companyPickerUserId)) || null,
    [activeStaffAssignments, companyPickerUserId],
  )
  const filteredCompanyPickerCompanies = useMemo(() => {
    const query = companyPickerSearchInput.trim().toLowerCase()
    if (!query) return companies
    return companies.filter((item) => String(item.name || '').toLowerCase().includes(query))
  }, [companies, companyPickerSearchInput])
  const normalizedReportChecklistItems = useMemo(
    () => normalizeReportChecklistItems(reportForm.checklist_items),
    [reportForm.checklist_items],
  )
  const existingChecklistImagesByLabel = useMemo(
    () => getChecklistImagesByLabel(reportForm.existingImages),
    [reportForm.existingImages],
  )
  const isEditingReport = Boolean(reportForm.reportId)
  const isAnyModalOpen = Boolean(
    viewedReport ||
      showEditReportModal ||
      showRevisionsModal ||
      showCreateReportForm ||
      showCreateCustomerForm ||
      showEditCustomerForm ||
      showCreateEmployeeForm ||
      companyPickerUserId ||
        showChangePasswordModal ||
      showCreateEquipmentForm ||
      showDecommissionConfirm ||
      showReportSubmissionConfirmModal ||
      showGeneratedCertificatePreviewModal ||
        showEquipmentQrModal ||
      showSessionExpiryWarning,
  )
  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia('(max-width: 767px)').matches
  })
  const createReportBaseDate = useMemo(() => buildEmptyReportForm().report_date, [])
  const isCreateCustomerDirty = useMemo(
    () => Object.values(customerForm).some((value) => String(value || '').trim() !== ''),
    [customerForm],
  )
  const isEditCustomerDirty = useMemo(() => {
    const initial = initialCustomerEditFormRef.current
    return (
      String(customerEditForm.company_name || '') !== String(initial.company_name || '') ||
      String(customerEditForm.company_contact_email || '') !== String(initial.company_contact_email || '') ||
      String(customerEditForm.company_contact_phone || '') !== String(initial.company_contact_phone || '') ||
      String(customerEditForm.company_address || '') !== String(initial.company_address || '') ||
      Boolean(customerEditForm.deactivate_customer)
    )
  }, [customerEditForm])
  const isCreateEmployeeDirty = useMemo(
    () =>
      String(employeeForm.email || '').trim() !== '' ||
      String(employeeForm.password || '').trim() !== '' ||
      String(employeeForm.first_name || '').trim() !== '' ||
      String(employeeForm.last_name || '').trim() !== '' ||
      String(employeeForm.role || 'engineer') !== 'engineer' ||
      (employeeForm.allowed_company_ids || []).length > 0,
    [employeeForm],
  )
  const isCreateEquipmentDirty = useMemo(
    () =>
      String(equipmentForm.name || '').trim() !== '' ||
      String(equipmentForm.asset_tag || '').trim() !== '' ||
      String(equipmentForm.serial_number || '').trim() !== '' ||
      String(equipmentForm.safe_working_load || '').trim() !== '' ||
      String(equipmentForm.location || '').trim() !== '' ||
      String(equipmentForm.status || 'active') !== 'active' ||
      Number(equipmentForm.inspection_interval_days || 365) !== 365 ||
      String(equipmentForm.last_inspected_at || '').trim() !== '' ||
      String(equipmentForm.notes || '').trim() !== '',
    [equipmentForm],
  )
  const isPasswordDirty = useMemo(
    () =>
      String(passwordForm.current_password || '').trim() !== '' ||
      String(passwordForm.new_password || '').trim() !== '' ||
      String(passwordForm.confirm_password || '').trim() !== '',
    [passwordForm],
  )
  const isCreateReportDirty = useMemo(
    () =>
      String(reportForm.title || '').trim() !== '' ||
      String(reportForm.summary || '').trim() !== '' ||
      String(reportForm.findings || '').trim() !== '' ||
      String(reportForm.recommendations || '').trim() !== '' ||
      String(reportForm.report_date || createReportBaseDate) !== String(createReportBaseDate) ||
      normalizeReportChecklistItems(reportForm.checklist_items).some(
        (item) =>
          item.status !== REPORT_CHECKLIST_STATUS_GOOD ||
          String(item.finding || '').trim() !== '' ||
          String(item.recommendation || '').trim() !== '',
      ) ||
      Object.values(reportForm.checklistImageFilesByLabel || {}).some(
        (files) => (Array.isArray(files) ? files : []).length > 0,
      ) ||
      (reportForm.images || []).length > 0,
    [reportForm, createReportBaseDate],
  )
  const isEditReportDirty = useMemo(() => {
    const initial = initialReportEditFormRef.current
    return (
      String(reportForm.title || '') !== String(initial.title || '') ||
      String(reportForm.summary || '') !== String(initial.summary || '') ||
      String(reportForm.findings || '') !== String(initial.findings || '') ||
      String(reportForm.recommendations || '') !== String(initial.recommendations || '') ||
      String(reportForm.report_date || '') !== String(initial.report_date || '') ||
      String(reportForm.status || '') !== String(initial.status || '') ||
      JSON.stringify(normalizeReportChecklistItems(reportForm.checklist_items)) !==
        JSON.stringify(normalizeReportChecklistItems(initial.checklist_items)) ||
      Object.values(reportForm.checklistImageFilesByLabel || {}).some(
        (files) => (Array.isArray(files) ? files : []).length > 0,
      ) ||
      (reportForm.images || []).length > 0 ||
      (reportForm.removedImageIds || []).length > 0
    )
  }, [reportForm])

  function closeCreateCustomerForm(force = false) {
    if (!force && isCreateCustomerDirty) {
      setUnsavedChangesPrompt('createCustomer')
      return false
    }
    setShowCreateCustomerForm(false)
    setCustomerCreateError('')
    setCustomerForm(buildEmptyCustomerForm())
    return true
  }

  function closeEditCustomerForm(force = false) {
    if (!force && isEditCustomerDirty) {
      setUnsavedChangesPrompt('editCustomer')
      return false
    }
    setShowEditCustomerForm(false)
    setConfirmCustomerDeactivate(false)
    setCustomerEditForm(buildEmptyCustomerEditForm())
    return true
  }

  function closeCreateEmployeeForm(force = false) {
    if (!force && isCreateEmployeeDirty) {
      setUnsavedChangesPrompt('createEmployee')
      return false
    }
    setShowCreateEmployeeForm(false)
    setEmployeeForm(buildEmptyEmployeeForm())
    return true
  }

  function closeCreateEquipmentForm(force = false) {
    if (!force && isCreateEquipmentDirty) {
      setUnsavedChangesPrompt('createEquipment')
      return false
    }
    setShowCreateEquipmentForm(false)
    setEquipmentForm(buildEmptyEquipmentForm())
    setEquipmentCreateError('')
    return true
  }

  function closeChangePasswordModal(force = false) {
    if (profile?.requiredPasswordChange) return false
    if (!force && isPasswordDirty) {
      setUnsavedChangesPrompt('changePassword')
      return false
    }
    setShowChangePasswordModal(false)
    setPasswordForm(buildEmptyPasswordForm())
    setPasswordChangeError('')
    setPasswordChangeSuccess('')
    return true
  }

  async function closeCreateReportForm(force = false) {
    if (creatingReport || savingReportEdit) return false

    if (!force && isCreateReportDirty) {
      setReportUnsavedPrompt('create')
      return false
    }

    setShowCreateReportForm(false)
    setReportForm(buildEmptyReportForm())
    setCreateReportError('')
    clearReportDraft()
    return true
  }

  async function saveCreateReportDraftAndClose() {
    if (creatingReport || savingReportEdit) return false
    if (!isCreateReportDirty) {
      setReportUnsavedPrompt('')
      return closeCreateReportForm(true)
    }

    if (!activeSelectedEquipment?.id) {
      setCreateReportError('Select equipment before saving a draft report.')
      return false
    }

    const normalizedChecklistItems = normalizeReportChecklistItems(reportForm.checklist_items)

    try {
      await saveCreateReportDraftMutation.mutateAsync({
        equipmentId: activeSelectedEquipment.id,
        payload: {
          ...reportForm,
          checklist_items: normalizedChecklistItems,
          status: 'draft',
        },
      })
      return true
    } catch {
      return false
    }
  }

  function clearPromptAndRun(action) {
    setUnsavedChangesPrompt('')
    action()
  }

  async function handleUnsavedPromptSave() {
    if (unsavedChangesPrompt === 'createCustomer') {
      clearPromptAndRun(() => closeCreateCustomerForm(true))
      return
    }

    if (unsavedChangesPrompt === 'editCustomer') {
      setUnsavedChangesPrompt('')
      await saveEditCustomer()
      return
    }

    if (unsavedChangesPrompt === 'createEmployee') {
      clearPromptAndRun(() => closeCreateEmployeeForm(true))
      return
    }

    if (unsavedChangesPrompt === 'createEquipment') {
      clearPromptAndRun(() => closeCreateEquipmentForm(true))
      return
    }

    if (unsavedChangesPrompt === 'changePassword') {
      clearPromptAndRun(() => closeChangePasswordModal(true))
      return
    }

  }

  function handleUnsavedPromptRevert() {
    if (unsavedChangesPrompt === 'createCustomer') {
      clearPromptAndRun(() => {
        setShowCreateCustomerForm(false)
        setCustomerCreateError('')
        setCustomerForm(buildEmptyCustomerForm())
      })
      return
    }

    if (unsavedChangesPrompt === 'editCustomer') {
      clearPromptAndRun(() => {
        setShowEditCustomerForm(false)
        setConfirmCustomerDeactivate(false)
        setCustomerEditForm(buildEmptyCustomerEditForm())
      })
      return
    }

    if (unsavedChangesPrompt === 'createEmployee') {
      clearPromptAndRun(() => {
        setShowCreateEmployeeForm(false)
        setEmployeeForm(buildEmptyEmployeeForm())
      })
      return
    }

    if (unsavedChangesPrompt === 'createEquipment') {
      clearPromptAndRun(() => {
        setShowCreateEquipmentForm(false)
        setEquipmentForm(buildEmptyEquipmentForm())
        setEquipmentCreateError('')
      })
      return
    }

    if (unsavedChangesPrompt === 'changePassword') {
      clearPromptAndRun(() => {
        setShowChangePasswordModal(false)
        setPasswordForm(buildEmptyPasswordForm())
        setPasswordChangeError('')
        setPasswordChangeSuccess('')
      })
      return
    }

  }

  function openCreateReportForm() {
    const baseReportForm = buildEmptyReportForm()
    const storedDraft = readReportDraft()
    const activeEquipmentId = String(activeSelectedEquipment?.id || '')
    if (
      storedDraft?.mode === 'create' &&
      String(storedDraft?.equipmentId || '') === activeEquipmentId &&
      storedDraft?.form &&
      typeof storedDraft.form === 'object'
    ) {
      setReportForm({
        ...baseReportForm,
        ...storedDraft.form,
        checklist_items: normalizeReportChecklistItems(storedDraft.form?.checklist_items),
        checklistImageFilesByLabel: {},
        images: [],
        existingImages: [],
        removedImageIds: [],
      })
      showSuccessToast('Restored your saved report draft.', 'Draft Restored')
    } else {
      setReportForm(baseReportForm)
    }

    setCreateReportError('')
    setShowReportSubmissionConfirmModal(false)
    setReportSubmissionConfirmChecks(REPORT_SUBMISSION_CONFIRMATION_ITEMS.map(() => false))
    setShowCreateReportForm(true)
  }

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
    if (!portalToast) return
    const timer = setTimeout(() => setPortalToast(null), 3500)
    return () => clearTimeout(timer)
  }, [portalToast])

  useEffect(() => {
    if (typeof window === 'undefined') return

    if (showCreateReportForm && isCreateReportDirty) {
      writeReportDraft({
        mode: 'create',
        equipmentId: String(activeSelectedEquipment?.id || ''),
        form: {
          title: reportForm.title,
          summary: reportForm.summary,
          findings: reportForm.findings,
          recommendations: reportForm.recommendations,
          checklist_items: normalizeReportChecklistItems(reportForm.checklist_items),
          report_date: reportForm.report_date,
          status: reportForm.status,
        },
      })
      return
    }

    if (showEditReportModal && isEditReportDirty) {
      writeReportDraft({
        mode: 'edit',
        reportId: String(reportForm.reportId || ''),
        form: {
          title: reportForm.title,
          summary: reportForm.summary,
          findings: reportForm.findings,
          recommendations: reportForm.recommendations,
          checklist_items: normalizeReportChecklistItems(reportForm.checklist_items),
          report_date: reportForm.report_date,
          status: reportForm.status,
          removedImageIds: reportForm.removedImageIds || [],
        },
      })
    }
  }, [
    showCreateReportForm,
    showEditReportModal,
    isCreateReportDirty,
    isEditReportDirty,
    activeSelectedEquipment?.id,
    reportForm,
  ])

  useEffect(() => {
    setConfirmDeleteDraftReportId('')
  }, [viewedReport?.id])

  useEffect(() => {
    if (!showCreateReportForm && !showEditReportModal) {
      setReportUnsavedPrompt('')
    }
  }, [showCreateReportForm, showEditReportModal])

  useEffect(() => {
    if (
      showCreateCustomerForm ||
      showEditCustomerForm ||
      showCreateEmployeeForm ||
      showCreateEquipmentForm ||
      showChangePasswordModal
    ) {
      return
    }

    setUnsavedChangesPrompt('')
  }, [
    showCreateCustomerForm,
    showEditCustomerForm,
    showCreateEmployeeForm,
    showCreateEquipmentForm,
    showChangePasswordModal,
  ])

  const customersLastUpdatedLabel = useMemo(
    () => formatLastUpdatedLabel(customersLastUpdatedAt, nowMs),
    [customersLastUpdatedAt, nowMs],
  )
  const equipmentLastUpdatedLabel = useMemo(
    () => formatLastUpdatedLabel(equipmentLastUpdatedAt, nowMs),
    [equipmentLastUpdatedAt, nowMs],
  )
  const pendingApprovalsLastUpdatedLabel = useMemo(
    () => formatLastUpdatedLabel(pendingApprovalsLastUpdatedAt, nowMs),
    [pendingApprovalsLastUpdatedAt, nowMs],
  )

  // Handle session expiry and redirect to login with message
  useEffect(() => {
    const handleSessionExpired = () => {
      navigate('/portal/login', { state: { sessionExpired: true } })
    }
    window.addEventListener('portalSessionExpired', handleSessionExpired)
    return () => window.removeEventListener('portalSessionExpired', handleSessionExpired)
  }, [navigate])

  useEffect(() => {
    if (!isAuthenticated) return undefined

    const updateSessionWarning = () => {
      const expiresAtMs = getSessionExpiryMs(getAccessToken())
      if (!expiresAtMs) {
        setShowSessionExpiryWarning(false)
        setSessionWarningError('')
        return
      }

      const remainingMs = expiresAtMs - Date.now()
      if (remainingMs <= 0) {
        clearPortalSession()
        return
      }

      if (remainingMs <= SESSION_WARNING_WINDOW_MS) {
        setShowSessionExpiryWarning(true)
      } else {
        setShowSessionExpiryWarning(false)
        setSessionWarningError('')
      }
    }

    updateSessionWarning()
    const interval = setInterval(updateSessionWarning, SESSION_WARNING_CHECK_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [isAuthenticated])

  useEffect(() => {
    if (suppressQuerySyncUntilCustomerListRef.current) {
      if (!selectedCompanyId) {
        suppressQuerySyncUntilCustomerListRef.current = false
      }
      return
    }

    const nextParams = new URLSearchParams()
    const queryCompanyId = String(selectedCompanyId || '').trim()

    if (queryCompanyId) nextParams.set('companyId', queryCompanyId)

    if (searchQuery) nextParams.set('q', searchQuery)

    if (reportYearFilter) nextParams.set('reportYear', reportYearFilter)

    if (equipmentTableTab !== 'active') nextParams.set('eqTab', equipmentTableTab)

    if (inspectionUrgencyFilter !== 'all') nextParams.set('eqUrgency', inspectionUrgencyFilter)

    if (equipmentTableTab === 'active' && equipmentStatusFilter !== EQUIPMENT_STATUS_FILTER_ALL) {
      nextParams.set('eqStatus', equipmentStatusFilter)
    }

    if (equipmentPage > 1) nextParams.set('eqPage', String(equipmentPage))

    if (selectedEquipment?.id) {
      nextParams.set('eqId', String(selectedEquipment.id))
    } else if (pendingDeepLinkEquipmentId) {
      nextParams.set('eqId', pendingDeepLinkEquipmentId)
    }

    if (customerPage > 1) nextParams.set('customersPage', String(customerPage))

    if (employeePage > 1) nextParams.set('employeesPage', String(employeePage))

    if (buildStableQueryString(nextParams) !== buildStableQueryString(searchParams)) {
      logEqIdSyncDebug('sync-query-params', {
        nextQuery: buildStableQueryString(nextParams),
        previousQuery: buildStableQueryString(searchParams),
        selectedEquipmentId: String(selectedEquipment?.id || ''),
        pendingDeepLinkEquipmentId,
      })
      skipNextEqIdSyncRef.current = true
      setSearchParams(nextParams, { replace: true })
    }
  }, [
    customerPage,
    employeePage,
    equipmentPage,
    equipmentTableTab,
    equipmentStatusFilter,
    inspectionUrgencyFilter,
    reportYearFilter,
    pendingDeepLinkEquipmentId,
    selectedEquipment?.id,
    selectedCompanyId,
    searchParams,
    searchQuery,
    setSearchParams,
  ])

  useEffect(() => {
    if (skipNextEqIdSyncRef.current) {
      logEqIdSyncDebug('skip-next-eqid-read', {
        reason: 'query-sync-echo',
        currentQuery: buildStableQueryString(searchParams),
      })
      skipNextEqIdSyncRef.current = false
      return
    }

    const nextDeepLinkId = String(searchParams.get('eqId') || '').trim()
    if (!nextDeepLinkId) {
      if (pendingDeepLinkEquipmentId) {
        logEqIdSyncDebug('clear-pending-eqid', {
          reason: 'query-missing-eqid',
          previousPendingEqId: pendingDeepLinkEquipmentId,
        })
        setPendingDeepLinkEquipmentId('')
      }
      return
    }

    if (String(selectedEquipment?.id || '') === nextDeepLinkId) {
      if (pendingDeepLinkEquipmentId) {
        logEqIdSyncDebug('clear-pending-eqid', {
          reason: 'query-eqid-already-selected',
          queryEqId: nextDeepLinkId,
        })
        setPendingDeepLinkEquipmentId('')
      }
      return
    }

    if (nextDeepLinkId !== pendingDeepLinkEquipmentId) {
      logEqIdSyncDebug('queue-pending-eqid', {
        queryEqId: nextDeepLinkId,
        previousPendingEqId: pendingDeepLinkEquipmentId,
      })
      setPendingDeepLinkEquipmentId(nextDeepLinkId)
    }
  }, [pendingDeepLinkEquipmentId, searchParams, selectedEquipment?.id])

  useEffect(() => {
    if (!pendingDeepLinkEquipmentId) return
    if (loading || refreshingEquipment) {
      logEqIdSyncDebug('defer-pending-eqid', {
        reason: loading ? 'loading' : 'refreshing-equipment',
        pendingEqId: pendingDeepLinkEquipmentId,
      })
      return
    }
    if (!selectedCompanyId || showsCustomerPicker) {
      logEqIdSyncDebug('defer-pending-eqid', {
        reason: !selectedCompanyId ? 'missing-company' : 'customer-picker-visible',
        pendingEqId: pendingDeepLinkEquipmentId,
      })
      return
    }

    const matchedEquipment = equipment.find(
      (item) => String(item.id) === String(pendingDeepLinkEquipmentId),
    )

    if (!matchedEquipment) {
      // During company/equipment transitions, the list can be temporarily empty.
      // Avoid clearing here or another effect can immediately re-queue the same eqId from URL.
      if (equipment.length === 0) {
        return
      }

      logEqIdSyncDebug('clear-pending-eqid', {
        reason: 'no-equipment-match',
        pendingEqId: pendingDeepLinkEquipmentId,
      })
      setPendingDeepLinkEquipmentId('')
      return
    }

    logEqIdSyncDebug('apply-pending-eqid', {
      pendingEqId: pendingDeepLinkEquipmentId,
      matchedEquipmentId: String(matchedEquipment.id),
      matchedEquipmentName: String(matchedEquipment.name || ''),
    })
    setSelectedEquipment(matchedEquipment)
    setEquipmentTableTab(matchedEquipment.status === 'decommissioned' ? 'decommissioned' : 'active')
    setEquipmentPage(1)
    setPendingDeepLinkEquipmentId('')
  }, [
    equipment,
    loading,
    pendingDeepLinkEquipmentId,
    refreshingEquipment,
    selectedCompanyId,
    showsCustomerPicker,
  ])

  useEffect(() => {
    if (equipmentPage > equipmentTotalPages) {
      setEquipmentPage(equipmentTotalPages)
    }
  }, [equipmentPage, equipmentTotalPages])

  useEffect(() => {
    if (equipmentActivityPage > equipmentActivityTotalPages) {
      setEquipmentActivityPage(equipmentActivityTotalPages)
    }
  }, [equipmentActivityPage, equipmentActivityTotalPages])

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
    if (!hasInitializedCustomerPageResetRef.current) {
      hasInitializedCustomerPageResetRef.current = true
      return
    }
    setCustomerPage(1)
  }, [customerSearchInput, customerStatsFilter, showsCustomerPicker])

  useEffect(() => {
    if (!hasInitializedEmployeePageResetRef.current) {
      hasInitializedEmployeePageResetRef.current = true
      return
    }
    setEmployeePage(1)
  }, [employeeSearchInput, employeeControlsTab, showsCustomerPicker])

  useEffect(() => {
    if (!hasInitializedEquipmentPageResetRef.current) {
      hasInitializedEquipmentPageResetRef.current = true
      return
    }
    setEquipmentPage(1)
  }, [equipmentSortKey, equipmentSortDirection, equipmentStatusFilter, inspectionUrgencyFilter])

  useEffect(() => {
    if (equipmentTableTab === 'active') return
    setEquipmentStatusFilter(EQUIPMENT_STATUS_FILTER_ALL)
  }, [equipmentTableTab])

  useEffect(() => {
    setEquipmentActivityPage(1)
  }, [activeSelectedEquipment?.id])

  useEffect(() => {
    setExpandedEquipmentCardId('')
  }, [equipmentTableTab, equipmentPage])

  useEffect(() => {
    setExpandedReportCardId('')
  }, [activeSelectedEquipment?.id])

  useEffect(() => {
    setShowReportHistory(false)
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
    if (isMobileViewport) {
      previousDesktopSelectedEquipmentIdRef.current = ''
      return
    }

    const nextSelectedId = String(selectedEquipment?.id || '')
    if (!nextSelectedId) {
      previousDesktopSelectedEquipmentIdRef.current = ''
      return
    }

    if (previousDesktopSelectedEquipmentIdRef.current === nextSelectedId) return
    previousDesktopSelectedEquipmentIdRef.current = nextSelectedId

    const frameId = window.requestAnimationFrame(() => {
      const section = equipmentDetailsSectionRef.current
      if (section) {
        const y = section.getBoundingClientRect().top + window.scrollY - 64
        window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' })
      }
      section?.focus({ preventScroll: true })
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [isMobileViewport, selectedEquipment?.id])

  useEffect(() => {
    if (!scrollToCustomerListOnBackRef.current || !showsCustomerPicker) return

    scrollToCustomerListOnBackRef.current = false
    const frameId = window.requestAnimationFrame(() => {
      const section = customerListSectionRef.current
      if (section && typeof section.scrollIntoView === 'function') {
        section.scrollIntoView({ behavior: 'auto', block: 'start' })
      } else {
        window.scrollTo({ top: 0, behavior: 'auto' })
      }
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [showsCustomerPicker])

  useEffect(() => {
    setEquipmentStatusDraft(activeSelectedEquipment?.status || 'active')
    setShowDecommissionConfirm(false)
  }, [activeSelectedEquipment?.id, activeSelectedEquipment?.status])

  useEffect(() => {
    if (!activeSelectedEquipment) {
      setViewedReport(null)
      setViewedReportError('')
      setShowEditReportModal(false)
      setEditReportError('')
      setShowRevisionsModal(false)
      setRevisionsError('')
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
        setRevisionsError('')
        return
      }

      if (viewedReport) {
        setViewedReportError('')
        setViewedReport(null)
      }
    }

    window.addEventListener('keydown', handleEscapeClose)
    return () => window.removeEventListener('keydown', handleEscapeClose)
  }, [viewedReport, showEditReportModal, showRevisionsModal])

  useEffect(() => {
    if (!profile?.requiredPasswordChange) return
    setPasswordChangeError('')
    setPasswordChangeSuccess('')
    setPasswordForm(buildEmptyPasswordForm())
    setShowChangePasswordModal(true)
  }, [profile?.requiredPasswordChange])

  useEffect(() => {
    if (!showChangePasswordModal) return

    function handleEscapeClose(event) {
      if (event.key !== 'Escape') return
      closeChangePasswordModal()
    }

    window.addEventListener('keydown', handleEscapeClose)
    return () => window.removeEventListener('keydown', handleEscapeClose)
  }, [showChangePasswordModal, profile?.requiredPasswordChange])

  useEffect(() => {
    const isAnyCreateModalOpen = Boolean(
      showCreateCustomerForm ||
        showEditCustomerForm ||
        showCreateEmployeeForm ||
        companyPickerUserId ||
        showCreateEquipmentForm ||
        showCreateReportForm
    )
    if (!isAnyCreateModalOpen) return

    function handleEscapeClose(event) {
      if (event.key !== 'Escape') return

      if (showCreateReportForm) {
        void closeCreateReportForm()
      }

      if (showCreateEquipmentForm) {
        closeCreateEquipmentForm()
      }

      if (showCreateCustomerForm) {
        closeCreateCustomerForm()
      }

      if (showEditCustomerForm) {
        closeEditCustomerForm()
      }

      if (showCreateEmployeeForm) {
        closeCreateEmployeeForm()
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
    showEditCustomerForm,
    showCreateEmployeeForm,
    companyPickerUserId,
    showCreateEquipmentForm,
    showCreateReportForm,
  ])

  async function refreshPendingReportApprovals(force = false) {
    const shouldForce = force === true
    if (!isAuthenticated) return
    if (!shouldForce && !['owner', 'office_staff'].includes(profile?.role)) return

    setPendingApprovalsLoading(true)
    setPendingApprovalsError('')

    try {
      const pendingApprovalsQueryKey = portalQueryKeys.pendingApprovals(profile?.role)
      if (shouldForce) {
        await queryClient.invalidateQueries({ queryKey: pendingApprovalsQueryKey, exact: true })
      }

      const nextReports = await queryClient.fetchQuery({
        queryKey: pendingApprovalsQueryKey,
        queryFn: () => getPendingReportApprovals(),
        staleTime: 30 * 1000,
      })
      setPendingReportApprovals(nextReports)
      setPendingApprovalsLastUpdatedAt(Date.now())
    } catch (error) {
      if (Number(error?.status || 0) !== 403) {
        setPendingApprovalsError(String(error?.message || 'Unable to load pending approvals.'))
      }
      setPendingReportApprovals([])
    } finally {
      setPendingApprovalsLoading(false)
    }
  }

  async function refreshDashboardStats(force = false) {
    const shouldForce = force === true
    if (!isAuthenticated) return
    if (!shouldForce && !['owner', 'office_staff'].includes(profile?.role)) return

    setDashboardStatsLoading(true)
    setDashboardStatsError('')

    try {
      const dashboardStatsQueryKey = portalQueryKeys.dashboardStats(profile?.role)
      if (shouldForce) {
        await queryClient.invalidateQueries({ queryKey: dashboardStatsQueryKey, exact: true })
      }

      const nextStats = await queryClient.fetchQuery({
        queryKey: dashboardStatsQueryKey,
        queryFn: () => getPortalDashboardStats(),
        staleTime: 30 * 1000,
      })
      setDashboardStats(nextStats)
    } catch (error) {
      if (Number(error?.status || 0) !== 403) {
        setDashboardStatsError(String(error?.message || 'Unable to load dashboard stats.'))
      }
      setDashboardStats({
        overdue_count: 0,
        due_soon_count: 0,
        pending_approvals_count: 0,
      })
    } finally {
      setDashboardStatsLoading(false)
    }
  }

  async function refreshStaffAssignments(force = false) {
    const shouldForce = force === true
    if (!isAuthenticated) return
    if (!shouldForce && !['owner', 'office_staff'].includes(profile?.role)) return

    setStaffAssignmentsLoading(true)
    setStaffAssignmentsError('')
    try {
      const activeAssignmentsQueryKey = portalQueryKeys.staffAssignments('active')
      const inactiveAssignmentsQueryKey = portalQueryKeys.staffAssignments('inactive')

      if (shouldForce) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: activeAssignmentsQueryKey, exact: true }),
          queryClient.invalidateQueries({ queryKey: inactiveAssignmentsQueryKey, exact: true }),
        ])
      }

      const [activeAssignments, inactiveAssignments] = await Promise.all([
        queryClient.fetchQuery({
          queryKey: activeAssignmentsQueryKey,
          queryFn: () => getStaffAssignments({ status: 'active' }),
          staleTime: 30 * 1000,
        }),
        queryClient.fetchQuery({
          queryKey: inactiveAssignmentsQueryKey,
          queryFn: () => getStaffAssignments({ status: 'inactive' }),
          staleTime: 30 * 1000,
        }),
      ])
      setActiveStaffAssignments(activeAssignments)
      setInactiveStaffAssignments(inactiveAssignments)
    } catch (error) {
      if (Number(error?.status || 0) !== 403) {
        setStaffAssignmentsError(String(error?.message || 'Unable to load employee assignments.'))
      }
      setActiveStaffAssignments([])
      setInactiveStaffAssignments([])
    } finally {
      setStaffAssignmentsLoading(false)
    }
  }

  function showSuccessToast(message, title) {
    setPortalToast({
      title: title || 'Updated',
      message,
    })
  }

  async function invalidatePortalCaches(cacheKeys = []) {
    if (!Array.isArray(cacheKeys) || cacheKeys.length === 0) return
    await Promise.all(cacheKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })))
  }

  async function fetchPortalCompanies({ force = false } = {}) {
    const companiesQueryKey = portalQueryKeys.companies()
    if (force) {
      await queryClient.invalidateQueries({ queryKey: companiesQueryKey, exact: true })
    }

    return queryClient.fetchQuery({
      queryKey: companiesQueryKey,
      queryFn: getPortalCompanies,
      staleTime: 3 * 60 * 1000,
    })
  }

  async function fetchPortalProfile({ force = false } = {}) {
    const profileQueryKey = portalQueryKeys.profile()
    if (force) {
      await queryClient.invalidateQueries({ queryKey: profileQueryKey, exact: true })
    }

    return queryClient.fetchQuery({
      queryKey: profileQueryKey,
      queryFn: getPortalMe,
      staleTime: 10 * 60 * 1000,
    })
  }

  async function fetchPortalCompanyHeader(companyId, { force = false } = {}) {
    const companyHeaderQueryKey = portalQueryKeys.companyHeader(companyId)
    if (force) {
      await queryClient.invalidateQueries({ queryKey: companyHeaderQueryKey, exact: true })
    }

    return queryClient.fetchQuery({
      queryKey: companyHeaderQueryKey,
      queryFn: () => getPortalCompanyHeader(companyId),
      staleTime: 3 * 60 * 1000,
    })
  }

  async function fetchPortalEquipmentList(
    { companyId, siteId = '', search = '' },
    { force = false } = {},
  ) {
    const equipmentQueryKey = portalQueryKeys.equipment({ companyId, siteId, search })
    if (force) {
      await queryClient.invalidateQueries({ queryKey: equipmentQueryKey, exact: true })
    }

    return queryClient.fetchQuery({
      queryKey: equipmentQueryKey,
      queryFn: () =>
        getPortalEquipment({
          companyId,
          siteId,
          search,
        }),
      staleTime: 30 * 1000,
    })
  }

  async function fetchEquipmentReportsList(equipmentId, { force = false } = {}) {
    const reportsQueryKey = portalQueryKeys.reports(equipmentId)
    if (force) {
      await queryClient.invalidateQueries({ queryKey: reportsQueryKey, exact: true })
    }

    return queryClient.fetchQuery({
      queryKey: reportsQueryKey,
      queryFn: () => getEquipmentReports(equipmentId),
      staleTime: 30 * 1000,
    })
  }

  async function fetchEquipmentActivityList(equipmentId, { force = false } = {}) {
    const activityQueryKey = portalQueryKeys.equipmentActivity(equipmentId)
    if (force) {
      await queryClient.invalidateQueries({ queryKey: activityQueryKey, exact: true })
    }

    return queryClient.fetchQuery({
      queryKey: activityQueryKey,
      queryFn: () => getEquipmentActivity(equipmentId),
      staleTime: 60 * 1000,
    })
  }

  async function refreshEquipmentListForCurrentSelection() {
    const companyIdForRefresh = activeSelectedEquipment?.company_id || selectedCompanyId
    if (!companyIdForRefresh) return

    const refreshedEquipment = await fetchPortalEquipmentList({
      companyId: companyIdForRefresh,
      siteId: selectedSiteId,
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

  async function refreshInitialOwnerBootstrap() {
    await Promise.all([
      refreshStaffAssignments(true),
      refreshPendingReportApprovals(true),
      refreshDashboardStats(true),
    ])
  }

  async function handleStayLoggedIn() {
    if (refreshingSession) return

    setRefreshingSession(true)
    setSessionWarningError('')
    try {
      await refreshPortalSession()
      setShowSessionExpiryWarning(false)
      showSuccessToast('Your portal session has been extended.', 'Session Extended')
    } catch (error) {
      setSessionWarningError(String(error?.message || 'Unable to extend your session.'))
    } finally {
      setRefreshingSession(false)
    }
  }

  function handleToggleEquipmentSort(columnKey) {
    if (equipmentSortKey === columnKey) {
      setEquipmentSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }

    setEquipmentSortKey(columnKey)
    setEquipmentSortDirection('asc')
  }

  async function refreshCustomerCompanies() {
    if (!isAuthenticated || refreshingCustomers) return

    setRefreshingCustomers(true)
    setErrorMessage('')

    try {
      // Artificial delay to show loading state
      await new Promise((resolve) => setTimeout(resolve, 600))

      const nextCompanies = await fetchPortalCompanies({ force: true })
      setCompanies(nextCompanies)
      setCustomersLastUpdatedAt(Date.now())
      if (['owner', 'office_staff'].includes(profile?.role)) {
        await refreshDashboardStats(true)
      }
    } catch (error) {
      setErrorMessage(String(error?.message || 'Unable to refresh customers right now.'))
    } finally {
      setRefreshingCustomers(false)
    }
  }

  async function refreshEquipmentData() {
    if (!isAuthenticated || refreshingEquipment) return

    const companyIdForRefresh = company?.id || activeSelectedEquipment?.company_id || selectedCompanyId
    if (!companyIdForRefresh) return

    setRefreshingEquipment(true)
    setErrorMessage('')

    try {
      const equipmentQueryKey = portalQueryKeys.equipment({
        companyId: companyIdForRefresh,
        siteId: selectedSiteId,
        search: searchQuery,
      })

      // User-triggered refresh should always bypass fresh-cache windows.
      await queryClient.invalidateQueries({ queryKey: equipmentQueryKey, exact: true })

      const refreshedEquipment = await fetchPortalEquipmentList(
        {
          companyId: companyIdForRefresh,
          siteId: selectedSiteId,
          search: searchQuery,
        },
        { force: true },
      )
      setEquipment(refreshedEquipment)
      setEquipmentLastUpdatedAt(Date.now())
      if (selectedEquipment) {
        const nextSelectedEquipment = refreshedEquipment.find(
          (item) => String(item.id) === String(selectedEquipment.id),
        )
        setSelectedEquipment(nextSelectedEquipment || null)
      }
      setEquipmentPage(1)
    } catch (error) {
      setErrorMessage(String(error?.message || 'Unable to refresh equipment right now.'))
    } finally {
      setRefreshingEquipment(false)
    }
  }

  async function handleApproveViewedReport() {
    if (!viewedReport?.id || !isOwner || approvingReport) return

    try {
      await approveReportMutation.mutateAsync({
        reportId: viewedReport.id,
        reportSnapshot: viewedReport,
      })
    } catch {
      // Errors are handled in mutation callbacks.
    }
  }

  useEffect(() => {
    if (!activeSelectedEquipment?.id) {
      setReports([])
      setReportError('')
      return
    }

    if (Array.isArray(reportsQuery.data)) {
      setReports(reportsQuery.data)
      setReportError('')
      return
    }

    if (reportsQuery.error) {
      setReportError(String(reportsQuery.error?.message || 'Unable to load reports for this equipment.'))
    }
  }, [activeSelectedEquipment?.id, reportsQuery.data, reportsQuery.error])

  useEffect(() => {
    if (!activeSelectedEquipment?.id || !canViewEquipmentActivity) {
      setEquipmentActivity([])
      setEquipmentActivityError('')
      return
    }

    if (Array.isArray(equipmentActivityQuery.data)) {
      setEquipmentActivity(equipmentActivityQuery.data)
      setEquipmentActivityError('')
      return
    }

    if (equipmentActivityQuery.error) {
      setEquipmentActivityError(
        String(equipmentActivityQuery.error?.message || 'Unable to load equipment activity.'),
      )
    }
  }, [
    activeSelectedEquipment?.id,
    canViewEquipmentActivity,
    equipmentActivityQuery.data,
    equipmentActivityQuery.error,
  ])

  useEffect(() => {
    let cancelled = false

    async function loadPortalData() {
      if (!isAuthenticated) {
        setLoading(false)
        return
      }

      // Keep existing content mounted on subsequent refreshes to avoid flash/flicker.
      // Only set loading on initial profile load, not on company/site changes
      const isInitialLoad = !profile
      setLoading(isInitialLoad)
      setErrorMessage('')

      try {
        const nextProfile = await fetchPortalProfile({ force: isInitialLoad })
        if (cancelled) return

        setProfile(nextProfile)
        const isStaffOrOwner = ['staff', 'engineer', 'owner', 'office_staff'].includes(nextProfile.role)
        const isOwnerUser = ['owner', 'office_staff'].includes(nextProfile.role)

        let activeCompanyId = nextProfile.allowedCompanyIds[0] || ''

        if (isStaffOrOwner) {
          const nextCompanies = await fetchPortalCompanies()
          if (cancelled) return
          setCompanies(nextCompanies)
          setCustomersLastUpdatedAt(Date.now())

          if (selectedCompanyId) {
            activeCompanyId = selectedCompanyId
          } else {
            setCompany(null)
            setEquipment([])
          }
        } else {
          setCompanies([])
        }

        // Only load dashboard stats on initial profile load, not when company/site changes
        if (isOwnerUser && isInitialLoad) {
          await refreshInitialOwnerBootstrap()
        } else if (isInitialLoad) {
          setActiveStaffAssignments([])
          setInactiveStaffAssignments([])
          setPendingReportApprovals([])
          setDashboardStats({
            overdue_count: 0,
            due_soon_count: 0,
            pending_approvals_count: 0,
          })
        }

        if (!activeCompanyId) {
          setCompany(null)
          setSelectedSiteId('')
          setEquipment([])
          return
        }

        const nextCompany = await fetchPortalCompanyHeader(activeCompanyId)
        if (cancelled) return

        const nextSites = Array.isArray(nextCompany?.sites) ? nextCompany.sites : []
        const nextSiteId =
          nextSites.find((site) => String(site.id) === String(selectedSiteId))?.id || nextSites[0]?.id || ''

        const nextEquipment = await fetchPortalEquipmentList({
          companyId: activeCompanyId,
          siteId: nextSiteId,
          search: searchQuery,
        })
        if (cancelled) return

        setCompany(nextCompany)
        setSelectedSiteId(nextSiteId ? String(nextSiteId) : '')
        setEquipment(nextEquipment)
        setEquipmentLastUpdatedAt(Date.now())
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
  }, [
    isAuthenticated,
    navigate,
    searchQuery,
    selectedCompanyId,
    selectedSiteId,
    queryClient,
  ])

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

  async function handleChangePassword(event) {
    event.preventDefault()
    if (changingPassword) return

    const currentPassword = String(passwordForm.current_password || '')
    const nextPassword = String(passwordForm.new_password || '')
    const confirmPassword = String(passwordForm.confirm_password || '')

    if (!currentPassword || !nextPassword || !confirmPassword) {
      setPasswordChangeError('All password fields are required.')
      setPasswordChangeSuccess('')
      return
    }

    if (nextPassword !== confirmPassword) {
      setPasswordChangeError('New password and confirmation must match.')
      setPasswordChangeSuccess('')
      return
    }

    setChangingPassword(true)
    setPasswordChangeError('')
    setPasswordChangeSuccess('')

    try {
      await changePortalPassword({
        current_password: currentPassword,
        new_password: nextPassword,
      })

      await invalidatePortalCaches([
        portalQueryKeys.profile(),
      ])

      setPasswordChangeSuccess('Password updated successfully.')
      showSuccessToast('Password updated successfully.', 'Password Updated')
      setPasswordForm(buildEmptyPasswordForm())
      setProfile((current) => {
        if (!current) return current
        return { ...current, requiredPasswordChange: false }
      })
      setShowChangePasswordModal(false)
    } catch (error) {
      setPasswordChangeError(String(error?.message || 'Unable to update password.'))
      setPasswordChangeSuccess('')
    } finally {
      setChangingPassword(false)
    }
  }

  async function handleCreateReport(event) {
    event?.preventDefault?.()
    if (creatingReport || savingReportEdit) return

    const normalizedChecklistItems = normalizeReportChecklistItems(reportForm.checklist_items)
    const checklistImageUploads = flattenChecklistImageUploads(reportForm.checklistImageFilesByLabel)
    const hasConfirmedSubmissionChecks = reportSubmissionConfirmChecks.every(Boolean)
    if (!isEditingReport) {
      const missingChecklistDetails = getMissingChecklistDetailsError(normalizedChecklistItems)
      if (missingChecklistDetails) {
        const message = `Add a ${missingChecklistDetails.field} for '${missingChecklistDetails.label}' before saving this report.`
        setCreateReportError(message)
        return
      }

      if (!hasConfirmedSubmissionChecks) {
        setCreateReportError('')
        setShowReportSubmissionConfirmModal(true)
        return
      }
    }

    if (isEditingReport) {
      try {
        await editReportMutation.mutateAsync({
          reportId: reportForm.reportId,
          payload: {
            title: reportForm.title,
            summary: reportForm.summary,
            checklist_items: normalizedChecklistItems,
            checklist_images: checklistImageUploads.checklist_images,
            checklist_image_labels: checklistImageUploads.checklist_image_labels,
            report_date: reportForm.report_date,
            status: reportForm.status,
            images: reportForm.images,
            removed_image_ids: reportForm.removedImageIds,
          },
        })
      } catch {
        // Errors are handled in mutation callbacks.
      }
      return
    }

    if (!activeSelectedEquipment?.id) return

    try {
      await createReportMutation.mutateAsync({
        equipmentId: activeSelectedEquipment.id,
        payload: {
          ...reportForm,
          checklist_items: normalizedChecklistItems,
          checklist_images: checklistImageUploads.checklist_images,
          checklist_image_labels: checklistImageUploads.checklist_image_labels,
          status: 'submitted',
        },
      })
    } catch {
      // Errors are handled in mutation callbacks.
    }
  }

  function handleConfirmReportSubmissionChecks() {
    if (creatingReport || savingReportEdit) return
    if (!reportSubmissionConfirmChecks.every(Boolean)) return
    setShowReportSubmissionConfirmModal(false)
    void handleCreateReport()
  }

  async function handleGenerateSiteCertificates() {
    if (generatingSiteCertificates) return

    const siteId = Number(activeSite?.id || selectedSiteId || 0)
    if (!siteId) {
      setCertificateError('Select a site before generating certificates.')
      return
    }

    setGeneratingSiteCertificates(true)
    setCertificateError('')
    try {
      await generateSiteCertificates(siteId)
      await invalidatePortalCaches([
        portalQueryKeys.equipmentActivityRoot(),
        portalQueryKeys.generatedCertificatesRoot(),
      ])
      setConfirmDeleteGeneratedCertificateId('')
      showSuccessToast('Certificate generated and saved for this site.', 'Certificate Generated')
    } catch (error) {
      setCertificateError(String(error?.message || 'Unable to generate site certificates.'))
    } finally {
      setGeneratingSiteCertificates(false)
    }
  }

  function closeGeneratedCertificatePreviewModal() {
    setShowGeneratedCertificatePreviewModal(false)
    if (generatedCertificatePreviewUrl) {
      window.URL.revokeObjectURL(generatedCertificatePreviewUrl)
    }
    setGeneratedCertificatePreviewUrl('')
    setGeneratedCertificateFilename('')
  }

  function getGeneratedCertificateFilename(certificate) {
    const rawTitle = String(certificate?.title || '').trim()
    if (rawTitle && /\.[a-z0-9]+$/i.test(rawTitle)) return rawTitle
    if (rawTitle) return `${rawTitle}.pdf`
    const filePath = String(certificate?.file || '').trim()
    const fallbackFromPath = filePath.split('/').pop() || ''
    return fallbackFromPath || 'site-certificate-register.pdf'
  }

  async function openGeneratedCertificatePreview(certificate) {
    const certificateId = Number(certificate?.id || 0)
    if (!certificateId) return

    setGeneratedCertificateActionId(certificateId)
    setCertificateError('')
    try {
      const blob = await downloadCertificate(certificateId)
      const objectUrl = window.URL.createObjectURL(blob)
      if (generatedCertificatePreviewUrl) {
        window.URL.revokeObjectURL(generatedCertificatePreviewUrl)
      }
      setGeneratedCertificatePreviewUrl(objectUrl)
      setGeneratedCertificateFilename(getGeneratedCertificateFilename(certificate))
      setShowGeneratedCertificatePreviewModal(true)
    } catch (error) {
      setCertificateError(String(error?.message || 'Unable to open certificate preview.'))
    } finally {
      setGeneratedCertificateActionId(0)
    }
  }

  async function handleDeleteGeneratedCertificate(certificate) {
    if (!isOwner || !certificate?.id) return

    const certificateId = String(certificate.id)
    if (confirmDeleteGeneratedCertificateId !== certificateId) {
      setConfirmDeleteGeneratedCertificateId(certificateId)
      return
    }

    const numericCertificateId = Number(certificateId)
    setGeneratedCertificateActionId(numericCertificateId)
    setCertificateError('')
    try {
      await deleteEquipmentCertificate(numericCertificateId)
      await invalidatePortalCaches([
        portalQueryKeys.equipmentActivityRoot(),
        portalQueryKeys.generatedCertificatesRoot(),
      ])
      setConfirmDeleteGeneratedCertificateId('')
      showSuccessToast('Generated certificate deleted.', 'Certificate Deleted')
    } catch (error) {
      setCertificateError(String(error?.message || 'Unable to delete certificate.'))
    } finally {
      setGeneratedCertificateActionId(0)
    }
  }

  async function handleSaveGeneratedCertificate(certificate = null) {
    if (!certificate) {
      if (!generatedCertificatePreviewUrl) return
      const filename = generatedCertificateFilename || 'site-certificate-register.pdf'
      const anchor = document.createElement('a')
      anchor.href = generatedCertificatePreviewUrl
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      return
    }

    const certificateId = Number(certificate?.id || 0)
    if (!certificateId) return
    setGeneratedCertificateActionId(certificateId)
    setCertificateError('')
    try {
      const blob = await downloadCertificate(certificateId)
      const previewUrl = window.URL.createObjectURL(blob)
      const filename = getGeneratedCertificateFilename(certificate)
      const anchor = document.createElement('a')
      anchor.href = previewUrl
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.URL.revokeObjectURL(previewUrl)
    } catch (error) {
      setCertificateError(String(error?.message || 'Unable to download certificate.'))
    } finally {
      setGeneratedCertificateActionId(0)
    }
  }

  async function handlePrintGeneratedCertificate(certificate = null) {
    const printFromUrl = (previewUrl, revokeAfterPrint = false) => {
      const printFrame = document.createElement('iframe')
      printFrame.style.position = 'fixed'
      printFrame.style.right = '0'
      printFrame.style.bottom = '0'
      printFrame.style.width = '0'
      printFrame.style.height = '0'
      printFrame.style.border = '0'
      printFrame.src = previewUrl

      const cleanup = () => {
        printFrame.remove()
        if (revokeAfterPrint) {
          window.URL.revokeObjectURL(previewUrl)
        }
      }

      printFrame.onload = () => {
        try {
          printFrame.contentWindow?.focus()
          printFrame.contentWindow?.print()
        } finally {
          window.setTimeout(cleanup, 1500)
        }
      }

      document.body.appendChild(printFrame)
    }

    if (!certificate) {
      if (!generatedCertificatePreviewUrl) return
      printFromUrl(generatedCertificatePreviewUrl)
      return
    }

    const certificateId = Number(certificate?.id || 0)
    if (!certificateId) return
    setGeneratedCertificateActionId(certificateId)
    setCertificateError('')
    try {
      const blob = await downloadCertificate(certificateId)
      const previewUrl = window.URL.createObjectURL(blob)
      printFromUrl(previewUrl, true)
    } catch (error) {
      setCertificateError(String(error?.message || 'Unable to print certificate.'))
    } finally {
      setGeneratedCertificateActionId(0)
    }
  }

  useEffect(() => {
    if (!generatedCertificatesQuery.isSuccess) return
    setConfirmDeleteGeneratedCertificateId('')
  }, [generatedCertificatesQuery.isSuccess])

  async function handleRecoverActivityFromEntry(entry) {
    if (!isOwner || deletingDraftReport || recoveringCertificateId || recoveringReportId) return

    const recoveryState = getActivityRecoveryState(entry, Date.now(), recoveredAtMsByRecoverableTarget)
    if (!recoveryState.canRecover || !recoveryState.targetType || !recoveryState.targetId) {
      setCertificateError('This item can no longer be recovered.')
      return
    }

    if (recoveryState.targetType === 'certificate') {
      setRecoveringCertificateId(recoveryState.targetId)
    } else if (recoveryState.targetType === 'report') {
      setRecoveringReportId(recoveryState.targetId)
    }

    setCertificateError('')
    setCertificateSuccess('')
    try {
      if (recoveryState.targetType === 'certificate') {
        await recoverEquipmentCertificate(recoveryState.targetId)
      } else {
        await recoverReport(recoveryState.targetId)
      }

      await invalidatePortalCaches([
        portalQueryKeys.reportsRoot(),
        portalQueryKeys.equipmentRoot(),
        portalQueryKeys.equipmentActivityRoot(),
        portalQueryKeys.generatedCertificatesRoot(),
      ])

      if (activeSelectedEquipment?.id) {
        const [nextReports, nextActivity] = await Promise.all([
          fetchEquipmentReportsList(activeSelectedEquipment.id),
          canViewEquipmentActivity
            ? fetchEquipmentActivityList(activeSelectedEquipment.id)
            : Promise.resolve([]),
        ])
        setReports(nextReports)
        if (canViewEquipmentActivity) {
          setEquipmentActivity(nextActivity)
        }
      }

      if (recoveryState.targetType === 'certificate') {
        setCertificateSuccess('Certificate recovered successfully.')
        showSuccessToast('Certificate recovered successfully.', 'Certificate Recovered')
      } else {
        setCertificateSuccess('Report recovered successfully.')
        showSuccessToast('Report recovered successfully.', 'Report Recovered')
      }
    } catch (error) {
      setCertificateError(String(error?.message || 'Unable to recover item.'))
    } finally {
      setRecoveringCertificateId(0)
      setRecoveringReportId(0)
    }
  }

  async function handleCreateCustomer(event) {
    event.preventDefault()
    if (!isOwner || creatingCustomer) return

    try {
      await createCustomerMutation.mutateAsync({ formData: customerForm })
    } catch {
      // Errors are handled in mutation callbacks.
    }
  }

  function handleStartEditCustomer(item) {
    if (!isOwner || !item?.id) return
    setCustomerEditError('')
    setCustomerEditSuccess('')
    setConfirmCustomerDeactivate(false)
    const nextEditForm = {
      company_id: String(item.id),
      company_name: String(item.name || ''),
      company_contact_email: String(item.contact_email || ''),
      company_contact_phone: String(item.contact_phone || ''),
      company_address: String(item.address || ''),
      deactivate_customer: false,
    }
    initialCustomerEditFormRef.current = nextEditForm
    setCustomerEditForm(nextEditForm)
    setShowEditCustomerForm(true)
  }

  async function saveEditCustomer() {
    if (!isOwner || editingCustomer) return

    if (customerEditForm.deactivate_customer && !confirmCustomerDeactivate) {
      setConfirmCustomerDeactivate(true)
      return
    }

    const payload = {
      company_id: Number(customerEditForm.company_id || 0),
      company_name: customerEditForm.company_name,
      company_contact_email: customerEditForm.company_contact_email,
      company_contact_phone: customerEditForm.company_contact_phone,
      company_address: customerEditForm.company_address,
    }
    if (customerEditForm.deactivate_customer) {
      payload.is_active = false
    }

    try {
      await editCustomerMutation.mutateAsync({
        payload,
        deactivateCustomer: Boolean(customerEditForm.deactivate_customer),
      })
    } catch {
      // Errors are handled in mutation callbacks.
    }
  }

  async function handleEditCustomer(event) {
    event.preventDefault()
    await saveEditCustomer()
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

    try {
      await createEmployeeAssignmentMutation.mutateAsync({
        payload: {
          ...employeeForm,
          username: nextUsername,
        },
      })
    } catch {
      // Errors are handled in mutation callbacks.
    }
  }

  async function handleSaveEmployeeAssignment(assignment) {
    if (!assignment?.user_id || savingStaffUserId) return
    try {
      await saveEmployeeAssignmentMutation.mutateAsync({ assignment })
    } catch {
      // Errors are handled in mutation callbacks.
    }
  }

  async function handleEmployeeRoleChange(assignment, nextRole) {
    if (!assignment?.user_id || savingStaffUserId || removingStaffUserId) return

    try {
      await employeeRoleChangeMutation.mutateAsync({ assignment, nextRole })
    } catch {
      // Errors are handled in mutation callbacks.
    }
  }

  async function handleRemoveEmployeeAssignment(assignment) {
    if (!assignment?.user_id || removingStaffUserId) return
    try {
      await removeEmployeeAssignmentMutation.mutateAsync({ assignment })
    } catch {
      // Errors are handled in mutation callbacks.
    }
  }

  async function handleReactivateEmployeeAssignment(assignment) {
    if (!assignment?.user_id || reactivatingStaffUserId) return

    try {
      await reactivateEmployeeAssignmentMutation.mutateAsync({ assignment })
    } catch {
      // Errors are handled in mutation callbacks.
    }
  }

  async function handleCreateSite(event) {
    event.preventDefault()
    if (!selectedCompanyId || creatingSite) return

    try {
      await createSiteMutation.mutateAsync({
        companyId: selectedCompanyId,
        name: siteForm.name,
        address: siteForm.address,
      })
    } catch {
      // Errors are handled in mutation callbacks.
    }
  }

  async function handleUpdateSite(event) {
    event.preventDefault()
    if (!selectedCompanyId || !activeSite?.id || updatingSite) return

    try {
      await updateSiteMutation.mutateAsync({
        companyId: selectedCompanyId,
        siteId: activeSite.id,
        name: siteEditForm.name,
        address: siteEditForm.address,
      })
    } catch {
      // Errors are handled in mutation callbacks.
    }
  }

  async function handleDeleteSite() {
    if (!selectedCompanyId || !activeSite?.id || deletingSite) return
    if (!window.confirm(`Delete site '${activeSite.name}'?`)) return

    try {
      await deleteSiteMutation.mutateAsync({
        companyId: selectedCompanyId,
        siteId: activeSite.id,
        siteName: activeSite.name,
      })
    } catch {
      // Errors are handled in mutation callbacks.
    }
  }

  async function handleCreateEquipment(event) {
    event.preventDefault()
    if (!canEditReports || !selectedCompanyId || !selectedSiteId || creatingEquipment) return

    try {
      const payload = {
        ...equipmentForm,
        company_id: Number(selectedCompanyId),
        site_id: Number(selectedSiteId),
        safe_working_load: String(equipmentForm.safe_working_load || '').trim(),
        inspection_interval_days: Number(equipmentForm.inspection_interval_days || 365),
        last_inspected_at: equipmentForm.last_inspected_at || null,
      }
      await createEquipmentMutation.mutateAsync({
        payload,
        companyId: selectedCompanyId,
        siteId: selectedSiteId,
        search: searchQuery,
      })
    } catch {
      // Errors are handled in mutation callbacks.
    }
  }

  async function handleUpdateEquipmentStatus(newStatus, equipmentId = null) {
    const targetEquipmentId = equipmentId || activeSelectedEquipment?.id
    if (!targetEquipmentId || updatingEquipmentStatus) return
    const companyIdForRefresh = activeSelectedEquipment?.company_id || selectedCompanyId
    if (!companyIdForRefresh) return false

    try {
      await updateEquipmentStatusMutation.mutateAsync({
        equipmentId: targetEquipmentId,
        status: newStatus,
        companyId: companyIdForRefresh,
        siteId: selectedSiteId,
        search: searchQuery,
      })
      return true
    } catch {
      return false
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
    const updated = await handleUpdateEquipmentStatus('decommissioned', activeSelectedEquipment.id)
    if (updated) {
      setShowDecommissionConfirm(false)
    }
  }

  function handleStartEdit(report) {
    setShowCreateReportForm(false)
    setEditReportError('')
    setConfirmRemoveReportImageId('')
    setShowEditReportModal(true)
    const nextEditReportForm = {
      reportId: String(report.id),
      title: report.title || '',
      summary: report.summary || '',
      findings: report.findings || '',
      recommendations: report.recommendations || '',
      report_date: report.report_date || new Date().toISOString().slice(0, 10),
      status: report.status || 'draft',
      checklist_items: normalizeReportChecklistItems(report.checklist_items),
      checklistImageFilesByLabel: {},
      images: [],
      existingImages: Array.isArray(report.images) ? report.images : [],
      removedImageIds: [],
    }
    initialReportEditFormRef.current = nextEditReportForm

    const storedDraft = readReportDraft()
    if (
      storedDraft?.mode === 'edit' &&
      String(storedDraft?.reportId || '') === String(report.id) &&
      storedDraft?.form &&
      typeof storedDraft.form === 'object'
    ) {
      setReportForm({
        ...nextEditReportForm,
        ...storedDraft.form,
        checklist_items: normalizeReportChecklistItems(storedDraft.form?.checklist_items),
        checklistImageFilesByLabel: {},
        images: [],
      })
      showSuccessToast('Restored your saved report draft.', 'Draft Restored')
      return
    }

    setReportForm(nextEditReportForm)
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

  function handleGoToReportEquipment() {
    if (!viewedReport?.equipment_id) return

    const targetEquipmentId = String(viewedReport.equipment_id)
    const targetCompanyId = String(viewedReport.company_id || '')
    const targetEquipment = equipment.find((item) => String(item.id) === targetEquipmentId)

    setSelectedEquipment({ id: viewedReport.equipment_id })
    setSearchInput('')
    setSearchQuery('')
    setEquipmentPage(1)

    if (targetEquipment) {
      setSelectedEquipment(targetEquipment)
      setEquipmentTableTab(targetEquipment.status === 'decommissioned' ? 'decommissioned' : 'active')
    } else {
      setEquipmentTableTab('active')
    }

    if (targetCompanyId && targetCompanyId !== selectedCompanyId) {
      const nextParams = new URLSearchParams(searchParams)
      nextParams.set('companyId', targetCompanyId)
      nextParams.delete('q')
      nextParams.delete('eqPage')
      setSearchParams(nextParams, { replace: true })
    }

    setViewedReportError('')
    setViewedReport(null)
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
    if (String(confirmRemoveReportImageId) !== String(imageId)) {
      setConfirmRemoveReportImageId(String(imageId))
      return
    }

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
    setConfirmRemoveReportImageId('')
  }

  async function handleLoadRevisions(reportId) {
    if (!isOwner) return
    setShowRevisionsModal(true)
    setRevisionReportId(String(reportId))
    setReportRevisions([])
    setSelectedRevisionPreview(null)
    setRevisionsLoading(true)
    setRevisionsError('')
    try {
      const revisions = await getReportRevisions(reportId)
      setReportRevisions(revisions)
    } catch (error) {
      setRevisionsError(String(error?.message || 'Unable to load revision history.'))
    } finally {
      setRevisionsLoading(false)
    }
  }

  function openRevisionPreview(revisionIndex) {
    const revision = reportRevisions[revisionIndex]
    if (!revision) return

    const beforeSnapshot = buildReportSnapshot(revision.previous_data)
    const nextNewerRevision = revisionIndex > 0 ? reportRevisions[revisionIndex - 1] : null
    const afterSource = nextNewerRevision?.previous_data || viewedReport || revision.previous_data
    const afterSnapshot = buildReportSnapshot(afterSource)
    const { fieldChanges, checklistChanges } = getRevisionFieldChanges(beforeSnapshot, afterSnapshot)

    setSelectedRevisionPreview({
      revision,
      beforeSnapshot,
      afterSnapshot,
      fieldChanges,
      checklistChanges,
    })
  }

  function handleCancelEdit(force = false) {
    if (!force && isEditReportDirty) {
      setReportUnsavedPrompt('edit')
      return
    }
    clearReportDraft()
    setReportForm(buildEmptyReportForm())
    setEditReportError('')
    setConfirmRemoveReportImageId('')
    setShowEditReportModal(false)
  }

  async function handleReportUnsavedPromptSave() {
    if (reportUnsavedPrompt === 'create') {
      await saveCreateReportDraftAndClose()
      return
    }

    if (reportUnsavedPrompt === 'edit') {
      await handleCreateReport()
    }
  }

  function handleReportUnsavedPromptRevert() {
    if (reportUnsavedPrompt === 'create') {
      setReportUnsavedPrompt('')
      void closeCreateReportForm(true)
      return
    }

    if (reportUnsavedPrompt === 'edit') {
      setReportUnsavedPrompt('')
      handleCancelEdit(true)
    }
  }

  async function handleDeleteDraftReport() {
    if (!viewedReport?.id || deletingDraftReport) return

    if (String(confirmDeleteDraftReportId) !== String(viewedReport.id)) {
      setConfirmDeleteDraftReportId(String(viewedReport.id))
      return
    }

    setDeletingDraftReport(true)
    setViewedReportError('')
    try {
      await deleteReport(viewedReport.id)
      await invalidatePortalCaches([
        portalQueryKeys.reportsRoot(),
        portalQueryKeys.equipmentRoot(),
        portalQueryKeys.equipmentActivityRoot(),
        portalQueryKeys.pendingApprovalsRoot(),
        portalQueryKeys.dashboardStatsRoot(),
      ])
      if (activeSelectedEquipment?.id) {
        const [refreshed, nextActivity] = await Promise.all([
          fetchEquipmentReportsList(activeSelectedEquipment.id),
          canViewEquipmentActivity
            ? fetchEquipmentActivityList(activeSelectedEquipment.id)
            : Promise.resolve([]),
        ])
        setReports(refreshed)
        if (canViewEquipmentActivity) {
          setEquipmentActivity(nextActivity)
        }
      }
      await refreshEquipmentData()
      setViewedReport(null)
      setConfirmDeleteDraftReportId('')
      showSuccessToast('Draft report deleted. Recovery is available for 3 days.', 'Draft Deleted')
    } catch (error) {
      setViewedReportError(String(error?.message || 'Unable to delete draft report.'))
    } finally {
      setDeletingDraftReport(false)
    }
  }

  function canEditReport(report) {
    if (isOwner) return true
    if (!isStaff) return false
    return report.status === 'draft' && Number(report.submitted_by) === Number(profile?.id)
  }

  function canDeleteDraftReport(report) {
    if (!report) return false
    if (String(report.status || '').toLowerCase() !== 'draft') return false
    if (isOwner) return true
    return Number(report.submitted_by) === Number(profile?.id)
  }

  function appendReportImages(fileList) {
    const nextFiles = Array.from(fileList || []).filter(Boolean)
    if (nextFiles.length === 0) return

    setReportForm((current) => ({
      ...current,
      images: [...(Array.isArray(current.images) ? current.images : []), ...nextFiles],
    }))
  }

  function removePendingReportImageAt(indexToRemove) {
    setReportForm((current) => ({
      ...current,
      images: (Array.isArray(current.images) ? current.images : []).filter(
        (_, index) => index !== indexToRemove,
      ),
    }))
  }

  function appendChecklistItemImages(label, fileList) {
    const nextFiles = Array.from(fileList || []).filter(Boolean)
    if (nextFiles.length === 0) return

    setReportForm((current) => {
      const currentMap = current.checklistImageFilesByLabel || {}
      return {
        ...current,
        checklistImageFilesByLabel: {
          ...currentMap,
          [label]: [...(Array.isArray(currentMap[label]) ? currentMap[label] : []), ...nextFiles],
        },
      }
    })
  }

  function removePendingChecklistItemImage(label, indexToRemove) {
    setReportForm((current) => {
      const currentMap = current.checklistImageFilesByLabel || {}
      const nextFiles = (Array.isArray(currentMap[label]) ? currentMap[label] : []).filter(
        (_, index) => index !== indexToRemove,
      )
      const nextMap = { ...currentMap }
      if (nextFiles.length === 0) {
        delete nextMap[label]
      } else {
        nextMap[label] = nextFiles
      }
      return {
        ...current,
        checklistImageFilesByLabel: nextMap,
      }
    })
  }

  function updateReportChecklistItems(nextChecklistItems) {
    setReportForm((current) => {
      const normalizedItems = normalizeReportChecklistItems(nextChecklistItems)
      const nextMap = { ...(current.checklistImageFilesByLabel || {}) }
      normalizedItems.forEach((item) => {
        if (![REPORT_CHECKLIST_STATUS_WORN, REPORT_CHECKLIST_STATUS_ATTENTION].includes(item.status)) {
          delete nextMap[item.label]
        }
      })
      return {
        ...current,
        checklist_items: normalizedItems,
        checklistImageFilesByLabel: nextMap,
      }
    })
  }

  function applyNotPresentedReportPreset() {
    const equipmentName = String(activeSelectedEquipment?.name || '').trim()
    const defaultTitle = equipmentName ? `Not Presented - ${equipmentName}` : 'Not Presented - Equipment'

    setReportForm((current) => {
      const nextChecklistItems = normalizeReportChecklistItems(current.checklist_items).map((item) => ({
        ...item,
        status: REPORT_CHECKLIST_STATUS_NOT_PRESENTED,
        finding: '',
        recommendation: '',
        days_before_reinspection: '',
      }))

      return {
        ...current,
        title: defaultTitle,
        summary: NOT_PRESENTED_DEFAULT_SUMMARY,
        checklist_items: nextChecklistItems,
        checklistImageFilesByLabel: {},
      }
    })
  }

  function handleCloseEquipmentDetails() {
    logEqIdSyncDebug('close-equipment-details', {
      selectedEquipmentId: String(selectedEquipment?.id || ''),
    })
    setSelectedEquipment(null)
    setPendingDeepLinkEquipmentId('')
    setReports([])
    setEquipmentActivity([])
    setViewedReport(null)
    setSelectedReportImage(null)
    setReportForm(buildEmptyReportForm())
    setShowReportSubmissionConfirmModal(false)
    setReportSubmissionConfirmChecks(REPORT_SUBMISSION_CONFIRMATION_ITEMS.map(() => false))
    setShowCreateReportForm(false)
    setShowEditReportModal(false)
    setConfirmRemoveReportImageId('')
    setCreateReportError('')
    setEditReportError('')
    setViewedReportError('')
    setRevisionsError('')
    setShowRevisionsModal(false)
    setRevisionReportId('')
    setReportRevisions([])
    setCertificateError('')
    setEquipmentActivityError('')
    setCertificateSuccess('')
    setShowEquipmentQrModal(false)
    setEquipmentQrImageDataUrl('')
    setEquipmentQrLink('')
    setEquipmentQrError('')
    setGeneratingEquipmentQr(false)
  }

  function handleBackToCustomerList() {
    suppressQuerySyncUntilCustomerListRef.current = true
    scrollToCustomerListOnBackRef.current = true
    handleCloseEquipmentDetails()
    setSearchInput('')
    setSearchQuery('')
    setSearchParams({}, { replace: true })
  }

  async function handleOpenEquipmentQr() {
    if (!activeSelectedEquipment?.id) return

    const deepLink = buildEquipmentDeepLink(
      activeSelectedEquipment.company_id || selectedCompanyId,
      activeSelectedEquipment.id,
    )
    if (!deepLink) {
      setEquipmentQrError('Unable to build equipment link for this record.')
      setShowEquipmentQrModal(true)
      return
    }

    setShowEquipmentQrModal(true)
    setEquipmentQrError('')
    setEquipmentQrImageDataUrl('')
    setEquipmentQrLink(deepLink)
    setGeneratingEquipmentQr(true)

    try {
      const qrModule = await import('qrcode')
      const qrDataUrl = await qrModule.toDataURL(deepLink, {
        width: 320,
        margin: 1,
        errorCorrectionLevel: 'M',
      })
      setEquipmentQrImageDataUrl(qrDataUrl)
    } catch {
      setEquipmentQrError('Unable to generate QR code right now. Please try again.')
    } finally {
      setGeneratingEquipmentQr(false)
    }
  }

  function handleDownloadEquipmentQr() {
    if (!equipmentQrImageDataUrl || !activeSelectedEquipment?.id) return

    const anchor = document.createElement('a')
    anchor.href = equipmentQrImageDataUrl
    anchor.download = `equipment-${activeSelectedEquipment.id}-qr.png`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }

  function handlePrintEquipmentQr() {
    if (!equipmentQrImageDataUrl) return
    printEquipmentQrLabel(
      `${activeSelectedEquipment?.name || 'Equipment'} QR Label`,
      activeSelectedEquipment?.name || '',
      activeSelectedEquipment?.asset_tag || '',
      equipmentQrImageDataUrl,
      equipmentQrLink,
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/portal/login" replace />
  }

  return (
    <PortalLayout hideNavbar={isAnyModalOpen}>
      <PortalToast toast={portalToast} onClose={() => setPortalToast(null)} />
      <Modal
        open={showSessionExpiryWarning}
        onClose={() => setShowSessionExpiryWarning(false)}
        panelClassName="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
      >
        <div onClick={(event) => event.stopPropagation()}>
          <h3 className="text-lg font-bold text-[#123A7A]">Session Expiring Soon</h3>
          <p className="mt-2 text-sm text-slate-600">
            Your portal session will expire shortly. Stay signed in to keep working.
          </p>
          {sessionWarningError && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {sessionWarningError}
            </div>
          )}
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut || refreshingSession}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-[#123A7A] hover:text-[#123A7A] disabled:opacity-70"
            >
              {loggingOut ? 'Signing Out...' : 'Sign Out'}
            </button>
            <button
              type="button"
              onClick={handleStayLoggedIn}
              disabled={refreshingSession}
              className="rounded-md bg-[#123A7A] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#0f3168] disabled:opacity-70"
            >
              {refreshingSession ? 'Refreshing Session...' : 'Stay Logged In'}
            </button>
          </div>
        </div>
      </Modal>
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
                onClick={() => {
                  setPasswordChangeError('')
                  setPasswordChangeSuccess('')
                  setPasswordForm(buildEmptyPasswordForm())
                  setShowChangePasswordModal(true)
                }}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold uppercase tracking-wide text-slate-700 transition hover:border-[#123A7A] hover:text-[#123A7A]"
              >
                Change Password
              </button>
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
          <div ref={customerListSectionRef}>
            <CustomerListSection
            isOwner={isOwner}
            companies={companies}
            dashboardStats={dashboardStats}
            dashboardStatsError={dashboardStatsError}
            dashboardStatsLoading={dashboardStatsLoading}
            lastUpdatedLabel={customersLastUpdatedLabel}
            onRefreshCustomers={refreshCustomerCompanies}
            refreshingCustomers={refreshingCustomers}
            customerStatsFilter={customerStatsFilter}
            onToggleCustomerStatsFilter={(filterValue) =>
              setCustomerStatsFilter((current) => (current === filterValue ? 'all' : filterValue))
            }
            customerSearchInput={customerSearchInput}
            onCustomerSearchChange={setCustomerSearchInput}
            customerCreateError={customerCreateError}
            customerEditError={customerEditError}
            onExportCustomers={handleExportCustomersCsv}
            onBulkDeactivateCustomers={handleBulkDeactivateCustomers}
            selectedCustomerIds={selectedCustomerIds}
            onToggleCustomerSelection={toggleCustomerSelection}
            onToggleSelectAllCustomers={toggleSelectAllCustomers}
            bulkDeactivatingCustomers={bulkDeactivatingCustomers}
            loading={loading}
            visibleCustomers={visibleCustomers}
            filteredCustomers={filteredCustomers}
            customerStartIndex={customerStartIndex}
            customerPageSize={customerPageSize}
            customerPage={customerPage}
            customerTotalPages={customerTotalPages}
            onCustomerPagePrevious={() => setCustomerPage((current) => Math.max(1, current - 1))}
            onCustomerPageNext={() => setCustomerPage((current) => Math.min(customerTotalPages, current + 1))}
            onAddCustomer={() => {
              setShowCreateCustomerForm(true)
              setCustomerCreateError('')
              setCustomerCreateSuccess('')
            }}
            onOpenCustomer={(companyId) => {
              // Clear old data before loading new company
              setCompany(null)
              setEquipment([])
              window.scrollTo(0, 0)
              setSearchParams({ companyId: String(companyId) })
            }}
            onEditCustomer={handleStartEditCustomer}
            />
          </div>
        )}

        {showsCustomerPicker && isOwner && (
          <EmployeeControlsSection
            sectionRef={employeeControlsSectionRef}
            onAddEmployee={() => {
              setStaffAssignmentsError('')
              setStaffAssignmentsSuccess('')
              setShowCreateEmployeeForm(true)
            }}
            employeeSearchInput={employeeSearchInput}
            onEmployeeSearchChange={setEmployeeSearchInput}
            staffAssignmentsError={staffAssignmentsError}
            staffAssignmentsLoading={staffAssignmentsLoading}
            employeeControlsTab={employeeControlsTab}
            onSetEmployeeControlsTab={setEmployeeControlsTab}
            activeStaffAssignments={activeStaffAssignments}
            inactiveStaffAssignments={inactiveStaffAssignments}
            staffAssignments={currentStaffAssignments}
            filteredStaffAssignments={filteredStaffAssignments}
            visibleStaffAssignments={visibleStaffAssignments}
            companies={companies}
            onEmployeeRoleChange={handleEmployeeRoleChange}
            savingStaffUserId={savingStaffUserId}
            removingStaffUserId={removingStaffUserId}
            reactivatingStaffUserId={reactivatingStaffUserId}
            onOpenCompanyPicker={(userId) => {
              setCompanyPickerUserId(String(userId))
              setCompanyPickerSearchInput('')
            }}
            confirmRemoveUserId={confirmRemoveUserId}
            onConfirmRemoveUser={(userId) => setConfirmRemoveUserId(Number(userId))}
            onCancelRemoveUser={() => setConfirmRemoveUserId(0)}
            onRemoveEmployeeAssignment={handleRemoveEmployeeAssignment}
            onReactivateEmployeeAssignment={handleReactivateEmployeeAssignment}
            employeeStartIndex={employeeStartIndex}
            employeePageSize={employeePageSize}
            employeePage={employeePage}
            employeeTotalPages={employeeTotalPages}
            onEmployeePagePrevious={() => setEmployeePage((current) => Math.max(1, current - 1))}
            onEmployeePageNext={() => setEmployeePage((current) => Math.min(employeeTotalPages, current + 1))}
          />
        )}

        {showsCustomerPicker && isOwner && (
          <PendingApprovalsSection
            pendingReportApprovals={visiblePendingApprovals}
            pendingApprovalsLoading={pendingApprovalsLoading}
            pendingApprovalsError={pendingApprovalsError}
            lastUpdatedLabel={pendingApprovalsLastUpdatedLabel}
            onRefresh={() => {
              void refreshPendingReportApprovals(true)
            }}
            onBulkApprove={handleBulkApproveReports}
            selectedReportIds={selectedPendingApprovalIds}
            onToggleReportSelection={togglePendingApprovalSelection}
            onToggleSelectAllReports={toggleSelectAllPendingApprovals}
            bulkApproving={bulkApprovingReports}
            onReviewReport={(report) => {
              setViewedReportError('')
              setViewedReport(report)
            }}
            getReportStatusBadge={getReportStatusBadge}
            currentPage={pendingApprovalsPage}
            totalPages={pendingApprovalsTotalPages}
            onPageChange={(newPage) => {
              setPendingApprovalsPage(newPage)
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev)
                if (newPage === 1) {
                  next.delete('pendingApprovalsPage')
                } else {
                  next.set('pendingApprovalsPage', String(newPage))
                }
                return next
              })
            }}
            totalCount={pendingReportApprovals.length}
            rangeStart={pendingApprovalsRangeStart}
            rangeEnd={pendingApprovalsRangeEnd}
          />
        )}

        {!showsCustomerPicker && canEditReports && (
          <div className="mt-6">
            <button
              type="button"
              onClick={handleBackToCustomerList}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-[#123A7A] transition hover:border-[#123A7A]"
            >
              Back to Customer List
            </button>
          </div>
        )}

        {!showsCustomerPicker && selectedCompanyId && !company && (
          <CompanyProfileSkeleton />
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

                <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold uppercase tracking-wide text-slate-700">Sites</h3>
                      <p className="mt-1 text-sm text-slate-500">
                        Choose a site to view only the equipment assigned to that location.
                      </p>
                    </div>
                    {canManageSites && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowCreateSiteForm(true)
                          setSiteCreateError('')
                        }}
                        className="rounded-md border border-[#123A7A] bg-white px-3 py-2 text-sm font-semibold text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
                      >
                        + Add Site
                      </button>
                    )}
                  </div>

                  {companySites.length === 0 ? (
                    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      No sites have been added for this company yet.
                    </div>
                  ) : (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {companySites.map((site) => {
                        const isActiveSite = String(activeSite?.id) === String(site.id)
                        return (
                          <button
                            key={site.id}
                            type="button"
                            onClick={() => {
                              setSelectedSiteId(String(site.id))
                              setSelectedEquipment(null)
                              setEquipmentPage(1)
                            }}
                            className={`rounded-full border px-3 py-2 text-sm font-semibold transition ${
                              isActiveSite
                                ? 'border-[#123A7A] bg-[#123A7A] text-white'
                                : 'border-slate-300 bg-white text-slate-700 hover:border-[#123A7A] hover:text-[#123A7A]'
                            }`}
                          >
                            {site.name}
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {activeSite && (
                    <div className="mt-4 rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm text-slate-600">
                      <p>
                        <span className="font-semibold text-slate-700">Viewing site:</span>{' '}
                        {activeSite.name}
                      </p>
                      <p className="mt-1">
                        <span className="font-semibold text-slate-700">Site address:</span>{' '}
                        {activeSite.address || 'Not provided'}
                      </p>
                      {canManageSites && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setSiteEditForm({
                                name: String(activeSite.name || ''),
                                address: String(activeSite.address || ''),
                              })
                              setSiteEditError('')
                              setShowEditSiteForm(true)
                            }}
                            className="rounded-md border border-[#123A7A] bg-white px-3 py-1.5 text-xs font-semibold text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
                          >
                            Edit Site
                          </button>
                          <button
                            type="button"
                            onClick={handleDeleteSite}
                            disabled={deletingSite}
                            className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-70"
                          >
                            {deletingSite ? 'Deleting...' : 'Delete Site'}
                          </button>
                        </div>
                      )}
                      {siteEditError && (
                        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                          {siteEditError}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </article>
        )}

        {!showsCustomerPicker && selectedCompanyId && !company && (
          <CertificatesSkeleton />
        )}

        {!showsCustomerPicker && (
          <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-extrabold text-[#123A7A]">Certificates</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Open the latest full site certificate register for this site.
                </p>
              </div>
              {isOwner && (
                <button
                  type="button"
                  onClick={() => {
                    void handleGenerateSiteCertificates()
                  }}
                  disabled={generatingSiteCertificates}
                  className="rounded-md border border-emerald-600 bg-white px-3 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {generatingSiteCertificates ? 'Generating Certificate...' : 'Generate Certificate'}
                </button>
              )}
            </div>

            {certificateError && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {certificateError}
              </div>
            )}

            <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
              <div className="bg-slate-50 px-4 py-3">
                <h3 className="text-sm font-semibold text-slate-700">Generated Certificates</h3>
                <p className="mt-1 text-xs text-slate-500">Certificates generated for the selected site.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] border-collapse text-left text-sm">
                  <thead className="bg-[#123A7A] text-white">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Certificate</th>
                      <th className="px-4 py-3 font-semibold">Generated</th>
                      <th className="px-4 py-3 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {generatedCertificatesLoading ? (
                      <tr>
                        <td className="px-4 py-4 text-slate-500" colSpan={3}>
                          Loading generated certificates...
                        </td>
                      </tr>
                    ) : generatedCertificates.length === 0 ? (
                      <tr>
                        <td className="px-4 py-4 text-slate-500" colSpan={3}>
                          No certificates generated for this site yet.
                        </td>
                      </tr>
                    ) : (
                      generatedCertificates.map((certificate) => (
                          <tr key={certificate.id} className="border-t border-slate-200 odd:bg-white even:bg-slate-50/60">
                            <td className="px-4 py-3 font-semibold text-slate-800">{getGeneratedCertificateFilename(certificate)}</td>
                            <td className="px-4 py-3 text-slate-700">{formatGeneratedCertificateTimestamp(certificate.created_at)}</td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setConfirmDeleteGeneratedCertificateId('')
                                    void openGeneratedCertificatePreview(certificate)
                                  }}
                                  disabled={generatedCertificateActionId === Number(certificate.id)}
                                  className="rounded border border-[#123A7A] bg-white px-2 py-1 text-xs font-semibold text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
                                >
                                  {generatedCertificateActionId === Number(certificate.id) ? 'Opening...' : 'View'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setConfirmDeleteGeneratedCertificateId('')
                                    void handleSaveGeneratedCertificate(certificate)
                                  }}
                                  disabled={generatedCertificateActionId === Number(certificate.id)}
                                  className="rounded border border-[#123A7A] bg-white px-2 py-1 text-xs font-semibold text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
                                >
                                  {generatedCertificateActionId === Number(certificate.id) ? 'Preparing...' : 'Download'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setConfirmDeleteGeneratedCertificateId('')
                                    void handlePrintGeneratedCertificate(certificate)
                                  }}
                                  disabled={generatedCertificateActionId === Number(certificate.id)}
                                  className="rounded border border-[#123A7A] bg-[#123A7A] px-2 py-1 text-xs font-semibold text-white transition hover:bg-[#0f3168]"
                                >
                                  {generatedCertificateActionId === Number(certificate.id) ? 'Preparing...' : 'Print'}
                                </button>
                                {isOwner && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void handleDeleteGeneratedCertificate(certificate)
                                    }}
                                    disabled={generatedCertificateActionId === Number(certificate.id)}
                                    className="rounded border border-red-300 bg-white px-2 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-600 hover:text-white"
                                  >
                                    {generatedCertificateActionId === Number(certificate.id)
                                      ? 'Deleting...'
                                      : confirmDeleteGeneratedCertificateId === String(certificate.id)
                                      ? 'Confirm Delete'
                                      : 'Delete'}
                                  </button>
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
          </section>
        )}

        {!showsCustomerPicker && selectedCompanyId && !company && (
          <EquipmentActivitySkeleton />
        )}

        {!showsCustomerPicker && (
          <EquipmentTableSection
            canEditReports={canEditReports}
            searchInput={searchInput}
            onSearchInputChange={setSearchInput}
            onSearchSubmit={() => setSearchQuery(searchInput.trim())}
            lastUpdatedLabel={equipmentLastUpdatedLabel}
            onOpenCreateEquipment={() => {
              if (!activeSite) {
                setEquipmentCreateError('Add or select a site before creating equipment.')
                return
              }
              setShowCreateEquipmentForm(true)
              setEquipmentCreateError('')
            }}
            equipmentCreateError={equipmentCreateError}
            onRefreshEquipment={refreshEquipmentData}
            onExportEquipment={handleExportEquipmentCsv}
            onBulkDecommissionEquipment={handleBulkDecommissionEquipment}
            selectedEquipmentIds={selectedEquipmentIds}
            onToggleEquipmentSelection={toggleEquipmentSelection}
            onToggleSelectAllEquipment={toggleSelectAllEquipment}
            bulkDecommissioning={bulkDecommissioningEquipment}
            refreshingEquipment={refreshingEquipment}
            loading={loading}
            equipment={equipment}
            equipmentTableTab={equipmentTableTab}
            onSetEquipmentTableTab={(tab) => {
              setEquipmentTableTab(tab)
              setEquipmentPage(1)
            }}
            equipmentSortKey={equipmentSortKey}
            equipmentSortDirection={equipmentSortDirection}
            onToggleEquipmentSort={handleToggleEquipmentSort}
            inspectionUrgencyFilter={inspectionUrgencyFilter}
            onInspectionUrgencyFilterChange={setInspectionUrgencyFilter}
            equipmentStatusFilter={equipmentStatusFilter}
            onEquipmentStatusFilterChange={setEquipmentStatusFilter}
            activeEquipment={activeEquipment}
            decommissionedEquipment={decommissionedEquipment}
            isMobileViewport={isMobileViewport}
            visibleEquipment={visibleEquipment}
            getInspectionStatusBadge={getInspectionStatusBadge}
            formatDateDDMMYYYY={formatDateDDMMYYYY}
            expandedEquipmentCardId={expandedEquipmentCardId}
            onToggleExpandedEquipmentCard={(equipmentId) =>
              setExpandedEquipmentCardId((current) => (String(current) === String(equipmentId) ? '' : String(equipmentId)))
            }
            activeSelectedEquipment={activeSelectedEquipment}
            onSelectEquipmentForView={(item) => {
              logEqIdSyncDebug('manual-select-equipment', {
                selectedEquipmentId: String(item?.id || ''),
                selectedEquipmentName: String(item?.name || ''),
              })
              setSelectedEquipment(item)
              setPendingDeepLinkEquipmentId('')
              setReportForm(buildEmptyReportForm())
              setShowCreateReportForm(false)
              setRevisionReportId('')
              setReportRevisions([])
            }}
            onCloseEquipmentDetails={handleCloseEquipmentDetails}
            onOpenEquipmentQr={handleOpenEquipmentQr}
            isOwner={isOwner}
            onSetEquipmentActive={(itemId) => handleUpdateEquipmentStatus('active', itemId)}
            updatingEquipmentStatus={updatingEquipmentStatus}
            equipmentStatusDraft={equipmentStatusDraft}
            onEquipmentStatusDraftChange={setEquipmentStatusDraft}
            onSubmitEquipmentStatusUpdate={handleSubmitEquipmentStatusUpdate}
            equipmentStatusError={equipmentStatusError}
            reportError={reportError}
            certificateError={certificateError}
            equipmentActivityError={equipmentActivityError}
            canViewEquipmentActivity={canViewEquipmentActivity}
            onOpenCreateReport={() => {
              openCreateReportForm()
            }}
            reportsLoading={reportsLoading}
            reports={reports}
            getReportStatusBadge={getReportStatusBadge}
            onViewReport={(report) => {
              setViewedReportError('')
              setViewedReport(report)
            }}
            equipmentActivityLoading={equipmentActivityLoading}
            equipmentActivity={equipmentActivity}
            nowMs={nowMs}
            getActivityActionLabel={getActivityActionLabel}
            getActivityActionBadge={getActivityActionBadge}
            formatActivityDetails={formatActivityDetails}
            formatActivityTimestamp={formatActivityTimestamp}
            getActivityRecoveryState={getActivityRecoveryState}
            recoveredAtMsByRecoverableTarget={recoveredAtMsByRecoverableTarget}
            recoveringCertificateId={recoveringCertificateId}
            recoveringReportId={recoveringReportId}
            deletingDraftReport={deletingDraftReport}
            onRecoverActivityFromEntry={handleRecoverActivityFromEntry}
            currentTableEquipment={urgencyFilteredEquipment}
            equipmentRangeStart={equipmentRangeStart}
            equipmentRangeEnd={equipmentRangeEnd}
            equipmentPage={equipmentPage}
            equipmentTotalPages={equipmentTotalPages}
            onEquipmentPagePrevious={() => setEquipmentPage((current) => Math.max(1, current - 1))}
            onEquipmentPageNext={() => setEquipmentPage((current) => Math.min(equipmentTotalPages, current + 1))}
          />
        )}

        {!showsCustomerPicker && activeSelectedEquipment && !isMobileViewport && (
          <section
            ref={equipmentDetailsSectionRef}
            tabIndex={-1}
            className="mt-8 scroll-mt-24 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-extrabold text-[#123A7A]">
                  Equipment Details: {activeSelectedEquipment.name}
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleOpenEquipmentQr}
                  className="rounded-md border border-[#123A7A] bg-white px-3 py-2 text-sm font-semibold text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
                >
                  Show Equipment QR
                </button>
                <button
                  type="button"
                  onClick={handleCloseEquipmentDetails}
                  aria-label="Close equipment details panel"
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-[#123A7A] transition hover:border-[#123A7A]"
                >
                  Close Details
                </button>
              </div>
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
                <p><span className="font-semibold">Next Inspection Due:</span> {formatDateDDMMYYYY(activeSelectedEquipment.next_inspection_due)}</p>
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

            {certificateError && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {certificateError}
              </div>
            )}

            {canViewEquipmentActivity && equipmentActivityError && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {equipmentActivityError}
              </div>
            )}
            {canEditReports && (
              <div className="mt-4 flex flex-wrap gap-2">
                {isOwner && (
                  <button
                    type="button"
                    onClick={() => {
                      void handleGenerateSiteCertificates()
                    }}
                    disabled={generatingSiteCertificates}
                    className="rounded-md border border-emerald-600 bg-white px-3 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-600 hover:text-white"
                  >
                    {generatingSiteCertificates ? 'Generating Certificate...' : 'Generate Certificate'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={openCreateReportForm}
                  className="rounded-md border border-[#123A7A] bg-white px-3 py-2 text-sm font-semibold text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
                >
                  Create New Report
                </button>
              </div>
            )}

            <p className="mt-3 text-xs text-slate-500">
              Keyboard shortcuts: <span className="font-semibold">Alt+N</span> new report,{' '}
              <span className="font-semibold">Alt+U</span> generate certificate,{' '}
              <span className="font-semibold">Alt+E</span> export reports CSV.
            </p>

            {canViewEquipmentActivity && (
              <div className="mt-6 overflow-hidden rounded-xl border border-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 px-4 py-3">
                  <h3 className="text-sm font-semibold text-slate-700">Equipment Activity</h3>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full border border-slate-300 bg-white px-2.5 py-1 font-semibold text-slate-700">
                      {equipmentActivity.length} entries
                    </span>
                    {equipmentActivity[0]?.created_at ? (
                      <span className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-slate-600">
                        Latest: {formatActivityTimestamp(equipmentActivity[0].created_at)}
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* Desktop Table View */}
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead className="bg-[#123A7A] text-white">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Date &amp; Time</th>
                        <th className="px-4 py-3 font-semibold">Performed By</th>
                        <th className="px-4 py-3 font-semibold">Activity Type</th>
                        <th className="px-4 py-3 font-semibold">Details</th>
                        <th className="px-4 py-3 font-semibold">Recovery</th>
                      </tr>
                    </thead>
                    <tbody>
                      {equipmentActivityLoading ? (
                        <>
                          {Array.from({ length: 4 }).map((_, i) => (
                            <tr key={i} className="border-t border-slate-200 odd:bg-white even:bg-slate-50/60">
                              <td className="px-4 py-3"><div className="h-4 w-32 animate-pulse rounded bg-slate-200" /></td>
                              <td className="px-4 py-3"><div className="h-4 w-24 animate-pulse rounded bg-slate-200" /></td>
                              <td className="px-4 py-3"><div className="h-6 w-20 animate-pulse rounded-full bg-slate-200" /></td>
                              <td className="px-4 py-3"><div className="h-4 w-40 animate-pulse rounded bg-slate-200" /></td>
                              <td className="px-4 py-3"><div className="h-8 w-24 animate-pulse rounded bg-slate-200" /></td>
                            </tr>
                          ))}
                        </>
                      ) : equipmentActivity.length === 0 ? (
                        <tr>
                          <td className="px-4 py-4 text-slate-500" colSpan={5}>
                            No activity has been recorded for this equipment yet.
                          </td>
                        </tr>
                      ) : (
                        visibleEquipmentActivity.map((entry) => {
                          const activityLabel = getActivityActionLabel(entry.action)
                          const activityBadge = getActivityActionBadge(entry.action)
                          const recoveryState = getActivityRecoveryState(entry, nowMs, recoveredAtMsByRecoverableTarget)
                          const isRecovering = recoveryState.targetType === 'certificate'
                            ? recoveringCertificateId === recoveryState.targetId
                            : recoveryState.targetType === 'report'
                              ? recoveringReportId === recoveryState.targetId
                              : false
                          return (
                            <tr key={entry.id} className="border-t border-slate-200 odd:bg-white even:bg-slate-50/60">
                              <td className="px-4 py-3 text-slate-700">{formatActivityTimestamp(entry.created_at)}</td>
                              <td className="px-4 py-3 text-slate-700">{entry.actor_name || 'System'}</td>
                              <td className="px-4 py-3">
                                <span
                                  className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${activityBadge.color}`}
                                >
                                  {activityLabel}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-slate-700">{formatActivityDetails(entry.details)}</td>
                              <td className="px-4 py-3 text-slate-700">
                                {recoveryState.targetId ? (
                                  <div className="flex flex-col gap-1">
                                    <span className="text-xs text-slate-600">{recoveryState.label}</span>
                                    {isOwner && recoveryState.canRecover && (
                                      <button
                                        type="button"
                                        onClick={() => handleRecoverActivityFromEntry(entry)}
                                        disabled={isRecovering || deletingDraftReport}
                                        className="w-fit rounded border border-emerald-600 px-2 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                                      >
                                        {isRecovering
                                          ? 'Recovering...'
                                          : recoveryState.targetType === 'report'
                                            ? 'Recover Report'
                                            : 'Recover'}
                                      </button>
                                    )}
                                    {recoveryState.status === 'recovered' && (
                                      <span className="w-fit rounded-full border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                                        Recovered
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-xs text-slate-500">-</span>
                                )}
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Card View */}
                <div className="space-y-2 bg-white p-4 md:hidden">
                  {equipmentActivityLoading ? (
                    <div className="space-y-3">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <article key={i} className="rounded-lg border border-slate-200 bg-white p-3">
                          <div className="h-4 w-32 animate-pulse rounded bg-slate-200" />
                          <div className="mt-2 h-3 w-40 animate-pulse rounded bg-slate-200" />
                          <div className="mt-2 h-3 w-36 animate-pulse rounded bg-slate-200" />
                          <div className="mt-3 h-8 w-20 animate-pulse rounded bg-slate-200" />
                        </article>
                      ))}
                    </div>
                  ) : equipmentActivity.length === 0 ? (
                    <div className="rounded-lg bg-slate-100 px-4 py-6 text-center text-sm text-slate-500">
                      No activity has been recorded for this equipment yet.
                    </div>
                  ) : (
                    visibleEquipmentActivity.map((entry) => {
                      const activityLabel = getActivityActionLabel(entry.action)
                      const activityBadge = getActivityActionBadge(entry.action)
                      const recoveryState = getActivityRecoveryState(entry, nowMs, recoveredAtMsByRecoverableTarget)
                      const isRecovering = recoveryState.targetType === 'certificate'
                        ? recoveringCertificateId === recoveryState.targetId
                        : recoveryState.targetType === 'report'
                          ? recoveringReportId === recoveryState.targetId
                          : false
                      return (
                        <div key={entry.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
                          <div className="mb-2 flex items-start justify-between gap-2">
                            <span
                              className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${activityBadge.color}`}
                            >
                              {activityLabel}
                            </span>
                            <span className="text-xs font-semibold text-slate-700">{entry.actor_name || 'System'}</span>
                          </div>
                          <p className="mb-1 text-xs font-semibold text-slate-700">{formatActivityTimestamp(entry.created_at)}</p>
                          <p className="text-xs leading-relaxed text-slate-600">{formatActivityDetails(entry.details)}</p>
                          {recoveryState.targetId && (
                            <div className="mt-2 flex items-center justify-between gap-2">
                              <span className="text-[11px] text-slate-600">{recoveryState.label}</span>
                              {isOwner && recoveryState.canRecover && (
                                <button
                                  type="button"
                                  onClick={() => handleRecoverActivityFromEntry(entry)}
                                  disabled={isRecovering || deletingDraftReport}
                                  className="rounded border border-emerald-600 px-2 py-1 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {isRecovering
                                    ? 'Recovering...'
                                    : recoveryState.targetType === 'report'
                                      ? 'Recover Report'
                                      : 'Recover'}
                                </button>
                              )}
                              {recoveryState.status === 'recovered' && (
                                <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                                  Recovered
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>

                {equipmentActivityTotalPages > 1 && (
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs text-slate-600">
                      Showing <span className="font-semibold">{equipmentActivityRangeStart}</span> to{' '}
                      <span className="font-semibold">{equipmentActivityRangeEnd}</span> of{' '}
                      <span className="font-semibold">{equipmentActivity.length}</span> activity entries
                    </p>
                    <PaginationControls
                      page={equipmentActivityPage}
                      totalPages={equipmentActivityTotalPages}
                      onPrevious={() =>
                        setEquipmentActivityPage((current) => Math.max(1, current - 1))
                      }
                      onNext={() =>
                        setEquipmentActivityPage((current) => Math.min(equipmentActivityTotalPages, current + 1))
                      }
                    />
                  </div>
                )}
              </div>
            )}

            <div className="mt-6 overflow-hidden rounded-xl border border-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Latest Report</h3>
                <button
                  type="button"
                  onClick={() => setShowReportHistory((current) => !current)}
                  className="rounded-md border border-[#123A7A] bg-white px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
                >
                  {showReportHistory ? 'Hide History' : 'View History'}
                </button>
              </div>

              <div className="p-4">
                {reportsLoading ? (
                  <p className="text-sm text-slate-500">Loading reports...</p>
                ) : !latestReport ? (
                  <p className="text-sm text-slate-500">No reports have been submitted for this equipment.</p>
                ) : (
                  (() => {
                    const latestStatusBadge = getReportStatusBadge(latestReport.status)
                    const latestChecklistSections = getChecklistSections(latestReport.checklist_items)
                    const isLatestNotPresentedReport = isChecklistMarkedNotPresented(latestChecklistSections)
                    const latestChecklistImagesByLabel = getChecklistImagesByLabel(latestReport.images)
                    return (
                      <article className="rounded-lg border border-slate-200 bg-white p-3">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-sm font-bold text-slate-800">{latestReport.title || 'Untitled report'}</h3>
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${latestStatusBadge.color}`}>
                            {latestStatusBadge.label}
                          </span>
                        </div>
                        <div className="mt-2 grid gap-1 text-xs text-slate-600 md:grid-cols-2">
                          <p><span className="font-semibold text-slate-700">Date:</span> {latestReport.report_date || '-'}</p>
                          <p><span className="font-semibold text-slate-700">Inspector:</span> {latestReport.submitted_by_name || '-'}</p>
                          <p className="md:col-span-2"><span className="font-semibold text-slate-700">Summary:</span> {latestReport.summary || '-'}</p>
                        </div>

                        {isLatestNotPresentedReport ? (
                          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3">
                            <p className="text-sm font-semibold uppercase tracking-wide text-rose-800">Not Presented</p>
                          </div>
                        ) : (
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                              <p className="text-xs font-semibold text-amber-800">Worn but Servicable</p>
                              {latestChecklistSections.worn.length === 0 ? (
                                <p className="mt-1 text-xs text-amber-700">None reported.</p>
                              ) : (
                                <ul className="mt-1 space-y-1 text-xs text-amber-900">
                                  {latestChecklistSections.worn.map((item) => (
                                    <li key={`latest-worn-${item.label}`}>
                                      <p className="font-semibold">{item.label}</p>
                                      <p>Finding: {item.finding || '-'}</p>
                                      <p>Recommendation: {item.recommendation || '-'}</p>
                                      {(latestChecklistImagesByLabel[item.label] || []).length > 0 && (
                                        <div className="mt-2 flex flex-wrap gap-2">
                                          {(latestChecklistImagesByLabel[item.label] || []).map((image) => (
                                            <button
                                              key={`latest-worn-image-${image.id}`}
                                              type="button"
                                              onClick={() => handleOpenReportImage(image, latestChecklistImagesByLabel[item.label])}
                                              className="overflow-hidden rounded border border-slate-200 bg-white"
                                            >
                                              <img
                                                src={image.image_url}
                                                alt={`${item.label} checklist`}
                                                className="h-12 w-12 object-cover"
                                              />
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                              <p className="text-xs font-semibold text-rose-800">Attention Required</p>
                              {latestChecklistSections.attention.length === 0 ? (
                                <p className="mt-1 text-xs text-rose-700">None reported.</p>
                              ) : (
                                <ul className="mt-1 space-y-1 text-xs text-rose-900">
                                  {latestChecklistSections.attention.map((item) => (
                                    <li key={`latest-attention-${item.label}`}>
                                      <p className="font-semibold">{item.label}</p>
                                      <p>Finding: {item.finding || '-'}</p>
                                      <p>Recommendation: {item.recommendation || '-'}</p>
                                      {(latestChecklistImagesByLabel[item.label] || []).length > 0 && (
                                        <div className="mt-2 flex flex-wrap gap-2">
                                          {(latestChecklistImagesByLabel[item.label] || []).map((image) => (
                                            <button
                                              key={`latest-attention-image-${image.id}`}
                                              type="button"
                                              onClick={() => handleOpenReportImage(image, latestChecklistImagesByLabel[item.label])}
                                              className="overflow-hidden rounded border border-slate-200 bg-white"
                                            >
                                              <img
                                                src={image.image_url}
                                                alt={`${item.label} checklist`}
                                                className="h-12 w-12 object-cover"
                                              />
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                            {latestChecklistSections.notPresented.length > 0 && (
                              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 md:col-span-2">
                                <p className="text-xs font-semibold text-blue-800">Not Presented</p>
                                <ul className="mt-1 space-y-1 text-xs text-blue-900">
                                  {latestChecklistSections.notPresented.map((item) => (
                                    <li key={`latest-not-presented-${item.label}`}>
                                      <p className="font-semibold">{item.label}</p>
                                      <p>Not presented for examination.</p>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}

                        {Array.isArray(latestReport.images) && latestReport.images.length > 0 && (
                          <div className="mt-3">
                            <p className="text-xs font-semibold text-slate-700">Images</p>
                            <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                              {latestReport.images.map((image) => (
                                <button
                                  key={`latest-report-image-${image.id}`}
                                  type="button"
                                  onClick={() => handleOpenReportImage(image, latestReport.images)}
                                  className="overflow-hidden rounded border border-slate-200 bg-white"
                                >
                                  <img
                                    src={image.image_url}
                                    alt="Report attachment"
                                    className="h-16 w-full object-cover"
                                    loading="lazy"
                                  />
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="mt-3 flex justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              setViewedReportError('')
                              setViewedReport(latestReport)
                            }}
                            className="rounded border border-[#123A7A] px-2 py-1 text-xs font-semibold text-[#123A7A]"
                          >
                            View
                          </button>
                        </div>
                      </article>
                    )
                  })()
                )}
              </div>

              {showReportHistory && (
                <>
              <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 px-4 py-3">
                <label className="flex items-center gap-3 text-sm font-semibold text-slate-700">
                  Filter by Year:
                  <select
                    value={reportYearFilter}
                    onChange={(event) => setReportYearFilter(event.target.value)}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900"
                  >
                    <option value="">All Years ({reports.length})</option>
                    {availableReportYears.map((year) => (
                      <option key={year} value={year}>
                        {year} ({reports.filter((r) => r.report_date?.startsWith(year)).length})
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={handleExportReportsCsv}
                  className="rounded-md border border-[#123A7A] bg-white px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
                >
                  Export Reports CSV
                </button>
              </div>
              {isMobileViewport && (
                <div className="space-y-3 p-3">
                {reportsLoading ? (
                  <ReportsSkeleton count={3} />
                ) : filteredReports.length === 0 ? (
                  <p className="text-sm text-slate-500">No reports have been submitted for this equipment.</p>
                ) : (
                  filteredReports.map((report) => (
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
                          onClick={() => {
                            setViewedReportError('')
                            setViewedReport(report)
                          }}
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
                      <>
                        {Array.from({ length: 4 }).map((_, i) => (
                          <tr key={i} className="border-t border-slate-200 odd:bg-white even:bg-slate-50/60">
                            <td className="px-4 py-3"><div className="h-4 w-32 animate-pulse rounded bg-slate-200" /></td>
                            <td className="px-4 py-3"><div className="h-4 w-24 animate-pulse rounded bg-slate-200" /></td>
                            <td className="px-4 py-3"><div className="h-6 w-20 animate-pulse rounded-full bg-slate-200" /></td>
                            <td className="px-4 py-3"><div className="h-4 w-28 animate-pulse rounded bg-slate-200" /></td>
                            <td className="px-4 py-3"><div className="h-4 w-32 animate-pulse rounded bg-slate-200" /></td>
                            <td className="px-4 py-3"><div className="h-8 w-16 animate-pulse rounded bg-slate-200" /></td>
                          </tr>
                        ))}
                      </>
                    ) : filteredReports.length === 0 ? (
                      <tr>
                        <td className="px-4 py-4 text-slate-500" colSpan={6}>
                          No reports have been submitted for this equipment.
                        </td>
                      </tr>
                    ) : (
                      filteredReports.map((report) => {
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
                                onClick={() => {
                                  setViewedReportError('')
                                  setViewedReport(report)
                                }}
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
                </>
              )}
            </div>
          </section>
        )}

        {isOwner && showCreateCustomerForm && (
          <Modal open={showCreateCustomerForm} onClose={closeCreateCustomerForm}>
            <form
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
                  onClick={() => closeCreateCustomerForm()}
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

              {customerCreateError && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {customerCreateError}
                </div>
              )}

              <button
                type="submit"
                disabled={creatingCustomer}
                className="mt-4 rounded-md bg-[#123A7A] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f3168] disabled:opacity-70"
              >
                {creatingCustomer ? 'Creating customer...' : 'Create Customer'}
              </button>
            </form>
          </Modal>
        )}

        {isOwner && showEditCustomerForm && (
          <Modal
            open={showEditCustomerForm}
            onClose={closeEditCustomerForm}
          >
            <form
              onSubmit={handleEditCustomer}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold text-[#123A7A]">Edit Customer</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    Update customer company details or deactivate access.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => closeEditCustomerForm()}
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
                    value={customerEditForm.company_name}
                    onChange={(event) =>
                      setCustomerEditForm((current) => ({ ...current, company_name: event.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    required
                  />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Company Email
                  <input
                    type="email"
                    value={customerEditForm.company_contact_email}
                    onChange={(event) =>
                      setCustomerEditForm((current) => ({ ...current, company_contact_email: event.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Company Phone
                  <input
                    type="text"
                    value={customerEditForm.company_contact_phone}
                    onChange={(event) =>
                      setCustomerEditForm((current) => ({ ...current, company_contact_phone: event.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-sm font-semibold text-slate-700 md:col-span-2">
                  Company Address
                  <input
                    type="text"
                    value={customerEditForm.company_address}
                    onChange={(event) =>
                      setCustomerEditForm((current) => ({ ...current, company_address: event.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm font-semibold text-red-700 md:col-span-2">
                  <input
                    type="checkbox"
                    checked={customerEditForm.deactivate_customer}
                    onChange={(event) => {
                      const isChecked = event.target.checked
                      setCustomerEditForm((current) => ({
                        ...current,
                        deactivate_customer: isChecked,
                      }))
                      setConfirmCustomerDeactivate(false)
                    }}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Deactivate customer company (removes it from active portal lists)
                </label>
              </div>

              {customerEditError && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {customerEditError}
                </div>
              )}

              <button
                type="submit"
                disabled={editingCustomer}
                className="mt-4 rounded-md bg-[#123A7A] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f3168] disabled:opacity-70"
              >
                {editingCustomer
                  ? 'Saving changes...'
                  : customerEditForm.deactivate_customer && confirmCustomerDeactivate
                    ? 'Confirm Deactivate Customer'
                    : 'Save Changes'}
              </button>
            </form>
          </Modal>
        )}

        {isOwner && showCreateEmployeeForm && (
          <Modal open={showCreateEmployeeForm} onClose={closeCreateEmployeeForm}>
            <form
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
                  onClick={() => closeCreateEmployeeForm()}
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

              {staffAssignmentsError && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {staffAssignmentsError}
                </div>
              )}

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
          </Modal>
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
                              setActiveStaffAssignments((current) =>
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

              {staffAssignmentsError && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {staffAssignmentsError}
                </div>
              )}

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

        {canEditReports && showCreateSiteForm && (
          <Modal open={showCreateSiteForm} onClose={() => setShowCreateSiteForm(false)}>
            <form
              onSubmit={handleCreateSite}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-bold text-[#123A7A]">Add Site</h3>
                <button
                  type="button"
                  onClick={() => setShowCreateSiteForm(false)}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700"
                >
                  Close
                </button>
              </div>
              <div className="mt-4 grid gap-3">
                <label className="text-sm font-semibold text-slate-700">
                  Site Name
                  <input
                    type="text"
                    value={siteForm.name}
                    onChange={(event) => setSiteForm((current) => ({ ...current, name: event.target.value }))}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    required
                  />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Site Address
                  <textarea
                    value={siteForm.address}
                    onChange={(event) => setSiteForm((current) => ({ ...current, address: event.target.value }))}
                    className="mt-1 min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
              </div>

              {siteCreateError && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {siteCreateError}
                </div>
              )}

              <button
                type="submit"
                disabled={creatingSite}
                className="mt-4 rounded-md bg-[#123A7A] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f3168] disabled:opacity-70"
              >
                {creatingSite ? 'Creating site...' : 'Create Site'}
              </button>
            </form>
          </Modal>
        )}

        {canManageSites && showEditSiteForm && (
          <Modal open={showEditSiteForm} onClose={() => setShowEditSiteForm(false)}>
            <form
              onSubmit={handleUpdateSite}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-bold text-[#123A7A]">Edit Site</h3>
                <button
                  type="button"
                  onClick={() => setShowEditSiteForm(false)}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700"
                >
                  Close
                </button>
              </div>
              <div className="mt-4 grid gap-3">
                <label className="text-sm font-semibold text-slate-700">
                  Site Name
                  <input
                    type="text"
                    value={siteEditForm.name}
                    onChange={(event) => setSiteEditForm((current) => ({ ...current, name: event.target.value }))}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    required
                  />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Site Address
                  <textarea
                    value={siteEditForm.address}
                    onChange={(event) => setSiteEditForm((current) => ({ ...current, address: event.target.value }))}
                    className="mt-1 min-h-24 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
              </div>

              {siteEditError && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {siteEditError}
                </div>
              )}

              <button
                type="submit"
                disabled={updatingSite}
                className="mt-4 rounded-md bg-[#123A7A] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f3168] disabled:opacity-70"
              >
                {updatingSite ? 'Saving...' : 'Save Site'}
              </button>
            </form>
          </Modal>
        )}

        {canEditReports && showCreateEquipmentForm && (
          <Modal open={showCreateEquipmentForm} onClose={closeCreateEquipmentForm}>
            <form
              onSubmit={handleCreateEquipment}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-bold text-[#123A7A]">Add Equipment</h3>
                <button
                  type="button"
                  onClick={() => closeCreateEquipmentForm()}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700"
                >
                  Close
                </button>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 md:col-span-2">
                  <span className="font-semibold text-slate-800">Site:</span>{' '}
                  {activeSite?.name || 'No site selected'}
                </div>
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
                  Safe Working Load
                  <input
                    type="text"
                    value={equipmentForm.safe_working_load}
                    onChange={(event) =>
                      setEquipmentForm((current) => ({ ...current, safe_working_load: event.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    placeholder="e.g. 1000 kg"
                    required
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
                  {equipmentNextDuePreview
                    ? formatDateDDMMYYYY(equipmentNextDuePreview)
                    : 'Set a last inspected date to see the calculated due date.'}
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

              {equipmentCreateError && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {equipmentCreateError}
                </div>
              )}

              <button
                type="submit"
                disabled={creatingEquipment}
                className="mt-4 rounded-md bg-[#123A7A] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f3168] disabled:opacity-70"
              >
                {creatingEquipment ? 'Creating equipment...' : 'Create Equipment'}
              </button>
            </form>
          </Modal>
        )}

        {showChangePasswordModal && (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 pb-6 pt-24 sm:items-center sm:pt-6"
            onClick={() => closeChangePasswordModal()}
          >
            <form
              className="max-h-[calc(100vh-7rem)] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:max-h-[calc(100vh-3rem)]"
              onSubmit={handleChangePassword}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold text-[#123A7A]">Change Password</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    {profile?.requiredPasswordChange
                      ? 'Your account requires a password update before continuing.'
                      : 'Update your portal password.'}
                  </p>
                </div>
                {!profile?.requiredPasswordChange && (
                  <button
                    type="button"
                    onClick={() => closeChangePasswordModal()}
                    className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700"
                  >
                    Close
                  </button>
                )}
              </div>

              {passwordChangeError && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {passwordChangeError}
                </div>
              )}
              <div className="mt-4 grid gap-3">
                <label className="text-sm font-semibold text-slate-700">
                  Current Password
                  <input
                    type="password"
                    value={passwordForm.current_password}
                    onChange={(event) =>
                      setPasswordForm((current) => ({ ...current, current_password: event.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    required
                  />
                </label>

                <label className="text-sm font-semibold text-slate-700">
                  New Password
                  <input
                    type="password"
                    value={passwordForm.new_password}
                    onChange={(event) =>
                      setPasswordForm((current) => ({ ...current, new_password: event.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    required
                  />
                </label>

                <label className="text-sm font-semibold text-slate-700">
                  Confirm New Password
                  <input
                    type="password"
                    value={passwordForm.confirm_password}
                    onChange={(event) =>
                      setPasswordForm((current) => ({ ...current, confirm_password: event.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    required
                  />
                </label>
              </div>

              <button
                type="submit"
                disabled={changingPassword}
                className="mt-4 rounded-md bg-[#123A7A] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f3168] disabled:opacity-70"
              >
                {changingPassword ? 'Updating password...' : 'Update Password'}
              </button>
            </form>
          </div>
        )}

        {canEditReports && showCreateReportForm && (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 pb-6 pt-24 sm:items-center sm:pt-6"
            onClick={() => void closeCreateReportForm()}
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
                  onClick={() => void closeCreateReportForm()}
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
                <ReportChecklistEditor
                  checklistItems={normalizedReportChecklistItems}
                  onChange={updateReportChecklistItems}
                  onApplyNotPresentedPreset={applyNotPresentedReportPreset}
                  pendingChecklistImagesByLabel={reportForm.checklistImageFilesByLabel}
                  existingChecklistImagesByLabel={existingChecklistImagesByLabel}
                  onAddChecklistItemImages={appendChecklistItemImages}
                  onRemovePendingChecklistItemImage={removePendingChecklistItemImage}
                  onOpenChecklistItemImage={handleOpenReportImage}
                />
                <label className="text-sm font-semibold text-slate-700 md:col-span-2">
                  Images
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(event) => {
                      appendReportImages(event.target.files)
                      event.target.value = ''
                    }}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                  {reportForm.images.length > 0 && (
                    <>
                      <p className="mt-1 text-xs text-slate-500">
                        {reportForm.images.length} image(s) selected. You can add more by choosing again.
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {reportForm.images.map((file, index) => (
                          <div
                            key={`${file.name}-${file.lastModified}-${index}`}
                            className="inline-flex max-w-full items-center gap-2 rounded-full border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs text-slate-700"
                          >
                            <span className="max-w-48 truncate" title={file.name}>{file.name}</span>
                            <button
                              type="button"
                              onClick={() => removePendingReportImageAt(index)}
                              className="rounded-full border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 transition hover:border-rose-400 hover:text-rose-700"
                              aria-label={`Remove ${file.name}`}
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </label>
              </div>

              {createReportError && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {createReportError}
                </div>
              )}

              <button
                type="submit"
                disabled={creatingReport}
                className="mt-4 rounded-md bg-[#123A7A] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f3168] disabled:opacity-70"
              >
                {creatingReport ? 'Submitting...' : 'Submit Report'}
              </button>
            </form>
          </div>
        )}

        {viewedReport && (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-3 pb-3 pt-3 sm:px-4 sm:pb-6 sm:pt-24 sm:items-center"
            style={{ WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}
            onClick={() => {
              setViewedReportError('')
              setViewedReport(null)
            }}
          >
            <div
              className="max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-xl sm:max-h-[calc(100vh-3rem)] sm:p-6"
              style={{ WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain', touchAction: 'pan-y' }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#C61F2A]">Report Details</p>
                  <h3 className="mt-1 text-xl font-extrabold text-[#123A7A]">{viewedReport.title || 'Untitled Report'}</h3>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePrintViewedReport}
                    className="rounded border border-[#123A7A] bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
                  >
                    Print Report
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setViewedReportError('')
                      setViewedReport(null)
                    }}
                    className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700"
                  >
                    Close
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-2 text-sm text-slate-700 md:grid-cols-2">
                <p><span className="font-semibold">Date:</span> {viewedReport.report_date || '-'}</p>
                <p><span className="font-semibold">Status:</span> {viewedReport.status || '-'}</p>
                <p>
                  <span className="font-semibold">Equipment:</span>{' '}
                  {viewedReport.equipment_name || '-'}
                  {viewedReport.equipment_id && (
                    <button
                      type="button"
                      onClick={handleGoToReportEquipment}
                      className="ml-2 rounded border border-[#123A7A] bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
                    >
                      Go to equipment
                    </button>
                  )}
                </p>
                <p><span className="font-semibold">Inspector:</span> {viewedReport.submitted_by_name || '-'}</p>
                <p><span className="font-semibold">Report ID:</span> {viewedReport.id}</p>
                <p className="md:col-span-2"><span className="font-semibold">Summary:</span> {viewedReport.summary || '-'}</p>
              </div>

              {(() => {
                const checklistSections = getChecklistSections(viewedReport.checklist_items)
                const checklistImagesByLabel = getChecklistImagesByLabel(viewedReport.images)
                const isNotPresentedReport = isChecklistMarkedNotPresented(checklistSections)

                if (isNotPresentedReport) {
                  return (
                    <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-4">
                      <p className="text-base font-bold uppercase tracking-wide text-rose-800">Not Presented</p>
                    </div>
                  )
                }

                return (
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <p className="text-sm font-semibold text-amber-800">Worn but Servicable</p>
                      {checklistSections.worn.length === 0 ? (
                        <p className="mt-2 text-xs text-amber-700">None reported.</p>
                      ) : (
                        <ul className="mt-2 space-y-2 text-xs text-amber-900">
                          {checklistSections.worn.map((item) => (
                            <li key={`worn-${item.label}`}>
                              <p className="font-semibold">{item.label}</p>
                              <p><span className="font-semibold">Finding:</span> {item.finding || '-'}</p>
                              <p><span className="font-semibold">Recommendation:</span> {item.recommendation || '-'}</p>
                              {(checklistImagesByLabel[item.label] || []).length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {(checklistImagesByLabel[item.label] || []).map((image) => (
                                    <button
                                      key={`worn-item-image-${image.id}`}
                                      type="button"
                                      onClick={() => handleOpenReportImage(image, checklistImagesByLabel[item.label])}
                                      className="overflow-hidden rounded border border-slate-200 bg-white"
                                    >
                                      <img
                                        src={image.image_url}
                                        alt={`${item.label} checklist`}
                                        className="h-12 w-12 object-cover"
                                      />
                                    </button>
                                  ))}
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                      <p className="text-sm font-semibold text-rose-800">Attention Required</p>
                      {checklistSections.attention.length === 0 ? (
                        <p className="mt-2 text-xs text-rose-700">None reported.</p>
                      ) : (
                        <ul className="mt-2 space-y-2 text-xs text-rose-900">
                          {checklistSections.attention.map((item) => (
                            <li key={`attention-${item.label}`}>
                              <p className="font-semibold">{item.label}</p>
                              <p><span className="font-semibold">Finding:</span> {item.finding || '-'}</p>
                              <p><span className="font-semibold">Recommendation:</span> {item.recommendation || '-'}</p>
                              {(checklistImagesByLabel[item.label] || []).length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {(checklistImagesByLabel[item.label] || []).map((image) => (
                                    <button
                                      key={`attention-item-image-${image.id}`}
                                      type="button"
                                      onClick={() => handleOpenReportImage(image, checklistImagesByLabel[item.label])}
                                      className="overflow-hidden rounded border border-slate-200 bg-white"
                                    >
                                      <img
                                        src={image.image_url}
                                        alt={`${item.label} checklist`}
                                        className="h-12 w-12 object-cover"
                                      />
                                    </button>
                                  ))}
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    {checklistSections.notPresented.length > 0 && (
                      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 md:col-span-2">
                        <p className="text-sm font-semibold text-blue-800">Not Presented</p>
                        <ul className="mt-2 space-y-2 text-xs text-blue-900">
                          {checklistSections.notPresented.map((item) => (
                            <li key={`not-presented-${item.label}`}>
                              <p className="font-semibold">{item.label}</p>
                              <p>Not presented for examination.</p>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )
              })()}

              {viewedReportError && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {viewedReportError}
                </div>
              )}

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
                {canDeleteDraftReport(viewedReport) && (
                  <button
                    type="button"
                    onClick={handleDeleteDraftReport}
                    disabled={deletingDraftReport}
                    className="rounded border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-rose-700 transition hover:bg-rose-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {deletingDraftReport
                      ? 'Deleting...'
                      : String(confirmDeleteDraftReportId) === String(viewedReport.id)
                        ? 'Confirm Delete Draft'
                        : 'Delete Draft'}
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
            onClick={() => handleCancelEdit()}
          >
            <div
              className="max-h-[calc(100vh-7rem)] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:max-h-[calc(100vh-3rem)]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-bold text-[#123A7A]">Edit Report</h3>
                <button
                  type="button"
                  onClick={() => handleCancelEdit()}
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
                  <ReportChecklistEditor
                    checklistItems={normalizedReportChecklistItems}
                    onChange={updateReportChecklistItems}
                    onApplyNotPresentedPreset={applyNotPresentedReportPreset}
                    pendingChecklistImagesByLabel={reportForm.checklistImageFilesByLabel}
                    existingChecklistImagesByLabel={existingChecklistImagesByLabel}
                    onAddChecklistItemImages={appendChecklistItemImages}
                    onRemovePendingChecklistItemImage={removePendingChecklistItemImage}
                    onOpenChecklistItemImage={handleOpenReportImage}
                  />
                  <label className="text-sm font-semibold text-slate-700 md:col-span-2">
                    Add Images
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(event) => {
                        appendReportImages(event.target.files)
                        event.target.value = ''
                      }}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    />
                    {reportForm.images.length > 0 && (
                      <>
                        <p className="mt-1 text-xs text-slate-500">
                          {reportForm.images.length} image(s) selected. You can add more by choosing again.
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {reportForm.images.map((file, index) => (
                            <div
                              key={`${file.name}-${file.lastModified}-${index}`}
                              className="inline-flex max-w-full items-center gap-2 rounded-full border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs text-slate-700"
                            >
                              <span className="max-w-48 truncate" title={file.name}>{file.name}</span>
                              <button
                                type="button"
                                onClick={() => removePendingReportImageAt(index)}
                                className="rounded-full border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 transition hover:border-rose-400 hover:text-rose-700"
                                aria-label={`Remove ${file.name}`}
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      </>
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
                              className={`absolute right-2 top-2 rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-wide shadow-sm transition ${
                                String(confirmRemoveReportImageId) === String(image.id)
                                  ? 'bg-rose-600 text-white hover:bg-rose-500'
                                  : 'bg-white/95 text-rose-700 hover:bg-white'
                              }`}
                            >
                              {String(confirmRemoveReportImageId) === String(image.id)
                                ? 'Confirm Remove'
                                : 'Remove'}
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
                {editReportError && (
                  <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {editReportError}
                  </div>
                )}
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

        <Modal
          open={showReportSubmissionConfirmModal}
          onClose={() => {
            if (creatingReport || savingReportEdit) return
            setShowReportSubmissionConfirmModal(false)
          }}
          closeOnBackdrop={false}
          closeOnEscape={false}
          panelClassName="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
        >
          <h3 className="text-lg font-bold text-[#123A7A]">Confirm Report Submission</h3>
          <p className="mt-1 text-sm text-slate-700">
            Before submitting, confirm all statements below are true.
          </p>
          <div className="mt-4 space-y-3">
            {REPORT_SUBMISSION_CONFIRMATION_ITEMS.map((statement, index) => (
              <label
                key={statement}
                className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
              >
                <input
                  type="checkbox"
                  checked={Boolean(reportSubmissionConfirmChecks[index])}
                  onChange={(event) => {
                    const isChecked = Boolean(event.target.checked)
                    setReportSubmissionConfirmChecks((current) => {
                      const next = [...current]
                      next[index] = isChecked
                      return next
                    })
                  }}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#123A7A]"
                />
                <span>{statement}</span>
              </label>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowReportSubmissionConfirmModal(false)}
              disabled={creatingReport || savingReportEdit}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmReportSubmissionChecks}
              disabled={creatingReport || savingReportEdit || !reportSubmissionConfirmChecks.every(Boolean)}
              className="rounded border border-[#123A7A] bg-[#123A7A] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white transition hover:bg-[#0f3168] disabled:cursor-not-allowed disabled:opacity-70"
            >
              Confirm and Submit
            </button>
          </div>
        </Modal>

        <Modal
          open={Boolean(reportUnsavedPrompt)}
          onClose={() => setReportUnsavedPrompt('')}
          closeOnBackdrop={false}
          closeOnEscape={false}
          panelClassName="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
        >
          <h3 className="text-lg font-bold text-[#123A7A]">Save Changes?</h3>
          <p className="text-sm text-slate-700">
            {reportUnsavedPrompt === 'create'
              ? 'You have unsaved changes for this new report. Save as draft or clear changes?'
              : 'You have unsaved edits for this report. Save changes or revert?'}
          </p>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setReportUnsavedPrompt('')}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-700 transition hover:bg-slate-100"
            >
              Continue Editing
            </button>
            <button
              type="button"
              onClick={handleReportUnsavedPromptRevert}
              disabled={creatingReport || savingReportEdit}
              className="rounded border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-rose-700 transition hover:bg-rose-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-70"
            >
              {reportUnsavedPrompt === 'create' ? 'Clear Changes' : 'Revert Changes'}
            </button>
            <button
              type="button"
              onClick={() => void handleReportUnsavedPromptSave()}
              disabled={creatingReport || savingReportEdit}
              className="rounded border border-[#123A7A] bg-[#123A7A] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white transition hover:bg-[#0f3168] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {reportUnsavedPrompt === 'create'
                ? creatingReport
                  ? 'Saving Draft...'
                  : 'Save as Draft'
                : savingReportEdit
                  ? 'Saving...'
                  : 'Save Changes'}
            </button>
          </div>
        </Modal>

        <Modal
          open={Boolean(unsavedChangesPrompt)}
          onClose={() => setUnsavedChangesPrompt('')}
          closeOnBackdrop={false}
          closeOnEscape={false}
          panelClassName="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
        >
          <h3 className="text-lg font-bold text-[#123A7A]">Save Changes?</h3>
          <p className="text-sm text-slate-700">
            You have unsaved changes. Save them or revert to discard the edits.
          </p>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setUnsavedChangesPrompt('')}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-700 transition hover:bg-slate-100"
            >
              Continue Editing
            </button>
            <button
              type="button"
              onClick={handleUnsavedPromptRevert}
              className="rounded border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-rose-700 transition hover:bg-rose-600 hover:text-white"
            >
              Revert Changes
            </button>
            <button
              type="button"
              onClick={handleUnsavedPromptSave}
              className="rounded border border-[#123A7A] bg-[#123A7A] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white transition hover:bg-[#0f3168]"
            >
              Save Changes
            </button>
          </div>
        </Modal>

        <Modal
          open={showGeneratedCertificatePreviewModal}
          onClose={() => {
            if (generatingSiteCertificates) return
            closeGeneratedCertificatePreviewModal()
          }}
          panelClassName="w-full max-w-5xl rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
        >
          <h3 className="text-lg font-bold text-[#123A7A]">Generated Site Certificate</h3>
          <p className="mt-1 text-sm text-slate-600">
            Review the generated certificate below. You can save or print it when ready.
          </p>

          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-2">
            {generatedCertificatePreviewUrl ? (
              <iframe
                title="Generated certificate preview"
                src={generatedCertificatePreviewUrl}
                className="h-[65vh] w-full rounded-md border border-slate-200 bg-white"
              />
            ) : (
              <p className="px-3 py-4 text-sm text-slate-600">Certificate preview is not available.</p>
            )}
          </div>

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={closeGeneratedCertificatePreviewModal}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-700 transition hover:bg-slate-100"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleSaveGeneratedCertificate}
              disabled={!generatedCertificatePreviewUrl}
              className="rounded border border-[#123A7A] bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              Save PDF
            </button>
            <button
              type="button"
              onClick={handlePrintGeneratedCertificate}
              disabled={!generatedCertificatePreviewUrl}
              className="rounded border border-[#123A7A] bg-[#123A7A] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white transition hover:bg-[#0f3168] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Print PDF
            </button>
          </div>
        </Modal>

        <Modal
          open={showEquipmentQrModal}
          onClose={() => {
            if (generatingEquipmentQr) return
            setShowEquipmentQrModal(false)
          }}
          panelClassName="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
        >
          <h3 className="text-lg font-bold text-[#123A7A]">Equipment QR Label</h3>
          <p className="mt-1 text-sm text-slate-600">
            Scan to open this equipment directly in the portal.
          </p>
          {activeSelectedEquipment && (
            <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {activeSelectedEquipment.name} - {activeSelectedEquipment.asset_tag || 'No Asset Tag'}
            </p>
          )}

          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            {generatingEquipmentQr ? (
              <p className="text-sm text-slate-600">Generating QR code...</p>
            ) : equipmentQrError ? (
              <p className="text-sm text-red-700">{equipmentQrError}</p>
            ) : equipmentQrImageDataUrl ? (
              <img src={equipmentQrImageDataUrl} alt="Equipment QR code" className="mx-auto h-56 w-56" />
            ) : (
              <p className="text-sm text-slate-600">QR code not available.</p>
            )}
          </div>

          {equipmentQrLink && (
            <p className="mt-3 break-all text-xs text-slate-500">{equipmentQrLink}</p>
          )}

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowEquipmentQrModal(false)}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-700 transition hover:bg-slate-100"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleDownloadEquipmentQr}
              disabled={!equipmentQrImageDataUrl || generatingEquipmentQr}
              className="rounded border border-[#123A7A] bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              Download PNG
            </button>
            <button
              type="button"
              onClick={handlePrintEquipmentQr}
              disabled={!equipmentQrImageDataUrl || generatingEquipmentQr}
              className="rounded border border-[#123A7A] bg-[#123A7A] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white transition hover:bg-[#0f3168] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Print Label
            </button>
          </div>
        </Modal>

        {showRevisionsModal && (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 pb-6 pt-24 sm:items-center sm:pt-6"
            onClick={() => {
              setShowRevisionsModal(false)
              setRevisionReportId('')
              setReportRevisions([])
              setSelectedRevisionPreview(null)
              setRevisionsError('')
            }}
          >
            <div
              className="max-h-[calc(100vh-7rem)] w-full max-w-4xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:max-h-[calc(100vh-3rem)]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-bold text-[#123A7A]">
                  {selectedRevisionPreview ? 'Revision Details' : 'Revision History'}
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setShowRevisionsModal(false)
                    setRevisionReportId('')
                    setReportRevisions([])
                    setSelectedRevisionPreview(null)
                    setRevisionsError('')
                  }}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700"
                >
                  Close
                </button>
              </div>

              {selectedRevisionPreview ? (
                <div className="mt-3 space-y-4 text-sm text-slate-700">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-slate-800">
                      {selectedRevisionPreview.revision.edited_by_name || 'Unknown user'}
                      {' '}
                      <span className="text-slate-400">-</span>
                      {' '}
                      <span className="font-medium text-slate-600">
                        {formatRevisionDateTime(selectedRevisionPreview.revision.changed_at)}
                      </span>
                    </p>
                    <button
                      type="button"
                      onClick={() => setSelectedRevisionPreview(null)}
                      className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700"
                    >
                      Back to Revisions
                    </button>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-sm font-semibold text-slate-800">Exactly What Changed</p>
                    {selectedRevisionPreview.fieldChanges.length === 0 &&
                    selectedRevisionPreview.checklistChanges.length === 0 ? (
                      <p className="mt-2 text-xs text-slate-600">No field-level differences detected.</p>
                    ) : (
                      <div className="mt-2 space-y-2 text-xs text-slate-700">
                        {selectedRevisionPreview.fieldChanges.map((change) => (
                          <div key={change.key} className="rounded border border-slate-200 bg-white p-2">
                            <p className="font-semibold text-slate-800">{change.label}</p>
                            <p><span className="font-semibold">Before:</span> {change.beforeValue || '-'}</p>
                            <p><span className="font-semibold">After:</span> {change.afterValue || '-'}</p>
                          </div>
                        ))}

                        {selectedRevisionPreview.checklistChanges.length > 0 && (
                          <div className="rounded border border-slate-200 bg-white p-2">
                            <p className="font-semibold text-slate-800">Checklist Changes</p>
                            <ul className="mt-1 space-y-2">
                              {selectedRevisionPreview.checklistChanges.map((change) => (
                                <li key={`check-change-${change.label}`}>
                                  <p className="font-semibold">{change.label}</p>
                                  <p>
                                    <span className="font-semibold">Status:</span>{' '}
                                    {getChecklistStatusLabel(change.beforeStatus)} {'->'} {getChecklistStatusLabel(change.afterStatus)}
                                  </p>
                                  <p><span className="font-semibold">Finding Before:</span> {change.beforeFinding || '-'}</p>
                                  <p><span className="font-semibold">Finding After:</span> {change.afterFinding || '-'}</p>
                                  <p><span className="font-semibold">Recommendation Before:</span> {change.beforeRecommendation || '-'}</p>
                                  <p><span className="font-semibold">Recommendation After:</span> {change.afterRecommendation || '-'}</p>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="text-sm font-semibold text-slate-800">Full Report After This Revision</p>
                    <div className="mt-2 grid gap-2 text-sm text-slate-700 md:grid-cols-2">
                      <p><span className="font-semibold">Title:</span> {selectedRevisionPreview.afterSnapshot.title || '-'}</p>
                      <p><span className="font-semibold">Status:</span> {selectedRevisionPreview.afterSnapshot.status || '-'}</p>
                      <p><span className="font-semibold">Report Date:</span> {selectedRevisionPreview.afterSnapshot.report_date || '-'}</p>
                      <p className="md:col-span-2"><span className="font-semibold">Summary:</span> {selectedRevisionPreview.afterSnapshot.summary || '-'}</p>
                    </div>

                    {(() => {
                      const checklistSections = getChecklistSections(selectedRevisionPreview.afterSnapshot.checklist_items)
                      const isNotPresentedReport = isChecklistMarkedNotPresented(checklistSections)

                      if (isNotPresentedReport) {
                        return (
                          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-4">
                            <p className="text-base font-bold uppercase tracking-wide text-rose-800">Not Presented</p>
                          </div>
                        )
                      }

                      return (
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                            <p className="text-sm font-semibold text-amber-800">Worn but Servicable</p>
                            {checklistSections.worn.length === 0 ? (
                              <p className="mt-2 text-xs text-amber-700">None reported.</p>
                            ) : (
                              <ul className="mt-2 space-y-2 text-xs text-amber-900">
                                {checklistSections.worn.map((item) => (
                                  <li key={`rev-worn-${item.label}`}>
                                    <p className="font-semibold">{item.label}</p>
                                    <p><span className="font-semibold">Finding:</span> {item.finding || '-'}</p>
                                    <p><span className="font-semibold">Recommendation:</span> {item.recommendation || '-'}</p>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                            <p className="text-sm font-semibold text-rose-800">Attention Required</p>
                            {checklistSections.attention.length === 0 ? (
                              <p className="mt-2 text-xs text-rose-700">None reported.</p>
                            ) : (
                              <ul className="mt-2 space-y-2 text-xs text-rose-900">
                                {checklistSections.attention.map((item) => (
                                  <li key={`rev-attention-${item.label}`}>
                                    <p className="font-semibold">{item.label}</p>
                                    <p><span className="font-semibold">Finding:</span> {item.finding || '-'}</p>
                                    <p><span className="font-semibold">Recommendation:</span> {item.recommendation || '-'}</p>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                          {checklistSections.notPresented.length > 0 && (
                            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 md:col-span-2">
                              <p className="text-sm font-semibold text-blue-800">Not Presented</p>
                              <ul className="mt-2 space-y-2 text-xs text-blue-900">
                                {checklistSections.notPresented.map((item) => (
                                  <li key={`rev-not-presented-${item.label}`}>
                                    <p className="font-semibold">{item.label}</p>
                                    <p>Not presented for examination.</p>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                </div>
              ) : revisionsLoading ? (
                <p className="mt-2 text-sm text-slate-500">Loading revisions...</p>
              ) : reportRevisions.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">No revisions recorded yet for this report.</p>
              ) : (
                <ul className="mt-3 space-y-2 text-sm text-slate-700">
                  {reportRevisions.map((revision, index) => (
                    <li key={revision.id} className="rounded border border-slate-200 bg-white p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
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
                        </div>
                        <button
                          type="button"
                          onClick={() => openRevisionPreview(index)}
                          className="rounded border border-[#123A7A] bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
                        >
                          View
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {revisionsError && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {revisionsError}
                </div>
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
              {equipmentStatusError && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {equipmentStatusError}
                </div>
              )}
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
