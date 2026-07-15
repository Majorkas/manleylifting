const configuredApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim()
const defaultApiBaseUrl = import.meta.env.PROD ? '/api' : 'http://localhost:8000/api'
const apiBaseUrl = (configuredApiBaseUrl || defaultApiBaseUrl).replace(/\/+$/, '')

const SESSION_FLAG_KEY = 'manley-portal-session-v1'
let accessTokenMemory = ''

function apiUrl(path) {
  return apiBaseUrl + path
}

function parseJsonSafe(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function formatFieldLabel(fieldName) {
  const knownLabels = {
    company_id: 'Company',
    allowed_company_ids: 'Allowed companies',
    user_id: 'Employee',
    issue_date: 'Issue date',
    expiry_date: 'Expiry date',
    report_date: 'Report date',
    customer_email: 'Customer email',
    customer_username: 'Customer username',
    customer_password: 'Customer password',
    company_name: 'Company name',
    username: 'Username',
    password: 'Password',
    email: 'Email',
    current_password: 'Current password',
    new_password: 'New password',
  }

  if (knownLabels[fieldName]) return knownLabels[fieldName]
  return String(fieldName || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function toMessageList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean)
  }
  if (value && typeof value === 'object') {
    return Object.values(value)
      .flatMap((item) => toMessageList(item))
      .filter(Boolean)
  }
  const text = String(value || '').trim()
  return text ? [text] : []
}

function extractValidationMessage(body) {
  if (!body || typeof body !== 'object') return ''

  const ignoredKeys = new Set(['detail', 'error', 'status', 'code'])
  const parts = []

  for (const [field, rawValue] of Object.entries(body)) {
    if (ignoredKeys.has(field)) continue
    const messages = toMessageList(rawValue)
    if (messages.length === 0) continue
    const label = formatFieldLabel(field)
    parts.push(`${label}: ${messages.join(' ')}`)
  }

  return parts.join(' ')
}

function prettifyRawMessage(path, status, rawMessage, body) {
  const message = String(rawMessage || '').trim()
  const normalized = message.toLowerCase()

  if (status === 401) {
    return 'Your session has expired. Please sign in again.'
  }

  if (status === 403) {
    return 'You do not have permission to perform this action. Contact an account owner if you need access.'
  }

  if (normalized.includes('invalid credentials')) {
    return 'Username or password is incorrect. Try again.'
  }

  if (normalized.includes('account is disabled')) {
    return 'This account is disabled. Contact an administrator to restore access.'
  }

  if (normalized.includes('temporarily locked') || normalized.includes('failed login attempts')) {
    return 'Too many failed sign-in attempts. Please wait 15 minutes and try again.'
  }

  if (normalized.includes('refresh token is required')) {
    return 'Your login session has expired. Please sign in again to continue.'
  }

  if (normalized.includes('username already exists') || normalized.includes('username is unavailable')) {
    const suggested = String(body?.suggested_username || '').trim()
    if (suggested) {
      return `That username is already taken. Try '${suggested}' instead.`
    }
    return 'That username is already taken. Choose a different username.'
  }

  if (normalized.includes('email already exists')) {
    return 'That email address is already in use. Use a different email address.'
  }

  if (normalized.includes('title is required')) {
    return 'A title is required. Add a clear title and try again.'
  }

  if (normalized.includes('company_id is required')) {
    return 'Please select a company before continuing.'
  }

  if (normalized.includes('company_id must be a valid integer')) {
    return 'The selected company is invalid. Refresh the page, select a company again, and retry.'
  }

  if (normalized.includes('report is invalid for equipment')) {
    return 'The selected report does not belong to this equipment. Pick a report from this equipment only.'
  }

  if (normalized.includes('issue_date must be yyyy-mm-dd')) {
    return 'Issue date must be in YYYY-MM-DD format. Update the date and try again.'
  }

  if (normalized.includes('expiry_date must be yyyy-mm-dd')) {
    return 'Expiry date must be in YYYY-MM-DD format. Update the date and try again.'
  }

  if (normalized.includes('must be 10mb or smaller')) {
    return 'The selected file is too large. Please upload a file that is 10MB or smaller.'
  }

  if (normalized.includes('certificate file type must')) {
    return 'Unsupported certificate file type. Upload a PDF, PNG, JPG, or JPEG file.'
  }

  if (normalized.includes('certificate file content does not match the file extension')) {
    return 'The certificate file content does not match its extension. Upload a valid PDF or image file.'
  }

  if (normalized.includes('certificate recovery window has expired')) {
    return 'This certificate can no longer be recovered because the 3-day recovery window has expired.'
  }

  if (normalized.includes('report recovery window has expired')) {
    return 'This report can no longer be recovered because the 3-day recovery window has expired.'
  }

  if (normalized.includes('report images must')) {
    return 'Unsupported image type. Upload PNG, JPG, JPEG, or WEBP images only.'
  }

  if (normalized.includes('report image content does not match the file extension')) {
    return 'One or more report images are invalid. Upload valid PNG, JPG, JPEG, or WEBP files only.'
  }

  if (normalized.includes('only owner can')) {
    return 'Only account owners can perform this action.'
  }

  if (normalized.includes('insufficient permissions')) {
    return 'You do not have permission to perform this action with your current role.'
  }

  if (normalized.includes('only employee accounts can be')) {
    return 'This action only applies to employee accounts.'
  }

  if (normalized.includes('you cannot remove your own account')) {
    return 'You cannot deactivate your own account. Ask another owner to manage your account.'
  }

  if (normalized.includes('no valid changes provided')) {
    return 'No changes were detected. Update at least one field before saving.'
  }

  if (normalized.includes('current password is incorrect')) {
    return 'Current password is incorrect. Enter your existing password and try again.'
  }

  if (normalized.includes('invalid status value')) {
    return 'The selected status is invalid. Choose one of the available status options and retry.'
  }

  if (status === 404 && path.includes('/portal/')) {
    return 'The requested item was not found. It may have been removed or you may no longer have access to it.'
  }

  if (message) return message

  const validationMessage = extractValidationMessage(body)
  if (validationMessage) return validationMessage

  if (status >= 500) {
    return 'Something went wrong on the server. Please try again in a moment.'
  }

  return 'Request failed. Please review your input and try again.'
}

async function parseResponse(response, path) {
  const rawText = await response.text().catch(() => '')
  const body = rawText ? parseJsonSafe(rawText) : {}

  if (!response.ok) {
    const message = prettifyRawMessage(
      path,
      Number(response.status || 0),
      String(body?.detail || body?.error || '').trim(),
      body,
    )
    const error = new Error(message)
    error.status = response.status
    error.path = path
    error.body = body
    throw error
  }

  return body
}

export function getAccessToken() {
  return String(accessTokenMemory || '')
}

export function hasPortalSession() {
  if (getAccessToken()) return true
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(SESSION_FLAG_KEY) === '1'
}

export function savePortalAccessToken(accessToken) {
  accessTokenMemory = String(accessToken || '')
  if (typeof window === 'undefined') return
  if (accessTokenMemory) {
    window.localStorage.setItem(SESSION_FLAG_KEY, '1')
  }
}

export function clearPortalSession() {
  accessTokenMemory = ''
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(SESSION_FLAG_KEY)
  // Signal session expiry to other parts of the app
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('portalSessionExpired'))
  }
}

async function refreshAccessToken() {
  const path = '/auth/token/refresh/'
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({}),
  })

  const body = await parseResponse(response, path)
  const nextAccess = String(body?.access || '')
  if (!nextAccess) {
    throw new Error('Refresh token response missing access token')
  }

  savePortalAccessToken(nextAccess)
  return nextAccess
}

export async function refreshPortalSession() {
  return refreshAccessToken()
}

async function authFetch(path, options = {}) {
  let access = getAccessToken()

  // On reload, access token is memory-only. If we still have a session flag,
  // refresh first to avoid an expected 401 on the initial protected request.
  if (!access && options.retry !== false && typeof window !== 'undefined') {
    const hasSessionFlag = window.localStorage.getItem(SESSION_FLAG_KEY) === '1'
    if (hasSessionFlag) {
      try {
        access = await refreshAccessToken()
      } catch {
        clearPortalSession()
      }
    }
  }

  const headers = {
    Accept: 'application/json',
    ...(options.headers || {}),
  }

  if (access) {
    headers.Authorization = 'Bearer ' + access
  }

  const response = await fetch(apiUrl(path), {
    ...options,
    credentials: 'include',
    headers,
  })

  if (response.status !== 401 || options.retry === false) {
    return response
  }

  try {
    const nextAccess = await refreshAccessToken()
    const retryHeaders = {
      ...headers,
      Authorization: 'Bearer ' + nextAccess,
    }

    return fetch(apiUrl(path), {
      ...options,
      credentials: 'include',
      headers: retryHeaders,
      retry: false,
    })
  } catch {
    clearPortalSession()
    return response
  }
}

export async function portalLogin(username, password) {
  const path = '/auth/token/'
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ username, password }),
  })
  const body = await parseResponse(response, path)

  const access = String(body?.access || '')
  if (!access) {
    throw new Error('Login did not return an access token')
  }

  savePortalAccessToken(access)
  return body
}

export async function portalLogout() {
  const path = '/auth/logout/'

  try {
    const response = await authFetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    })
    if (response.ok) {
      await parseResponse(response, path)
    }
  } catch {
    // Clear local session even if server-side revoke fails.
  }

  clearPortalSession()
}

export async function getPortalMe() {
  const path = '/portal/me/'
  const response = await authFetch(path)
  const body = await parseResponse(response, path)
  return {
    id: Number(body?.id || 0),
    username: String(body?.username || ''),
    email: String(body?.email || ''),
    fullName: String(body?.full_name || ''),
    role: String(body?.role || ''),
    allowedCompanyIds: Array.isArray(body?.allowed_company_ids) ? body.allowed_company_ids : [],
    requiredPasswordChange: Boolean(body?.required_password_change),
  }
}

export async function changePortalPassword(payload) {
  const path = '/portal/me/change-password/'
  const response = await authFetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  return parseResponse(response, path)
}

export async function getPortalCompanyHeader(companyId) {
  const query = companyId ? '?companyId=' + encodeURIComponent(String(companyId)) : ''
  const path = '/portal/company-header/' + query
  const response = await authFetch(path)
  return parseResponse(response, path)
}

export async function getPortalCompanies() {
  const path = '/portal/companies/'
  const response = await authFetch(path)
  const body = await parseResponse(response, path)
  return Array.isArray(body?.results) ? body.results : []
}

export async function getPortalDashboardStats() {
  const path = '/portal/dashboard-stats/'
  const response = await authFetch(path)
  const body = await parseResponse(response, path)
  return {
    overdue_count: Number(body?.overdue_count || 0),
    due_soon_count: Number(body?.due_soon_count || 0),
    pending_approvals_count: Number(body?.pending_approvals_count || 0),
  }
}

export async function getPendingReportApprovals() {
  const path = '/portal/pending-report-approvals/'
  const response = await authFetch(path)
  const body = await parseResponse(response, path)
  return Array.isArray(body?.results) ? body.results : []
}

export async function getStaffAssignments({ status = 'active' } = {}) {
  const params = new URLSearchParams()
  if (status) params.set('status', String(status))
  const query = params.toString()
  const path = '/portal/staff-assignments/' + (query ? '?' + query : '')
  const response = await authFetch(path)
  const body = await parseResponse(response, path)
  return Array.isArray(body?.results) ? body.results : []
}

export async function createStaffAssignment(payload) {
  const path = '/portal/staff-assignments/'
  const response = await authFetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  return parseResponse(response, path)
}

export async function updateStaffAssignment(payload) {
  const path = '/portal/staff-assignments/'
  const response = await authFetch(path, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  return parseResponse(response, path)
}

export async function deleteStaffAssignment(userId) {
  const path = '/portal/staff-assignments/'
  const response = await authFetch(path, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ user_id: userId }),
  })
  return parseResponse(response, path)
}

export async function reactivateStaffAssignment(userId) {
  const path = '/portal/staff-assignments/'
  const response = await authFetch(path, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ user_id: userId, is_active: true }),
  })
  return parseResponse(response, path)
}

export async function createPortalCustomer(payload) {
  const path = '/portal/customers/'
  const response = await authFetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  return parseResponse(response, path)
}

export async function updatePortalCustomer(payload) {
  const path = '/portal/customers/'
  const response = await authFetch(path, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  return parseResponse(response, path)
}

export async function getPortalEquipment({ companyId = '', search = '' } = {}) {
  const params = new URLSearchParams()
  if (companyId) params.set('companyId', String(companyId))
  if (search) params.set('search', String(search))

  const query = params.toString()
  const path = '/portal/equipment/' + (query ? '?' + query : '')
  const response = await authFetch(path)
  const body = await parseResponse(response, path)
  return Array.isArray(body?.results) ? body.results : []
}

export async function createPortalEquipment(payload) {
  const path = '/portal/equipment/'
  const response = await authFetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  return parseResponse(response, path)
}

export async function updatePortalEquipment(equipmentId, payload) {
  const path = '/portal/equipment/' + encodeURIComponent(String(equipmentId)) + '/'
  const response = await authFetch(path, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  return parseResponse(response, path)
}

export async function getEquipmentReports(equipmentId) {
  const path = '/portal/equipment/' + encodeURIComponent(String(equipmentId)) + '/reports/'
  const response = await authFetch(path)
  const body = await parseResponse(response, path)
  return Array.isArray(body?.results) ? body.results : []
}

export async function getEquipmentActivity(equipmentId) {
  const path = '/portal/equipment/' + encodeURIComponent(String(equipmentId)) + '/activity/'
  const response = await authFetch(path)
  const body = await parseResponse(response, path)
  return Array.isArray(body?.results) ? body.results : []
}

export async function createEquipmentReport(equipmentId, payload) {
  const path = '/portal/equipment/' + encodeURIComponent(String(equipmentId)) + '/reports/'
  const imageFiles = Array.isArray(payload?.images) ? payload.images.filter(Boolean) : []

  if (imageFiles.length > 0) {
    const formData = new FormData()
    formData.set('title', String(payload?.title || ''))
    formData.set('summary', String(payload?.summary || ''))
    formData.set('findings', String(payload?.findings || ''))
    formData.set('recommendations', String(payload?.recommendations || ''))
    formData.set('checklist_items', JSON.stringify(Array.isArray(payload?.checklist_items) ? payload.checklist_items : []))
    formData.set('report_date', String(payload?.report_date || ''))
    formData.set('status', String(payload?.status || 'draft'))
    imageFiles.forEach((file) => {
      formData.append('images', file)
    })

    const response = await authFetch(path, {
      method: 'POST',
      body: formData,
    })
    return parseResponse(response, path)
  }

  const response = await authFetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  return parseResponse(response, path)
}

export async function updateReport(reportId, payload) {
  const path = '/portal/reports/' + encodeURIComponent(String(reportId)) + '/'
  const imageFiles = Array.isArray(payload?.images) ? payload.images.filter(Boolean) : []
  const removedImageIds = Array.isArray(payload?.removed_image_ids)
    ? payload.removed_image_ids.filter(Boolean)
    : Array.isArray(payload?.removedImageIds)
      ? payload.removedImageIds.filter(Boolean)
      : []

  if (imageFiles.length > 0 || removedImageIds.length > 0) {
    const formData = new FormData()
    formData.set('title', String(payload?.title || ''))
    formData.set('summary', String(payload?.summary || ''))
    formData.set('findings', String(payload?.findings || ''))
    formData.set('recommendations', String(payload?.recommendations || ''))
    formData.set('checklist_items', JSON.stringify(Array.isArray(payload?.checklist_items) ? payload.checklist_items : []))
    formData.set('report_date', String(payload?.report_date || ''))
    formData.set('status', String(payload?.status || 'draft'))
    imageFiles.forEach((file) => {
      formData.append('images', file)
    })
    if (removedImageIds.length > 0) {
      formData.set('removed_image_ids', JSON.stringify(removedImageIds))
    }

    const response = await authFetch(path, {
      method: 'PATCH',
      body: formData,
    })
    return parseResponse(response, path)
  }

  const response = await authFetch(path, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  return parseResponse(response, path)
}

export async function deleteReport(reportId) {
  const path = '/portal/reports/' + encodeURIComponent(String(reportId)) + '/'
  const response = await authFetch(path, {
    method: 'DELETE',
  })
  if (response.status === 204) return { ok: true }
  return parseResponse(response, path)
}

export async function recoverReport(reportId) {
  const path = '/portal/reports/' + encodeURIComponent(String(reportId)) + '/recover/'
  const response = await authFetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  })
  return parseResponse(response, path)
}

export async function getReportRevisions(reportId) {
  const path = '/portal/reports/' + encodeURIComponent(String(reportId)) + '/revisions/'
  const response = await authFetch(path)
  const body = await parseResponse(response, path)
  return Array.isArray(body?.results) ? body.results : []
}

export async function getEquipmentCertificates(equipmentId) {
  const path = '/portal/equipment/' + encodeURIComponent(String(equipmentId)) + '/certificates/'
  const response = await authFetch(path)
  const body = await parseResponse(response, path)
  return Array.isArray(body?.results) ? body.results : []
}

export async function uploadEquipmentCertificate(equipmentId, payload) {
  const path = '/portal/equipment/' + encodeURIComponent(String(equipmentId)) + '/certificates/'
  const certificateFile = payload?.file

  if (!certificateFile) {
    throw new Error('Certificate file is required')
  }

  const formData = new FormData()
  formData.set('title', String(payload?.title || ''))
  formData.set('issue_date', String(payload?.issue_date || ''))
  formData.set('expiry_date', String(payload?.expiry_date || ''))
  if (payload?.report_id) {
    formData.set('report', String(payload.report_id))
  }
  formData.set('file', certificateFile)

  const response = await authFetch(path, {
    method: 'POST',
    body: formData,
  })
  return parseResponse(response, path)
}

export async function downloadCertificate(certificateId) {
  const path = '/portal/certificates/' + encodeURIComponent(String(certificateId)) + '/download/'
  const response = await authFetch(path)
  if (!response.ok) {
    throw new Error('Failed to download certificate')
  }
  return response.blob()
}

export async function deleteEquipmentCertificate(certificateId) {
  const path = '/portal/certificates/' + encodeURIComponent(String(certificateId)) + '/'
  const response = await authFetch(path, {
    method: 'DELETE',
  })
  return parseResponse(response, path)
}

export async function recoverEquipmentCertificate(certificateId) {
  const path = '/portal/certificates/' + encodeURIComponent(String(certificateId)) + '/recover/'
  const response = await authFetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  })
  return parseResponse(response, path)
}
