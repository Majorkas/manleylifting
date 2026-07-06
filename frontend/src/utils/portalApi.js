const configuredApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim()
const defaultApiBaseUrl = import.meta.env.PROD ? '/api' : 'http://localhost:8000/api'
const apiBaseUrl = (configuredApiBaseUrl || defaultApiBaseUrl).replace(/\/+$/, '')

const ACCESS_TOKEN_KEY = 'manley-portal-access-token-v1'
const REFRESH_TOKEN_KEY = 'manley-portal-refresh-token-v1'

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

async function parseResponse(response, path) {
  const rawText = await response.text().catch(() => '')
  const body = rawText ? parseJsonSafe(rawText) : {}

  if (!response.ok) {
    const message =
      String(body?.detail || '').trim() ||
      String(body?.error || '').trim() ||
      'Request failed'
    const error = new Error(message)
    error.status = response.status
    error.path = path
    error.body = body
    throw error
  }

  return body
}

export function getAccessToken() {
  if (typeof window === 'undefined') return ''
  return String(window.localStorage.getItem(ACCESS_TOKEN_KEY) || '')
}

export function getRefreshToken() {
  if (typeof window === 'undefined') return ''
  return String(window.localStorage.getItem(REFRESH_TOKEN_KEY) || '')
}

export function hasPortalSession() {
  return Boolean(getAccessToken() && getRefreshToken())
}

export function savePortalTokens(accessToken, refreshToken) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(ACCESS_TOKEN_KEY, String(accessToken || ''))
  window.localStorage.setItem(REFRESH_TOKEN_KEY, String(refreshToken || ''))
}

export function clearPortalSession() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(ACCESS_TOKEN_KEY)
  window.localStorage.removeItem(REFRESH_TOKEN_KEY)
  // Signal session expiry to other parts of the app
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('portalSessionExpired'))
  }
}

async function refreshAccessToken() {
  const refresh = getRefreshToken()
  if (!refresh) {
    throw new Error('Missing refresh token')
  }

  const path = '/auth/token/refresh/'
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ refresh }),
  })

  const body = await parseResponse(response, path)
  const nextAccess = String(body?.access || '')
  const nextRefresh = String(body?.refresh || refresh)
  if (!nextAccess) {
    throw new Error('Refresh token response missing access token')
  }

  savePortalTokens(nextAccess, nextRefresh)
  return nextAccess
}

async function authFetch(path, options = {}) {
  const access = getAccessToken()
  const headers = {
    Accept: 'application/json',
    ...(options.headers || {}),
  }

  if (access) {
    headers.Authorization = 'Bearer ' + access
  }

  const response = await fetch(apiUrl(path), {
    ...options,
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
      headers: retryHeaders,
      retry: false,
    })
  } catch (error) {
    clearPortalSession()
    return response
  }
}

export async function portalLogin(username, password) {
  const path = '/auth/token/'
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ username, password }),
  })
  const body = await parseResponse(response, path)

  const access = String(body?.access || '')
  const refresh = String(body?.refresh || '')
  if (!access || !refresh) {
    throw new Error('Login did not return valid tokens')
  }

  savePortalTokens(access, refresh)
  return body
}

export async function portalLogout() {
  const refresh = getRefreshToken()
  const path = '/auth/logout/'

  if (refresh) {
    try {
      const response = await authFetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refresh }),
      })
      if (response.ok) {
        await parseResponse(response, path)
      }
    } catch {
      // Clear local session even if server-side revoke fails.
    }
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

export async function getStaffAssignments() {
  const path = '/portal/staff-assignments/'
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

export async function createEquipmentReport(equipmentId, payload) {
  const path = '/portal/equipment/' + encodeURIComponent(String(equipmentId)) + '/reports/'
  const imageFiles = Array.isArray(payload?.images) ? payload.images.filter(Boolean) : []

  if (imageFiles.length > 0) {
    const formData = new FormData()
    formData.set('title', String(payload?.title || ''))
    formData.set('summary', String(payload?.summary || ''))
    formData.set('findings', String(payload?.findings || ''))
    formData.set('recommendations', String(payload?.recommendations || ''))
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
