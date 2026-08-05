const configuredApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim()

function alignDevApiBaseUrl(configuredBaseUrl) {
  const trimmed = String(configuredBaseUrl || '').trim()
  if (!trimmed || typeof window === 'undefined') return trimmed

  // Relative API paths are already same-site in dev and prod.
  if (trimmed.startsWith('/')) return trimmed

  try {
    const parsed = new URL(trimmed)
    const appHost = String(window.location.hostname || '').trim()
    const apiHost = String(parsed.hostname || '').trim()

    const isLocalAliasPair =
      (apiHost === 'localhost' && appHost === '127.0.0.1') ||
      (apiHost === '127.0.0.1' && appHost === 'localhost')

    if (isLocalAliasPair) {
      parsed.hostname = appHost
      return parsed.toString()
    }

    return trimmed
  } catch {
    return trimmed
  }
}

function resolveDevApiBaseUrl() {
  if (typeof window === 'undefined') return 'http://localhost:8000/api'

  const protocol = String(window.location.protocol || 'http:')
  const hostname = String(window.location.hostname || 'localhost')
  return `${protocol}//${hostname}:8000/api`
}

const defaultApiBaseUrl = import.meta.env.PROD ? '/api' : resolveDevApiBaseUrl()
const effectiveConfiguredApiBaseUrl = import.meta.env.PROD
  ? configuredApiBaseUrl
  : alignDevApiBaseUrl(configuredApiBaseUrl)
const apiBaseUrl = (effectiveConfiguredApiBaseUrl || defaultApiBaseUrl).replace(/\/+$/, '')

const SESSION_FLAG_KEY = 'manley-portal-session-v1'
let accessTokenMemory = ''
let refreshAccessTokenPromise = null
let csrfSeedPromise = null
let csrfTokenMemory = ''

function apiUrl(path) {
  return apiBaseUrl + path
}

function getCookie(name) {
  if (typeof document === 'undefined') return ''
  const prefix = `${encodeURIComponent(name)}=`
  const cookie = String(document.cookie || '')
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix))
  if (!cookie) return ''
  return decodeURIComponent(cookie.slice(prefix.length))
}

async function getCsrfToken() {
  if (csrfTokenMemory) return csrfTokenMemory

  const existingToken = getCookie('csrftoken')
  if (existingToken) {
    csrfTokenMemory = existingToken
    return csrfTokenMemory
  }

  if (!csrfSeedPromise) {
    csrfSeedPromise = (async () => {
      const path = '/csrf/'
      const response = await fetch(apiUrl(path), {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
      return parseResponse(response, path)
    })()
  }

  let seedResponse
  try {
    seedResponse = await csrfSeedPromise
  } finally {
    csrfSeedPromise = null
  }

  csrfTokenMemory = String(seedResponse?.csrf_token || getCookie('csrftoken') || '')
  if (!csrfTokenMemory) {
    throw new Error('Unable to establish a secure request token')
  }
  return csrfTokenMemory
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
    first_name: 'First name',
    last_name: 'Last name',
    accept_terms: 'Terms',
    accept_privacy: 'Privacy notice',
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
  csrfTokenMemory = ''
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(SESSION_FLAG_KEY)
  // Signal session expiry to other parts of the app
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('portalSessionExpired'))
  }
}

async function refreshAccessToken() {
  if (refreshAccessTokenPromise) {
    return refreshAccessTokenPromise
  }

  refreshAccessTokenPromise = (async () => {
    const path = '/auth/token/refresh/'
    const csrfToken = await getCsrfToken()
    const response = await fetch(apiUrl(path), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-CSRFToken': csrfToken,
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
  })()

  try {
    return await refreshAccessTokenPromise
  } finally {
    refreshAccessTokenPromise = null
  }
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
  const csrfToken = await getCsrfToken()
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-CSRFToken': csrfToken,
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

async function publicAccountPost(path, payload) {
  const csrfToken = await getCsrfToken()
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-CSRFToken': csrfToken,
    },
    body: JSON.stringify(payload),
  })
  return parseResponse(response, path)
}

export async function registerCommerceAccount(payload) {
  const body = {
    email: String(payload?.email || '').trim(),
    password: String(payload?.password || ''),
    first_name: String(payload?.firstName || '').trim(),
    last_name: String(payload?.lastName || '').trim(),
    accept_terms: Boolean(payload?.acceptTerms),
    accept_privacy: Boolean(payload?.acceptPrivacy),
    turnstile_token: String(payload?.turnstileToken || ''),
  }

  const recipientName = String(payload?.recipientName || payload?.recipient_name || '').trim()
  const recipientPhone = String(payload?.recipientPhone || payload?.recipient_phone || '').trim()
  const addressLine1 = String(payload?.addressLine1 || payload?.address_line_1 || '').trim()
  const addressLine2 = String(payload?.addressLine2 || payload?.address_line_2 || '').trim()
  const city = String(payload?.city || '').trim()
  const county = String(payload?.county || '').trim()
  const postcode = String(payload?.postcode || '').trim()
  const countryCode = String(payload?.countryCode || payload?.country_code || '').trim()

  if (recipientName) body.recipient_name = recipientName
  if (recipientPhone) body.recipient_phone = recipientPhone
  if (addressLine1) body.address_line_1 = addressLine1
  if (addressLine2) body.address_line_2 = addressLine2
  if (city) body.city = city
  if (county) body.county = county
  if (postcode) body.postcode = postcode
  if (countryCode) body.country_code = countryCode

  return publicAccountPost('/account/register/', body)
}

export async function verifyCommerceEmail(token) {
  return publicAccountPost('/account/verify-email/', {
    token: String(token || '').trim(),
  })
}

export async function resendCommerceVerification(email, turnstileToken = '') {
  return publicAccountPost('/account/resend-verification/', {
    email: String(email || '').trim(),
    turnstile_token: String(turnstileToken || ''),
  })
}

export async function requestCommercePasswordReset(email, turnstileToken = '') {
  return publicAccountPost('/account/password-reset/', {
    email: String(email || '').trim(),
    turnstile_token: String(turnstileToken || ''),
  })
}

export async function completeCommercePasswordReset(token, newPassword) {
  return publicAccountPost('/account/password-reset/complete/', {
    token: String(token || '').trim(),
    new_password: String(newPassword || ''),
  })
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

export async function getAccountBootstrap() {
  const path = '/account/bootstrap/'
  const response = await authFetch(path)
  const body = await parseResponse(response, path)
  const phone = String(body?.phone || '').trim()

  return {
    username: String(body?.username || ''),
    email: String(body?.email || ''),
    fullName: String(body?.full_name || ''),
    ...(phone ? { phone } : {}),
    emailVerified: Boolean(body?.email_verified),
    capabilities: {
      canShop: Boolean(body?.capabilities?.can_shop),
      canViewOrders: Boolean(body?.capabilities?.can_view_orders),
      canAccessPortal: Boolean(body?.capabilities?.can_access_portal),
    },
  }
}

export async function claimGuestOrder(orderNumber, claimToken) {
  const path = '/account/claim-order/'
  const response = await authFetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      orderNumber: String(orderNumber || '').trim(),
      claimToken: String(claimToken || '').trim(),
    }),
  })
  return parseResponse(response, path)
}

export async function getAccountOrders() {
  const response = await authFetch('/account/orders/')
  const body = await parseResponse(response, '/account/orders/')
  return Array.isArray(body) ? body.map((order) => ({
    checkoutRef: String(order?.checkoutRef || ''),
    orderNumber: String(order?.orderNumber || ''),
    status: String(order?.status || ''),
    customerName: String(order?.customerName || ''),
    customerEmail: String(order?.customerEmail || ''),
    lineItems: Array.isArray(order?.lineItems) ? order.lineItems : [],
    amountTotalCents: Number(order?.amountTotalCents || 0),
    currency: String(order?.currency || ''),
    paidAt: String(order?.paidAt || ''),
    createdAt: String(order?.createdAt || ''),
  })) : []
}

export async function getAccountAddresses() {
  const response = await authFetch('/account/addresses/')
  const body = await parseResponse(response, '/account/addresses/')
  return Array.isArray(body) ? body.map((address) => ({
    id: Number(address?.id || 0),
    label: String(address?.label || ''),
    recipientName: String(address?.recipientName || ''),
    recipientPhone: String(address?.recipientPhone || ''),
    addressLine1: String(address?.addressLine1 || ''),
    addressLine2: String(address?.addressLine2 || ''),
    city: String(address?.city || ''),
    county: String(address?.county || ''),
    postcode: String(address?.postcode || ''),
    countryCode: String(address?.countryCode || ''),
    isDefaultShipping: Boolean(address?.isDefaultShipping),
    isDefaultBilling: Boolean(address?.isDefaultBilling),
  })) : []
}

function buildAccountAddressPayload(payload) {
  return {
    label: String(payload?.label || '').trim(),
    recipientName: String(payload?.recipientName || '').trim(),
    recipientPhone: String(payload?.recipientPhone || '').trim(),
    addressLine1: String(payload?.addressLine1 || '').trim(),
    addressLine2: String(payload?.addressLine2 || '').trim(),
    city: String(payload?.city || '').trim(),
    county: String(payload?.county || '').trim(),
    postcode: String(payload?.postcode || '').trim(),
    countryCode: String(payload?.countryCode || '').trim(),
    isDefaultShipping: Boolean(payload?.isDefaultShipping),
    isDefaultBilling: Boolean(payload?.isDefaultBilling),
  }
}

export async function createAccountAddress(payload) {
  const response = await authFetch('/account/addresses/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildAccountAddressPayload(payload)),
  })
  return parseResponse(response, '/account/addresses/')
}

export async function updateAccountAddress(addressId, payload) {
  const response = await authFetch(`/account/addresses/${encodeURIComponent(String(addressId))}/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildAccountAddressPayload(payload)),
  })
  return parseResponse(response, `/account/addresses/${encodeURIComponent(String(addressId))}/`)
}

export async function deleteAccountAddress(addressId) {
  const response = await authFetch(`/account/addresses/${encodeURIComponent(String(addressId))}/`, {
    method: 'DELETE',
  })
  return parseResponse(response, `/account/addresses/${encodeURIComponent(String(addressId))}/`)
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

export async function changeAccountPassword(payload) {
  const path = '/account/change-password/'
  const response = await authFetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      current_password: payload?.currentPassword ?? payload?.current_password,
      new_password: payload?.newPassword ?? payload?.new_password,
    }),
  })
  return parseResponse(response, path)
}

export async function requestAccountEmailChange(payload) {
  const path = '/account/change-email/'
  const response = await authFetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      current_password: payload?.currentPassword ?? payload?.current_password,
      email: payload?.newEmail ?? payload?.email,
    }),
  })
  return parseResponse(response, path)
}

export async function setupAccountMfa(payload) {
  const path = '/account/mfa/setup/'
  const response = await authFetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      current_password: payload?.currentPassword ?? payload?.current_password,
    }),
  })
  return parseResponse(response, path)
}

export async function verifyAccountMfa(code) {
  const path = '/account/mfa/verify/'
  const response = await authFetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code: String(code || '').trim() }),
  })
  return parseResponse(response, path)
}

export async function completeAccountEmailChange(token) {
  const path = '/account/change-email/complete/'
  const response = await publicAccountPost(path, {
    token: String(token || '').trim(),
  })
  return parseResponse(response, path)
}

export async function getAccountSecurityEvents() {
  const response = await authFetch('/account/security-events/')
  const body = await parseResponse(response, '/account/security-events/')
  return Array.isArray(body) ? body.map((event) => ({
    action: String(event?.action || ''),
    targetType: String(event?.targetType || ''),
    targetId: String(event?.targetId || ''),
    details: event?.details || {},
    createdAt: String(event?.createdAt || ''),
  })) : []
}

export async function getAccountSessions() {
  const response = await authFetch('/account/sessions/')
  const body = await parseResponse(response, '/account/sessions/')
  return Array.isArray(body) ? body.map((session) => ({
    id: String(session?.id || ''),
    createdAt: String(session?.createdAt || ''),
    lastSeenAt: String(session?.lastSeenAt || ''),
    expiresAt: String(session?.expiresAt || ''),
    revokedAt: String(session?.revokedAt || ''),
    isCurrentSession: Boolean(session?.isCurrentSession),
    isActive: Boolean(session?.isActive),
    isRevoked: Boolean(session?.isRevoked),
  })) : []
}

export async function revokeAccountSession(sessionId) {
  const path = `/account/sessions/${encodeURIComponent(String(sessionId))}/revoke/`
  const response = await authFetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  })
  return parseResponse(response, path)
}

export async function logoutAllAccountSessions() {
  const path = '/account/logout-all/'
  const response = await authFetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  })
  return parseResponse(response, path)
}

export async function disableAccount(payload) {
  const path = '/account/disable/'
  const response = await authFetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      current_password: payload?.currentPassword ?? payload?.current_password,
      reason: payload?.reason ?? '',
    }),
  })
  return parseResponse(response, path)
}

export async function deleteAccount(payload) {
  const path = '/account/delete/'
  const response = await authFetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      current_password: payload?.currentPassword ?? payload?.current_password,
      confirm: Boolean(payload?.confirm),
    }),
  })
  return parseResponse(response, path)
}

export async function getPortalCompanyHeader(companyId) {
  const query = companyId ? '?companyId=' + encodeURIComponent(String(companyId)) : ''
  const path = '/portal/company-header/' + query
  const response = await authFetch(path)
  return parseResponse(response, path)
}

export async function createPortalSite(payload) {
  const path = '/portal/company-sites/'
  const response = await authFetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  return parseResponse(response, path)
}

export async function updatePortalSite(siteId, payload) {
  const path = '/portal/company-sites/' + encodeURIComponent(String(siteId)) + '/'
  const response = await authFetch(path, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  return parseResponse(response, path)
}

export async function deletePortalSite(siteId) {
  const path = '/portal/company-sites/' + encodeURIComponent(String(siteId)) + '/'
  const response = await authFetch(path, {
    method: 'DELETE',
  })
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

export async function getPortalEquipment({ companyId = '', siteId = '', search = '' } = {}) {
  const params = new URLSearchParams()
  if (companyId) params.set('companyId', String(companyId))
  if (siteId) params.set('siteId', String(siteId))
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
  const checklistImageFiles = Array.isArray(payload?.checklist_images)
    ? payload.checklist_images.filter(Boolean)
    : []
  const checklistImageLabels = Array.isArray(payload?.checklist_image_labels)
    ? payload.checklist_image_labels.filter((item) => String(item || '').trim() !== '')
    : []

  if (imageFiles.length > 0 || checklistImageFiles.length > 0) {
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
    checklistImageFiles.forEach((file) => {
      formData.append('checklist_images', file)
    })
    checklistImageLabels.forEach((label) => {
      formData.append('checklist_image_labels', String(label))
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
  const checklistImageFiles = Array.isArray(payload?.checklist_images)
    ? payload.checklist_images.filter(Boolean)
    : []
  const checklistImageLabels = Array.isArray(payload?.checklist_image_labels)
    ? payload.checklist_image_labels.filter((item) => String(item || '').trim() !== '')
    : []
  const removedImageIds = Array.isArray(payload?.removed_image_ids)
    ? payload.removed_image_ids.filter(Boolean)
    : Array.isArray(payload?.removedImageIds)
      ? payload.removedImageIds.filter(Boolean)
      : []

  if (imageFiles.length > 0 || checklistImageFiles.length > 0 || removedImageIds.length > 0) {
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
    checklistImageFiles.forEach((file) => {
      formData.append('checklist_images', file)
    })
    checklistImageLabels.forEach((label) => {
      formData.append('checklist_image_labels', String(label))
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

export async function getSiteCertificates(siteId) {
  const path = '/portal/company-sites/' + encodeURIComponent(String(siteId)) + '/certificates/'
  const response = await authFetch(path)
  const body = await parseResponse(response, path)
  return Array.isArray(body?.results) ? body.results : []
}

export async function generateSiteCertificates(siteId) {
  const path = '/portal/company-sites/' + encodeURIComponent(String(siteId)) + '/certificates/generate/'
  const response = await authFetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  })

  if (!response.ok) {
    await parseResponse(response, path)
    throw new Error('Unable to generate certificates')
  }

  return parseResponse(response, path)
}
