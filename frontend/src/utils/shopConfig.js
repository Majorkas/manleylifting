export const shopRoutes = {
  home: '/shop',
  collection: '/shop/collections/:handle',
  product: '/shop/products/:handle',
  cart: '/cart',
  checkout: '/checkout',
}

const configuredApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim()
const defaultApiBaseUrl = import.meta.env.PROD ? '/api' : 'http://localhost:8000/api'

export const shopifyConfig = {
  apiBaseUrl: configuredApiBaseUrl || defaultApiBaseUrl,
  currencyCode: 'EUR',
}

const CART_STORAGE_KEY = 'manley-shop-cart-v2'
const PENDING_CHECKOUT_KEY = 'manley-shop-pending-checkout-v1'
const PENDING_CHECKOUT_MAX_AGE_MS = 2 * 60 * 60 * 1000

function apiUrl(path) {
  const base = shopifyConfig.apiBaseUrl.replace(/\/+$/, '')
  return base + path
}

function toFriendlyApiError(rawMessage, status, path) {
  const message = String(rawMessage || '').trim().toLowerCase()

  if (status === 429 || message === 'too many requests') {
    return 'You are making requests too quickly. Please wait a moment and try again.'
  }

  if (message === 'collection not found') {
    return 'That collection is no longer available.'
  }

  if (message === 'product not found') {
    return 'That product is no longer available.'
  }

  if (message === 'checkout not found') {
    return 'Checkout not found'
  }

  if (message === 'valid statustoken is required') {
    return 'We could not verify your checkout status. Please refresh the page and try again.'
  }

  if (message === 'valid checkoutref is required') {
    return 'We could not verify your checkout details. Please refresh the page and try again.'
  }

  if (message === 'invalid json body') {
    return 'We could not process your request right now. Please try again.'
  }

  if (message === 'invalid request origin') {
    return 'We could not verify your request source. Please refresh the page and try again.'
  }

  if (message === 'bot verification failed') {
    return 'We could not verify the security check. Please try again.'
  }

  if (path.includes('/shop/checkout-url/')) {
    if (message === 'valid checkoutref is required') {
      return 'We could not start checkout because your cart reference was invalid. Please refresh and try again.'
    }
    if (message === 'items are required' || message === 'no valid checkout lines provided') {
      return 'Your cart appears to be empty or invalid. Please review your cart and try again.'
    }
    if (message === 'checkout validation failed') {
      return 'We could not validate your checkout details. Please review your cart and try again.'
    }
    if (message === 'checkout url not returned') {
      return 'Checkout could not be started right now. Please try again in a moment.'
    }
  }

  if (message.startsWith('could not load')) {
    return 'We could not load this content right now. Please try again in a moment.'
  }

  if (message.startsWith('could not start checkout')) {
    return 'We could not start checkout right now. Please try again in a moment.'
  }

  if (message === 'request failed') {
    return 'Something went wrong while contacting the server. Please try again.'
  }

  return String(rawMessage || '').trim() || 'Something went wrong. Please try again.'
}

export function getUserFacingErrorMessage(error, fallbackMessage = 'Something went wrong. Please try again.') {
  const message = String(error?.message || '').trim()
  return message || fallbackMessage
}

function getCookie(name) {
  if (typeof document === 'undefined') return ''
  const cookie = document.cookie
    .split('; ')
    .find((row) => row.startsWith(name + '='))
  return cookie ? decodeURIComponent(cookie.split('=')[1] || '') : ''
}

function safeNowIso() {
  try {
    return new Date().toISOString()
  } catch {
    return ''
  }
}

function createdAtIsStale(isoValue) {
  if (!isoValue) return true

  const timestamp = Date.parse(isoValue)
  if (!Number.isFinite(timestamp)) return true

  return Date.now() - timestamp > PENDING_CHECKOUT_MAX_AGE_MS
}

export function generateCheckoutRef() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  const randomPart = Math.random().toString(36).slice(2, 12)
  return 'chk_' + Date.now() + '_' + randomPart
}

export function savePendingCheckout(checkoutRef, statusToken) {
  if (typeof window === 'undefined') return
  if (!checkoutRef || !statusToken) return

  const payload = {
    checkoutRef: String(checkoutRef),
    statusToken: String(statusToken),
    status: 'pending',
    createdAt: safeNowIso(),
  }

  window.localStorage.setItem(PENDING_CHECKOUT_KEY, JSON.stringify(payload))
}

export function loadPendingCheckout() {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(PENDING_CHECKOUT_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw)
    if (
      !parsed ||
      typeof parsed.checkoutRef !== 'string' ||
      !parsed.checkoutRef ||
      typeof parsed.statusToken !== 'string' ||
      !parsed.statusToken
    ) {
      window.localStorage.removeItem(PENDING_CHECKOUT_KEY)
      return null
    }

    if (createdAtIsStale(parsed.createdAt)) {
      window.localStorage.removeItem(PENDING_CHECKOUT_KEY)
      return null
    }

    return parsed
  } catch {
    window.localStorage.removeItem(PENDING_CHECKOUT_KEY)
    return null
  }
}

export function clearPendingCheckout() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(PENDING_CHECKOUT_KEY)
}

async function parseResponse(response, path = '') {
  const body = await response.json().catch(() => ({}))

  if (!response.ok) {
    const rawMessage = typeof body.error === 'string' ? body.error : 'Request failed'
    const friendlyMessage = toFriendlyApiError(rawMessage, response.status, path)

    // Keep detailed context in logs while showing friendly messaging in the UI.
    console.error('API request failed', {
      status: response.status,
      path,
      rawMessage,
      responseBody: body,
    })

    const error = new Error(friendlyMessage)
    error.status = response.status
    error.path = path
    error.rawMessage = rawMessage
    throw error
  }

  return body
}

async function getJson(path) {
  const response = await fetch(apiUrl(path), {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  return parseResponse(response, path)
}

async function ensureCsrfCookie() {
  await getJson('/csrf/')
}

async function postJson(path, payload, options = {}) {
  const requireCsrf = options.requireCsrf !== false
  let csrfToken = ''

  if (requireCsrf) {
    await ensureCsrfCookie()
    csrfToken = getCookie('csrftoken')
    if (!csrfToken) {
      throw new Error('Missing CSRF token')
    }
  }

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }

  if (requireCsrf) {
    headers['X-CSRFToken'] = csrfToken
  }

  const response = await fetch(apiUrl(path), {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(payload),
  })
  return parseResponse(response, path)
}

export function formatCurrency(amount, currencyCode = shopifyConfig.currencyCode) {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: currencyCode || 'EUR',
  }).format(Number(amount || 0))
}

export async function getFeaturedProducts() {
  const body = await getJson('/shop/products/featured/')
  return body.products || []
}

export async function getFeaturedCollections() {
  const body = await getJson('/shop/collections/')
  return body.collections || []
}

export async function getCollectionByHandle(handle) {
  const body = await getJson('/shop/collections/' + encodeURIComponent(handle) + '/')
  return body.collection || null
}

export async function getProductByHandle(handle) {
  const body = await getJson('/shop/products/' + encodeURIComponent(handle) + '/')
  return body.product || null
}

export async function createCheckoutUrl(items, checkoutRef, options = {}) {
  const antiBotToken = String(options.antiBotToken || '').trim()
  const payload = { items, checkoutRef }

  if (antiBotToken) {
    payload.antiBotToken = antiBotToken
  }

  const body = await postJson('/shop/checkout-url/', payload, { requireCsrf: false })
  return {
    checkoutUrl: body.checkoutUrl || '',
    statusToken: body.statusToken || '',
  }
}

export async function getCheckoutStatus(checkoutRef, statusToken) {
  const ref = String(checkoutRef || '').trim()
  const token = String(statusToken || '').trim()
  if (!ref) {
    throw new Error('checkoutRef is required')
  }
  if (!token) {
    throw new Error('statusToken is required')
  }

  const query =
    '/shop/checkout-status/?checkoutRef=' +
    encodeURIComponent(ref) +
    '&statusToken=' +
    encodeURIComponent(token)

  try {
    const body = await getJson(query)
    return {
      checkoutRef: String(body.checkoutRef || ''),
      status: String(body.status || ''),
      confirmedAt: body.confirmedAt || null,
    }
  } catch (error) {
    if (error?.status === 404 || error?.rawMessage === 'Checkout not found') {
      return {
        checkoutRef: ref,
        status: 'missing',
        confirmedAt: null,
      }
    }
    throw error
  }
}

export function buildCollectionPath(handle) {
  return '/shop/collections/' + handle
}

export function buildProductPath(handle) {
  return '/shop/products/' + handle
}

function normalizeCartItems(items) {
  return (items || [])
    .map((item) => ({
      handle: String(item.handle || ''),
      title: String(item.title || ''),
      variantId: String(item.variantId || ''),
      price: Number(item.price || 0),
      currency: String(item.currency || shopifyConfig.currencyCode),
      imageUrl: String(item.imageUrl || ''),
      quantity: Number(item.quantity || 1),
    }))
    .filter((item) => item.handle && item.variantId && item.quantity > 0)
}

export function loadCartItems() {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return normalizeCartItems(parsed)
  } catch {
    return []
  }
}

export function saveCartItems(items) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(normalizeCartItems(items)))
}

export function getCartCount(cartState = loadCartItems()) {
  return cartState.reduce((total, item) => total + Number(item.quantity || 0), 0)
}

export function getCartSubtotal(cartState = loadCartItems()) {
  return cartState.reduce(
    (total, item) => total + Number(item.price || 0) * Number(item.quantity || 0),
    0,
  )
}
