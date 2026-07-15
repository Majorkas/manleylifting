import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import CustomerListSection from '../components/CustomerListSection'
import EmployeeControlsSection from '../components/EmployeeControlsSection'
import EquipmentTableSection from '../components/EquipmentTableSection'
import Modal from '../components/Modal'
import PaginationControls from '../components/PaginationControls'
import PortalToast from '../components/PortalToast'
import PendingApprovalsSection from '../components/PendingApprovalsSection'
import PortalLayout from '../components/PortalLayout'
import usePageMeta from '../utils/usePageMeta'
import { exportRowsToCsv } from '../utils/csvExport'
import {
  changePortalPassword,
  createStaffAssignment,
  deleteEquipmentCertificate,
  downloadCertificate,
  deleteStaffAssignment,
  reactivateStaffAssignment,
  createPortalCustomer,
  createPortalEquipment,
  clearPortalSession,
  createEquipmentReport,
  deleteReport,
  getEquipmentActivity,
  getEquipmentCertificates,
  getEquipmentReports,
  getPortalCompanies,
  getPortalCompanyHeader,
  getPortalDashboardStats,
  getPortalEquipment,
  getPortalMe,
  getAccessToken,
  getPendingReportApprovals,
  recoverEquipmentCertificate,
  recoverReport,
  getReportRevisions,
  getStaffAssignments,
  hasPortalSession,
  portalLogout,
  refreshPortalSession,
  uploadEquipmentCertificate,
  updatePortalCustomer,
  updateStaffAssignment,
  updateReport,
  updatePortalEquipment,
} from '../utils/portalApi'

const SESSION_WARNING_WINDOW_MS = 2 * 60 * 1000
const SESSION_WARNING_CHECK_INTERVAL_MS = 15 * 1000
const REPORT_DRAFT_STORAGE_KEY = 'manley-portal-report-draft-v1'
const REPORT_CHECKLIST_STATUS_GOOD = 'good_order'
const REPORT_CHECKLIST_STATUS_WORN = 'worn_serviceable'
const REPORT_CHECKLIST_STATUS_ATTENTION = 'attention_required'
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
    note: '',
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
    ].includes(status)
      ? status
      : REPORT_CHECKLIST_STATUS_GOOD

    return {
      label,
      status: normalizedStatus,
      note: String(existing?.note ?? ''),
    }
  })
}

function getChecklistStatusLabel(status) {
  if (status === REPORT_CHECKLIST_STATUS_WORN) return 'Worn but Servicable'
  if (status === REPORT_CHECKLIST_STATUS_ATTENTION) return 'Attention Required'
  return 'Good Order'
}

function getChecklistSections(items) {
  const normalized = normalizeReportChecklistItems(items)
  return {
    worn: normalized.filter((item) => item.status === REPORT_CHECKLIST_STATUS_WORN),
    attention: normalized.filter((item) => item.status === REPORT_CHECKLIST_STATUS_ATTENTION),
  }
}

function getMissingChecklistNoteLabel(items) {
  const normalized = normalizeReportChecklistItems(items)
  const missing = normalized.find(
    (item) =>
      item.status !== REPORT_CHECKLIST_STATUS_GOOD &&
      String(item.note || '').trim() === '',
  )
  return missing?.label || ''
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
        note: '',
      }
      const after = afterByLabel.get(label) || {
        label,
        status: REPORT_CHECKLIST_STATUS_GOOD,
        note: '',
      }

      if (
        String(before.status) === String(after.status) &&
        String(before.note || '') === String(after.note || '')
      ) {
        return null
      }

      return {
        label,
        beforeStatus: before.status,
        afterStatus: after.status,
        beforeNote: String(before.note || ''),
        afterNote: String(after.note || ''),
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

const ReportChecklistEditor = memo(function ReportChecklistEditor({ checklistItems, onChange }) {
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

  function commitNotes() {
    onChange(localItems)
  }

  return (
    <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3 md:col-span-2">
      <div className="mb-3">
        <h4 className="text-sm font-bold text-[#123A7A]">Inspection Template Checklist</h4>
        <p className="mt-1 text-xs text-slate-600">
          Mark each check item. Notes are required for Worn but Servicable and Attention Required.
        </p>
      </div>

      <div className="space-y-3">
        {localItems.map((item, index) => {
          const needsNote = item.status !== REPORT_CHECKLIST_STATUS_GOOD

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
                  </select>
                </label>
              </div>

              {needsNote && (
                <label className="mt-2 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Note (required)
                  <textarea
                    value={item.note}
                    onChange={(event) => updateLocalItem(index, { note: event.target.value })}
                    onBlur={commitNotes}
                    className="mt-1 min-h-16 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                  />
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
    location: '',
    status: 'active',
    inspection_interval_days: 365,
    last_inspected_at: '',
    notes: '',
  }
}

function buildEmptyCertificateForm() {
  return {
    title: '',
    issue_date: '',
    expiry_date: '',
    report_id: '',
    file: null,
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
  const initialSearchQuery = String(searchParams.get('q') || '').trim()
  const initialReportYearFilter = String(searchParams.get('reportYear') || '').trim()
  const initialEquipmentTab = parseEnum(searchParams.get('eqTab'), ['active', 'decommissioned'], 'active')
  const initialInspectionUrgency = parseEnum(
    searchParams.get('eqUrgency'),
    ['all', 'overdue', 'due_soon', 'on_schedule'],
    'all',
  )
  const initialEquipmentPage = parsePositiveInt(searchParams.get('eqPage'), 1)
  const initialCustomerPage = parsePositiveInt(searchParams.get('customersPage'), 1)
  const initialEmployeePage = parsePositiveInt(searchParams.get('employeesPage'), 1)
  const initialPendingApprovalsPage = parsePositiveInt(searchParams.get('pendingApprovalsPage'), 1)
  const isAuthenticated = hasPortalSession()
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState('')
  const [profile, setProfile] = useState(null)
  const [companies, setCompanies] = useState([])
  const [company, setCompany] = useState(null)
  const [equipment, setEquipment] = useState([])
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
  const [reportsLoading, setReportsLoading] = useState(false)
  const [reportError, setReportError] = useState('')
  const [createReportError, setCreateReportError] = useState('')
  const [editReportError, setEditReportError] = useState('')
  const [viewedReportError, setViewedReportError] = useState('')
  const [revisionsError, setRevisionsError] = useState('')
  const [certificates, setCertificates] = useState([])
  const [certificatesLoading, setCertificatesLoading] = useState(false)
  const [certificateError, setCertificateError] = useState('')
  const [equipmentActivity, setEquipmentActivity] = useState([])
  const [equipmentActivityLoading, setEquipmentActivityLoading] = useState(false)
  const [equipmentActivityError, setEquipmentActivityError] = useState('')
  const [equipmentActivityPage, setEquipmentActivityPage] = useState(1)
  const [, setCertificateSuccess] = useState('')
  const [downloadingCertificateId, setDownloadingCertificateId] = useState(0)
  const [deletingCertificateId, setDeletingCertificateId] = useState(0)
  const [recoveringCertificateId, setRecoveringCertificateId] = useState(0)
  const [recoveringReportId, setRecoveringReportId] = useState(0)
  const [confirmDeleteCertificate, setConfirmDeleteCertificate] = useState(null)
  const [showCreateCertificateForm, setShowCreateCertificateForm] = useState(false)
  const [creatingCertificate, setCreatingCertificate] = useState(false)
  const [certificateForm, setCertificateForm] = useState(buildEmptyCertificateForm())
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
  const [equipmentPage, setEquipmentPage] = useState(initialEquipmentPage)
  const [updatingEquipmentStatus, setUpdatingEquipmentStatus] = useState(false)
  const [equipmentStatusError, setEquipmentStatusError] = useState('')
  const [equipmentStatusDraft, setEquipmentStatusDraft] = useState('active')
  const [showDecommissionConfirm, setShowDecommissionConfirm] = useState(false)
  const [equipmentTableTab, setEquipmentTableTab] = useState(initialEquipmentTab)
  const [equipmentSortKey, setEquipmentSortKey] = useState('next_due')
  const [equipmentSortDirection, setEquipmentSortDirection] = useState('asc')
  const [inspectionUrgencyFilter, setInspectionUrgencyFilter] = useState(initialInspectionUrgency)
  const [expandedEquipmentCardId, setExpandedEquipmentCardId] = useState('')
  const [expandedReportCardId, setExpandedReportCardId] = useState('')
  const previousSelectedEquipmentIdRef = useRef('')
  const previousDesktopSelectedEquipmentIdRef = useRef('')
  const hasInitializedCustomerPageResetRef = useRef(false)
  const hasInitializedEmployeePageResetRef = useRef(false)
  const hasInitializedEquipmentPageResetRef = useRef(false)
  const initialCustomerEditFormRef = useRef(buildEmptyCustomerEditForm())
  const initialReportEditFormRef = useRef(buildEmptyReportForm())
  const employeeControlsSectionRef = useRef(null)
  const equipmentDetailsSectionRef = useRef(null)
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
  const showsCustomerPicker = canEditReports && !selectedCompanyId
  const isOwner = profile?.role === 'owner' || profile?.role === 'office_staff'
  const canViewEquipmentActivity = isOwner
  const isStaff = profile?.role === 'staff' || profile?.role === 'engineer'
  const activeSelectedEquipment = useMemo(() => {
    if (!selectedEquipment) return null
    return equipment.find((item) => String(item.id) === String(selectedEquipment.id)) || null
  }, [equipment, selectedEquipment])
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
  const urgencyFilteredEquipment = useMemo(() => {
    if (inspectionUrgencyFilter === 'all') return currentTableEquipment

    return currentTableEquipment.filter((item) => {
      const urgencyLabel = String(getInspectionStatusBadge(item.next_inspection_due).label || '').toLowerCase()
      if (inspectionUrgencyFilter === 'overdue') return urgencyLabel === 'overdue'
      if (inspectionUrgencyFilter === 'due_soon') return urgencyLabel === 'inspection due'
      if (inspectionUrgencyFilter === 'on_schedule') return urgencyLabel === 'on schedule'
      return true
    })
  }, [currentTableEquipment, inspectionUrgencyFilter])

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
      location: item.location,
      status: item.status,
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

    setBulkApprovingReports(true)
    setPendingApprovalsError('')

    try {
      await Promise.all(
        selectedPendingApprovalIds.map((reportId) => updateReport(reportId, { status: 'approved' })),
      )

      setSelectedPendingApprovalIds([])
      await Promise.all([refreshPendingReportApprovals(true), refreshDashboardStats(true)])
      showSuccessToast('Selected submitted reports have been approved.', 'Reports Approved')
    } catch (error) {
      setPendingApprovalsError(String(error?.message || 'Unable to bulk approve reports.'))
    } finally {
      setBulkApprovingReports(false)
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

    setBulkDecommissioningEquipment(true)
    setEquipmentStatusError('')

    try {
      await Promise.all(
        selectedEquipmentIds.map((equipmentId) => updatePortalEquipment(equipmentId, { status: 'decommissioned' })),
      )

      setSelectedEquipmentIds([])
      await Promise.all([refreshEquipmentData(), refreshDashboardStats(true)])
      showSuccessToast('Selected equipment has been decommissioned.', 'Equipment Updated')
    } catch (error) {
      setEquipmentStatusError(String(error?.message || 'Unable to decommission selected equipment.'))
    } finally {
      setBulkDecommissioningEquipment(false)
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
    const wornItemsHtml =
      checklistSections.worn.length === 0
        ? '<p class="muted">None reported.</p>'
        : `<ul>${checklistSections.worn
            .map((item) => `<li><strong>${escapeHtml(item.label)}</strong>: ${escapeHtml(item.note || '-')}</li>`)
            .join('')}</ul>`
    const attentionItemsHtml =
      checklistSections.attention.length === 0
        ? '<p class="muted">None reported.</p>'
        : `<ul>${checklistSections.attention
            .map((item) => `<li><strong>${escapeHtml(item.label)}</strong>: ${escapeHtml(item.note || '-')}</li>`)
            .join('')}</ul>`

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
      <div class="section">
        <h2>Findings</h2>
        <p>${escapeHtml(viewedReport.findings || '-')}</p>
      </div>
      <div class="section">
        <h2>Recommendations</h2>
        <p>${escapeHtml(viewedReport.recommendations || '-')}</p>
      </div>
      <div class="section">
        <h2>Worn but Servicable</h2>
        <div class="card">${wornItemsHtml}</div>
      </div>
      <div class="section">
        <h2>Attention Required</h2>
        <div class="card">${attentionItemsHtml}</div>
      </div>
    `

    const printWindow = window.open('', '_blank', 'width=980,height=760')
    if (!printWindow) return
    printWindow.document.open()
    printWindow.document.write(buildPrintDocument(`Report - ${viewedReport.title || 'Inspection Report'}`, reportHtml))
    printWindow.document.close()
  }

  function handlePrintCertificates() {
    if (!activeSelectedEquipment) return

    const certificatesRowsHtml = certificates.length
      ? certificates
          .map(
            (certificate) => `
              <tr>
                <td>${escapeHtml(certificate.title || `Certificate ${certificate.id}`)}</td>
                <td>${escapeHtml(certificate.issue_date || '-')}</td>
                <td>${escapeHtml(certificate.expiry_date || '-')}</td>
                <td>${escapeHtml(certificate.created_at ? String(certificate.created_at).slice(0, 10) : '-')}</td>
              </tr>
            `,
          )
          .join('')
      : '<tr><td colspan="4">No certificates uploaded for this equipment.</td></tr>'

    const certificatesHtml = `
      <h1>Certificate Register</h1>
      <div class="meta">
        <p><strong>Equipment:</strong> ${escapeHtml(activeSelectedEquipment.name || '-')}</p>
        <p><strong>Asset Tag:</strong> ${escapeHtml(activeSelectedEquipment.asset_tag || '-')}</p>
        <p><strong>Serial Number:</strong> ${escapeHtml(activeSelectedEquipment.serial_number || '-')}</p>
      </div>
      <div class="section">
        <h2>Certificates</h2>
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Issue Date</th>
              <th>Expiry Date</th>
              <th>Uploaded</th>
            </tr>
          </thead>
          <tbody>
            ${certificatesRowsHtml}
          </tbody>
        </table>
      </div>
    `

    const printWindow = window.open('', '_blank', 'width=980,height=760')
    if (!printWindow) return
    printWindow.document.open()
    printWindow.document.write(buildPrintDocument(`Certificates - ${activeSelectedEquipment.name || 'Equipment'}`, certificatesHtml))
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
  const isEditingReport = Boolean(reportForm.reportId)
  const isAnyModalOpen = Boolean(
    viewedReport ||
      showEditReportModal ||
      showRevisionsModal ||
      showCreateCertificateForm ||
      confirmDeleteCertificate ||
      showCreateReportForm ||
      showCreateCustomerForm ||
      showEditCustomerForm ||
      showCreateEmployeeForm ||
      companyPickerUserId ||
        showChangePasswordModal ||
      showCreateEquipmentForm ||
      showDecommissionConfirm ||
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
        (item) => item.status !== REPORT_CHECKLIST_STATUS_GOOD || String(item.note || '').trim() !== '',
      ) ||
      (reportForm.images || []).length > 0,
    [reportForm, createReportBaseDate],
  )
  const isCreateCertificateDirty = useMemo(
    () =>
      String(certificateForm.title || '').trim() !== '' ||
      String(certificateForm.issue_date || '').trim() !== '' ||
      String(certificateForm.expiry_date || '').trim() !== '' ||
      String(certificateForm.report_id || '').trim() !== '' ||
      Boolean(certificateForm.file),
    [certificateForm],
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

    setCreatingReport(true)
    setCreateReportError('')
    try {
      await createEquipmentReport(activeSelectedEquipment.id, {
        ...reportForm,
        checklist_items: normalizedChecklistItems,
        status: 'draft',
      })
      const refreshed = await getEquipmentReports(activeSelectedEquipment.id)
      setReports(refreshed)
      await refreshEquipmentData()
      showSuccessToast('Report draft saved.', 'Draft Saved')
      setReportUnsavedPrompt('')
      await closeCreateReportForm(true)
      return true
    } catch (error) {
      setCreateReportError(String(error?.message || 'Unable to save report draft.'))
      return false
    } finally {
      setCreatingReport(false)
    }
  }

  function closeCreateCertificateForm(force = false) {
    if (!force && isCreateCertificateDirty) {
      setUnsavedChangesPrompt('createCertificate')
      return false
    }
    setShowCreateCertificateForm(false)
    setCertificateForm(buildEmptyCertificateForm())
    return true
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

    if (unsavedChangesPrompt === 'createCertificate') {
      clearPromptAndRun(() => closeCreateCertificateForm(true))
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

    if (unsavedChangesPrompt === 'createCertificate') {
      clearPromptAndRun(() => {
        setShowCreateCertificateForm(false)
        setCertificateForm(buildEmptyCertificateForm())
      })
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
        images: [],
        existingImages: [],
        removedImageIds: [],
      })
      showSuccessToast('Restored your saved report draft.', 'Draft Restored')
    } else {
      setReportForm(baseReportForm)
    }

    setCreateReportError('')
    setShowCreateReportForm(true)
  }

  function openCreateCertificateFormModal() {
    setCertificateError('')
    setCertificateSuccess('')
    setCertificateForm(buildEmptyCertificateForm())
    setShowCreateCertificateForm(true)
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

    function handleGlobalShortcuts(event) {
      if (!event.altKey || isAnyModalOpen || isKeyboardEditableTarget(event.target)) return

      const key = String(event.key || '').toLowerCase()
      if (key === 'n' && canEditReports && activeSelectedEquipment?.id) {
        event.preventDefault()
        openCreateReportForm()
        return
      }

      if (key === 'u' && canEditReports && activeSelectedEquipment?.id) {
        event.preventDefault()
        openCreateCertificateFormModal()
        return
      }

      if (key === 'e' && activeSelectedEquipment?.id) {
        event.preventDefault()
        handleExportReportsCsv()
      }
    }

    window.addEventListener('keydown', handleGlobalShortcuts)
    return () => window.removeEventListener('keydown', handleGlobalShortcuts)
  }, [
    isAnyModalOpen,
    canEditReports,
    activeSelectedEquipment?.id,
    openCreateReportForm,
    openCreateCertificateFormModal,
    handleExportReportsCsv,
  ])

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 60000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
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
      showChangePasswordModal ||
      showCreateCertificateForm
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
    showCreateCertificateForm,
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
    const nextParams = new URLSearchParams()

    if (selectedCompanyId) nextParams.set('companyId', selectedCompanyId)

    if (searchQuery) nextParams.set('q', searchQuery)

    if (reportYearFilter) nextParams.set('reportYear', reportYearFilter)

    if (equipmentTableTab !== 'active') nextParams.set('eqTab', equipmentTableTab)

    if (inspectionUrgencyFilter !== 'all') nextParams.set('eqUrgency', inspectionUrgencyFilter)

    if (equipmentPage > 1) nextParams.set('eqPage', String(equipmentPage))

    if (customerPage > 1) nextParams.set('customersPage', String(customerPage))

    if (employeePage > 1) nextParams.set('employeesPage', String(employeePage))

    if (buildStableQueryString(nextParams) !== buildStableQueryString(searchParams)) {
      setSearchParams(nextParams, { replace: true })
    }
  }, [
    customerPage,
    employeePage,
    equipmentPage,
    equipmentTableTab,
    inspectionUrgencyFilter,
    reportYearFilter,
    selectedCompanyId,
    searchParams,
    searchQuery,
    setSearchParams,
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
  }, [equipmentSortKey, equipmentSortDirection, inspectionUrgencyFilter])

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
      setShowCreateCertificateForm(false)
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
      showCreateCertificateForm ||
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

      if (showCreateCertificateForm) {
        closeCreateCertificateForm()
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
    showCreateCertificateForm,
    showCreateCustomerForm,
    showEditCustomerForm,
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
    if (!isAuthenticated) return
    if (!force && !['owner', 'office_staff'].includes(profile?.role)) return

    setDashboardStatsLoading(true)
    setDashboardStatsError('')

    try {
      const nextStats = await getPortalDashboardStats()
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
    if (!isAuthenticated) return
    if (!force && !['owner', 'office_staff'].includes(profile?.role)) return

    setStaffAssignmentsLoading(true)
    setStaffAssignmentsError('')
    try {
      const [activeAssignments, inactiveAssignments] = await Promise.all([
        getStaffAssignments({ status: 'active' }),
        getStaffAssignments({ status: 'inactive' }),
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
      const nextCompanies = await getPortalCompanies()
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
      const refreshedEquipment = await getPortalEquipment({
        companyId: companyIdForRefresh,
        search: searchQuery,
      })
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

    setApprovingReport(true)
    setViewedReportError('')

    const previousReports = reports
    const previousViewedReport = viewedReport
    const previousPendingApprovals = pendingReportApprovals
    const previousDashboardStats = dashboardStats
    const wasSubmitted = String(viewedReport.status || '').toLowerCase() === 'submitted'

    if (wasSubmitted) {
      const optimisticReport = { ...viewedReport, status: 'approved' }
      setReports((current) =>
        current.map((report) => (String(report.id) === String(optimisticReport.id) ? optimisticReport : report)),
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

    try {
      const updatedReport = await updateReport(viewedReport.id, { status: 'approved' })
      const refreshedReports = reports.map((report) =>
        String(report.id) === String(updatedReport.id) ? updatedReport : report,
      )
      setReports(refreshedReports)
      setViewedReport(updatedReport)

      if (!selectedCompanyId) {
        await Promise.all([
          refreshPendingReportApprovals().catch(() => {}),
          refreshDashboardStats().catch(() => {}),
        ])
      }

      try {
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
      } catch {
        // Keep the optimistic/final report status update even if equipment refresh fails.
      }
    } catch (error) {
      if (wasSubmitted) {
        setReports(previousReports)
        setViewedReport(previousViewedReport)
        setPendingReportApprovals(previousPendingApprovals)
        setDashboardStats(previousDashboardStats)
      }
      setViewedReportError(String(error?.message || 'Unable to approve report.'))
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

    async function loadEquipmentActivity() {
      if (!activeSelectedEquipment?.id || !canViewEquipmentActivity) {
        setEquipmentActivity([])
        setEquipmentActivityError('')
        setEquipmentActivityLoading(false)
        return
      }

      setEquipmentActivityLoading(true)
      setEquipmentActivityError('')
      try {
        const nextActivity = await getEquipmentActivity(activeSelectedEquipment.id)
        if (cancelled) return
        setEquipmentActivity(nextActivity)
      } catch (error) {
        if (cancelled) return
        setEquipmentActivityError(String(error?.message || 'Unable to load equipment activity.'))
      } finally {
        if (!cancelled) setEquipmentActivityLoading(false)
      }
    }

    loadEquipmentActivity()
    return () => {
      cancelled = true
    }
  }, [activeSelectedEquipment?.id, canViewEquipmentActivity])

  useEffect(() => {
    let cancelled = false

    async function loadCertificates() {
      if (!activeSelectedEquipment?.id) return

      setCertificatesLoading(true)
      setCertificateError('')
      setCertificateSuccess('')
      try {
        const nextCertificates = await getEquipmentCertificates(activeSelectedEquipment.id)
        if (cancelled) return
        setCertificates(nextCertificates)
      } catch (error) {
        if (cancelled) return
        setCertificateError(String(error?.message || 'Unable to load certificates for this equipment.'))
      } finally {
        if (!cancelled) setCertificatesLoading(false)
      }
    }

    loadCertificates()
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

        if (isOwnerUser) {
          await Promise.all([
            refreshStaffAssignments(true),
            refreshPendingReportApprovals(true),
            refreshDashboardStats(true),
          ])
        } else {
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
    if (!isEditingReport) {
      const missingChecklistNoteLabel = getMissingChecklistNoteLabel(normalizedChecklistItems)
      if (missingChecklistNoteLabel) {
        const message = `Add a note for '${missingChecklistNoteLabel}' before saving this report.`
        setCreateReportError(message)
        return
      }
    }

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
      setEditReportError('')
      try {
        const updatedReport = await updateReport(reportForm.reportId, {
          title: reportForm.title,
          summary: reportForm.summary,
          findings: reportForm.findings,
          recommendations: reportForm.recommendations,
          checklist_items: normalizedChecklistItems,
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
          await Promise.all([refreshPendingReportApprovals(), refreshDashboardStats()])
        }
        await refreshEquipmentList()
        clearReportDraft()
        setReportForm(buildEmptyReportForm())
        setShowEditReportModal(false)
        setReportUnsavedPrompt('')
      } catch (error) {
        setEditReportError(String(error?.message || 'Unable to save report changes.'))
      } finally {
        setSavingReportEdit(false)
      }
      return
    }

    if (!activeSelectedEquipment?.id) return

    setCreatingReport(true)
    setCreateReportError('')
    try {
      await createEquipmentReport(activeSelectedEquipment.id, {
        ...reportForm,
        checklist_items: normalizedChecklistItems,
        status: 'submitted',
      })
      const refreshed = await getEquipmentReports(activeSelectedEquipment.id)
      setReports(refreshed)
      await refreshEquipmentList()
      clearReportDraft()
      setReportForm(buildEmptyReportForm())
      setShowCreateReportForm(false)
      setReportUnsavedPrompt('')
    } catch (error) {
      setCreateReportError(String(error?.message || 'Unable to create report.'))
    } finally {
      setCreatingReport(false)
    }
  }

  async function handleCreateCertificate(event) {
    event.preventDefault()
    if (!activeSelectedEquipment?.id || creatingCertificate) return

    setCreatingCertificate(true)
    setCertificateError('')
    setCertificateSuccess('')
    try {
      await uploadEquipmentCertificate(activeSelectedEquipment.id, {
        ...certificateForm,
        report_id: certificateForm.report_id || null,
      })
      const refreshed = await getEquipmentCertificates(activeSelectedEquipment.id)
      setCertificates(refreshed)
      setCertificateSuccess('Certificate uploaded successfully.')
      showSuccessToast('Certificate uploaded successfully.', 'Certificate Uploaded')
      setCertificateForm(buildEmptyCertificateForm())
      setShowCreateCertificateForm(false)
    } catch (error) {
      setCertificateError(String(error?.message || 'Unable to upload certificate.'))
    } finally {
      setCreatingCertificate(false)
    }
  }

  async function handleDownloadCertificate(certificate) {
    if (!certificate?.id || downloadingCertificateId) return

    setDownloadingCertificateId(Number(certificate.id))
    setCertificateError('')
    try {
      const blob = await downloadCertificate(certificate.id)
      const extensionFromUrl = String(certificate.file || '').split('.').pop()
      const hasExtension = /\.[a-z0-9]+$/i.test(String(certificate.title || ''))
      const filename = hasExtension
        ? String(certificate.title || `certificate-${certificate.id}`)
        : `${String(certificate.title || `certificate-${certificate.id}`)}${
            extensionFromUrl ? `.${extensionFromUrl}` : '.pdf'
          }`

      const objectUrl = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.URL.revokeObjectURL(objectUrl)
    } catch (error) {
      setCertificateError(String(error?.message || 'Unable to download certificate.'))
    } finally {
      setDownloadingCertificateId(0)
    }
  }

  async function handleDeleteCertificate(certificate) {
    if (!isOwner || !certificate?.id || deletingCertificateId || recoveringCertificateId || recoveringReportId) return

    setConfirmDeleteCertificate({
      id: Number(certificate.id),
      title: String(certificate.title || `Certificate #${certificate.id}`),
    })
  }

  async function confirmDeleteCertificateAction() {
    if (!confirmDeleteCertificate?.id || deletingCertificateId || recoveringCertificateId || recoveringReportId) return

    const certificateId = Number(confirmDeleteCertificate.id)

    setDeletingCertificateId(certificateId)
    setCertificateError('')
    setCertificateSuccess('')
    try {
      await deleteEquipmentCertificate(certificateId)
      if (activeSelectedEquipment?.id) {
        const [nextCertificates, nextActivity] = await Promise.all([
          getEquipmentCertificates(activeSelectedEquipment.id),
          canViewEquipmentActivity ? getEquipmentActivity(activeSelectedEquipment.id) : Promise.resolve([]),
        ])
        setCertificates(nextCertificates)
        if (canViewEquipmentActivity) {
          setEquipmentActivity(nextActivity)
        }
      }
      setCertificateSuccess('Certificate deleted. It can be recovered for 3 days from Equipment Activity.')
      showSuccessToast('Certificate deleted. Recovery is available for 3 days.', 'Certificate Deleted')
      setConfirmDeleteCertificate(null)
    } catch (error) {
      setCertificateError(String(error?.message || 'Unable to delete certificate.'))
    } finally {
      setDeletingCertificateId(0)
    }
  }

  async function handleRecoverActivityFromEntry(entry) {
    if (!isOwner || deletingCertificateId || deletingDraftReport || recoveringCertificateId || recoveringReportId) return

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

      if (activeSelectedEquipment?.id) {
        const [nextReports, nextCertificates, nextActivity] = await Promise.all([
          getEquipmentReports(activeSelectedEquipment.id),
          getEquipmentCertificates(activeSelectedEquipment.id),
          canViewEquipmentActivity ? getEquipmentActivity(activeSelectedEquipment.id) : Promise.resolve([]),
        ])
        setReports(nextReports)
        setCertificates(nextCertificates)
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

    setCreatingCustomer(true)
    setCustomerCreateError('')
    setCustomerCreateSuccess('')
    try {
      const created = await createPortalCustomer(customerForm)
      const refreshedCompanies = await getPortalCompanies()
      setCompanies(refreshedCompanies)
      setCustomersLastUpdatedAt(Date.now())
      setCustomerForm(buildEmptyCustomerForm())
      setShowCreateCustomerForm(false)
      setCustomerCreateSuccess(
        `Created customer ${created.customer.username} for ${created.company.name}.`,
      )
      showSuccessToast(
        `Created customer ${created.customer.username} for ${created.company.name}.`,
        'Customer Created',
      )
    } catch (error) {
      setCustomerCreateError(String(error?.message || 'Unable to create customer account.'))
    } finally {
      setCreatingCustomer(false)
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

    setEditingCustomer(true)
    setCustomerEditError('')
    setCustomerEditSuccess('')

    try {
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

      const updated = await updatePortalCustomer(payload)
      const refreshedCompanies = await getPortalCompanies()
      setCompanies(refreshedCompanies)
      setCustomersLastUpdatedAt(Date.now())
      setShowEditCustomerForm(false)
      setConfirmCustomerDeactivate(false)
      setCustomerEditForm(buildEmptyCustomerEditForm())
      const nextCustomerMessage = customerEditForm.deactivate_customer
        ? `Deactivated customer ${updated.name}.`
        : `Updated customer ${updated.name}.`
      setCustomerEditSuccess(nextCustomerMessage)
      showSuccessToast(
        nextCustomerMessage,
        customerEditForm.deactivate_customer ? 'Customer Deactivated' : 'Customer Updated',
      )
    } catch (error) {
      setCustomerEditError(String(error?.message || 'Unable to update customer.'))
    } finally {
      setEditingCustomer(false)
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
      showSuccessToast(`Created employee ${created.username}.`, 'Employee Created')
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
      showSuccessToast(`Updated permissions for ${assignment.username}.`, 'Permissions Updated')
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
    try {
      await updateStaffAssignment({
        user_id: assignment.user_id,
        role: nextRole,
        allowed_company_ids: assignment.allowed_company_ids || [],
      })
      setStaffAssignmentsSuccess(`Updated employee type for ${assignment.username}.`)
      showSuccessToast(`Updated employee type for ${assignment.username}.`, 'Employee Updated')
      await refreshStaffAssignments(true)
    } catch (error) {
      setActiveStaffAssignments((current) =>
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
      setStaffAssignmentsSuccess(`Deactivated employee ${assignment.username}.`)
      showSuccessToast(`Deactivated employee ${assignment.username}.`, 'Employee Deactivated')
      await refreshStaffAssignments(true)
    } catch (error) {
      setStaffAssignmentsError(String(error?.message || 'Unable to remove employee account.'))
    } finally {
      setRemovingStaffUserId(0)
    }
  }

  async function handleReactivateEmployeeAssignment(assignment) {
    if (!assignment?.user_id || reactivatingStaffUserId) return

    setReactivatingStaffUserId(Number(assignment.user_id))
    setStaffAssignmentsError('')
    setStaffAssignmentsSuccess('')
    try {
      await reactivateStaffAssignment(assignment.user_id)
      setStaffAssignmentsSuccess(`Reactivated employee ${assignment.username}.`)
      showSuccessToast(`Reactivated employee ${assignment.username}.`, 'Employee Reactivated')
      await refreshStaffAssignments(true)
    } catch (error) {
      setStaffAssignmentsError(String(error?.message || 'Unable to reactivate employee account.'))
    } finally {
      setReactivatingStaffUserId(0)
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
      setEquipmentLastUpdatedAt(Date.now())
      setEquipmentPage(1)
      setEquipmentForm(buildEmptyEquipmentForm())
      setShowCreateEquipmentForm(false)
      setEquipmentCreateSuccess(`Created equipment ${created.name}.`)
      showSuccessToast(`Created equipment ${created.name}.`, 'Equipment Created')
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
    const previousEquipment = equipment
    const previousSelectedEquipment = selectedEquipment

    const optimisticEquipment = equipment.map((item) =>
      String(item.id) === String(targetEquipmentId)
        ? {
            ...item,
            status: newStatus,
          }
        : item,
    )

    setUpdatingEquipmentStatus(true)
    setEquipmentStatusError('')
    setEquipment(optimisticEquipment)
    setEquipmentLastUpdatedAt(Date.now())
    if (selectedEquipmentIdToMaintain && String(selectedEquipmentIdToMaintain) === String(targetEquipmentId)) {
      setSelectedEquipment((current) =>
        current
          ? {
              ...current,
              status: newStatus,
            }
          : current,
      )
    }

    try {
      await updatePortalEquipment(targetEquipmentId, { status: newStatus })
      const refreshedEquipment = await getPortalEquipment({
        companyId: companyIdForRefresh,
        search: searchQuery,
      })
      setEquipment(refreshedEquipment)
      setEquipmentLastUpdatedAt(Date.now())
      if (selectedEquipmentIdToMaintain) {
        const nextSelectedEquipment = refreshedEquipment.find(
          (item) => String(item.id) === String(selectedEquipmentIdToMaintain),
        )
        setSelectedEquipment(nextSelectedEquipment || null)
      }
      setEquipmentPage(1)
      return true
    } catch (error) {
      setEquipment(previousEquipment)
      if (selectedEquipmentIdToMaintain) {
        setSelectedEquipment(previousSelectedEquipment)
      }
      setEquipmentStatusError(String(error?.message || 'Unable to update equipment status.'))
      return false
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
      if (activeSelectedEquipment?.id) {
        const [refreshed, nextActivity] = await Promise.all([
          getEquipmentReports(activeSelectedEquipment.id),
          canViewEquipmentActivity ? getEquipmentActivity(activeSelectedEquipment.id) : Promise.resolve([]),
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

  function updateReportChecklistItems(nextChecklistItems) {
    setReportForm((current) => ({
      ...current,
      checklist_items: normalizeReportChecklistItems(nextChecklistItems),
    }))
  }

  function handleCloseEquipmentDetails() {
    setSelectedEquipment(null)
    setReports([])
    setCertificates([])
    setEquipmentActivity([])
    setViewedReport(null)
    setSelectedReportImage(null)
    setReportForm(buildEmptyReportForm())
    setCertificateForm(buildEmptyCertificateForm())
    setShowCreateReportForm(false)
    setShowCreateCertificateForm(false)
    setConfirmDeleteCertificate(null)
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
      <Modal
        open={Boolean(confirmDeleteCertificate)}
        onClose={() => {
          if (deletingCertificateId) return
          setConfirmDeleteCertificate(null)
        }}
        panelClassName="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
      >
        <div onClick={(event) => event.stopPropagation()}>
          <h3 className="text-lg font-bold text-[#123A7A]">Delete Certificate?</h3>
          <p className="mt-2 text-sm text-slate-600">
            Delete{' '}
            <span className="font-semibold text-slate-800">
              {confirmDeleteCertificate?.title || 'this certificate'}
            </span>
            ? You can recover it from Equipment Activity for 3 days.
          </p>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmDeleteCertificate(null)}
              disabled={Boolean(deletingCertificateId)}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-[#123A7A] hover:text-[#123A7A] disabled:opacity-70"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDeleteCertificateAction}
              disabled={Boolean(deletingCertificateId)}
              className="rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-600 hover:text-white disabled:opacity-70"
            >
              {deletingCertificateId ? 'Deleting...' : 'Delete Certificate'}
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
            onOpenCustomer={(companyId) => setSearchParams({ companyId: String(companyId) })}
            onEditCustomer={handleStartEditCustomer}
          />
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
            onRefresh={refreshPendingReportApprovals}
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
          <EquipmentTableSection
            canEditReports={canEditReports}
            searchInput={searchInput}
            onSearchInputChange={setSearchInput}
            onSearchSubmit={() => setSearchQuery(searchInput.trim())}
            lastUpdatedLabel={equipmentLastUpdatedLabel}
            onOpenCreateEquipment={() => {
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
              setSelectedEquipment(item)
              setReportForm(buildEmptyReportForm())
              setShowCreateReportForm(false)
              setRevisionReportId('')
              setReportRevisions([])
            }}
            onCloseEquipmentDetails={handleCloseEquipmentDetails}
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
            onOpenUploadCertificate={() => {
              openCreateCertificateFormModal()
            }}
            onOpenCreateReport={() => {
              openCreateReportForm()
            }}
            certificatesLoading={certificatesLoading}
            certificates={certificates}
            onDownloadCertificate={handleDownloadCertificate}
            downloadingCertificateId={downloadingCertificateId}
            deletingCertificateId={deletingCertificateId}
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
              <button
                type="button"
                onClick={handleCloseEquipmentDetails}
                aria-label="Close equipment details panel"
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
                <button
                  type="button"
                  onClick={openCreateCertificateFormModal}
                  className="rounded-md border border-emerald-600 bg-white px-3 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-600 hover:text-white"
                >
                  Upload Certificate
                </button>
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
              <span className="font-semibold">Alt+U</span> upload certificate,{' '}
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
                        <tr>
                          <td className="px-4 py-4 text-slate-500" colSpan={5}>
                            Loading activity log...
                          </td>
                        </tr>
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
                                        disabled={isRecovering || deletingCertificateId > 0 || deletingDraftReport}
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
                    <div className="rounded-lg bg-slate-100 px-4 py-6 text-center text-sm text-slate-500">
                      Loading activity log...
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
                                  disabled={isRecovering || deletingCertificateId > 0 || deletingDraftReport}
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
              <div className="flex items-center justify-between gap-3 bg-slate-50 px-4 py-3">
                <h3 className="text-sm font-semibold text-slate-700">Certificates</h3>
                <button
                  type="button"
                  onClick={handlePrintCertificates}
                  className="rounded-md border border-[#123A7A] bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
                >
                  Print Certificates
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[780px] border-collapse text-left text-sm">
                  <thead className="bg-[#123A7A] text-white">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Title</th>
                      <th className="px-4 py-3 font-semibold">Issue Date</th>
                      <th className="px-4 py-3 font-semibold">Expiry Date</th>
                      <th className="px-4 py-3 font-semibold">Uploaded</th>
                      <th className="px-4 py-3 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {certificatesLoading ? (
                      <tr>
                        <td className="px-4 py-4 text-slate-500" colSpan={5}>
                          Loading certificates...
                        </td>
                      </tr>
                    ) : certificates.length === 0 ? (
                      <tr>
                        <td className="px-4 py-4 text-slate-500" colSpan={5}>
                          No certificates uploaded for this equipment.
                        </td>
                      </tr>
                    ) : (
                      certificates.map((certificate) => (
                        <tr key={certificate.id} className="border-t border-slate-200 odd:bg-white even:bg-slate-50/60">
                          <td className="px-4 py-3 font-semibold text-slate-800">{certificate.title || `Certificate ${certificate.id}`}</td>
                          <td className="px-4 py-3 text-slate-700">{certificate.issue_date || '-'}</td>
                          <td className="px-4 py-3 text-slate-700">{certificate.expiry_date || '-'}</td>
                          <td className="px-4 py-3 text-slate-700">{certificate.created_at ? String(certificate.created_at).slice(0, 10) : '-'}</td>
                          <td className="px-4 py-3 text-slate-700">
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleDownloadCertificate(certificate)}
                                aria-label={`Download certificate ${certificate.title || certificate.id}`}
                                disabled={downloadingCertificateId === Number(certificate.id) || deletingCertificateId === Number(certificate.id)}
                                className="rounded border border-[#123A7A] px-2 py-1 text-xs font-semibold text-[#123A7A] disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {downloadingCertificateId === Number(certificate.id) ? 'Downloading...' : 'Download'}
                              </button>
                              {isOwner && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteCertificate(certificate)}
                                  aria-label={`Delete certificate ${certificate.title || certificate.id}`}
                                  disabled={deletingCertificateId === Number(certificate.id) || downloadingCertificateId > 0}
                                  className="rounded border border-red-300 px-2 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {deletingCertificateId === Number(certificate.id) ? 'Deleting...' : 'Delete'}
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


            <div className="mt-6 overflow-hidden rounded-xl border border-slate-200">
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
                  <p className="text-sm text-slate-500">Loading reports...</p>
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
                      <tr>
                        <td className="px-4 py-4 text-slate-500" colSpan={6}>
                          Loading reports...
                        </td>
                      </tr>
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
                <ReportChecklistEditor
                  checklistItems={normalizedReportChecklistItems}
                  onChange={updateReportChecklistItems}
                />
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

        {canEditReports && showCreateCertificateForm && activeSelectedEquipment && (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 pb-6 pt-24 sm:items-center sm:pt-6"
            onClick={() => closeCreateCertificateForm()}
          >
            <form
              className="max-h-[calc(100vh-7rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:max-h-[calc(100vh-3rem)]"
              onSubmit={handleCreateCertificate}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold text-[#123A7A]">Upload Certificate</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    Add a certificate for {activeSelectedEquipment.name || 'this equipment'}.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => closeCreateCertificateForm()}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700"
                >
                  Close
                </button>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="text-sm font-semibold text-slate-700 md:col-span-2">
                  Certificate Title
                  <input
                    type="text"
                    value={certificateForm.title}
                    onChange={(event) =>
                      setCertificateForm((current) => ({ ...current, title: event.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    required
                  />
                </label>

                <label className="text-sm font-semibold text-slate-700">
                  Issue Date
                  <input
                    type="date"
                    value={certificateForm.issue_date}
                    onChange={(event) =>
                      setCertificateForm((current) => ({ ...current, issue_date: event.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>

                <label className="text-sm font-semibold text-slate-700">
                  Expiry Date
                  <input
                    type="date"
                    value={certificateForm.expiry_date}
                    onChange={(event) =>
                      setCertificateForm((current) => ({ ...current, expiry_date: event.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>

                <label className="text-sm font-semibold text-slate-700 md:col-span-2">
                  Link to Report (optional)
                  <select
                    value={certificateForm.report_id}
                    onChange={(event) =>
                      setCertificateForm((current) => ({ ...current, report_id: event.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="">No linked report</option>
                    {reports.map((report) => (
                      <option key={report.id} value={String(report.id)}>
                        {report.title || `Report ${report.id}`} ({report.report_date || '-'})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-sm font-semibold text-slate-700 md:col-span-2">
                  Certificate File (PDF, PNG, JPG, JPEG, max 10MB)
                  <input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    onChange={(event) =>
                      setCertificateForm((current) => ({
                        ...current,
                        file: event.target.files?.[0] || null,
                      }))
                    }
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    required
                  />
                  {certificateForm.file && (
                    <p className="mt-1 text-xs text-slate-500">Selected: {certificateForm.file.name}</p>
                  )}
                </label>
              </div>

              {certificateError && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {certificateError}
                </div>
              )}

              <button
                type="submit"
                disabled={creatingCertificate}
                className="mt-4 rounded-md bg-[#123A7A] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f3168] disabled:opacity-70"
              >
                {creatingCertificate ? 'Uploading...' : 'Upload Certificate'}
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
                <p className="md:col-span-2"><span className="font-semibold">Findings:</span> {viewedReport.findings || '-'}</p>
                <p className="md:col-span-2"><span className="font-semibold">Recommendations:</span> {viewedReport.recommendations || '-'}</p>
              </div>

              {(() => {
                const checklistSections = getChecklistSections(viewedReport.checklist_items)
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
                              <p>{item.note || '-'}</p>
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
                              <p>{item.note || '-'}</p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
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
                  <ReportChecklistEditor
                    checklistItems={normalizedReportChecklistItems}
                    onChange={updateReportChecklistItems}
                  />
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
                                  <p><span className="font-semibold">Note Before:</span> {change.beforeNote || '-'}</p>
                                  <p><span className="font-semibold">Note After:</span> {change.afterNote || '-'}</p>
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
                      <p className="md:col-span-2"><span className="font-semibold">Findings:</span> {selectedRevisionPreview.afterSnapshot.findings || '-'}</p>
                      <p className="md:col-span-2"><span className="font-semibold">Recommendations:</span> {selectedRevisionPreview.afterSnapshot.recommendations || '-'}</p>
                    </div>

                    {(() => {
                      const checklistSections = getChecklistSections(selectedRevisionPreview.afterSnapshot.checklist_items)
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
                                    <p>{item.note || '-'}</p>
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
                                    <p>{item.note || '-'}</p>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
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
