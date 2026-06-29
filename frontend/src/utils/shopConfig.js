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

async function parseResponse(response) {
  const body = await response.json().catch(() => ({}))

  if (!response.ok) {
    const message = typeof body.error === 'string' ? body.error : 'Request failed'
    throw new Error(message)
  }

  return body
}

async function getJson(path) {
  const response = await fetch(apiUrl(path), {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  return parseResponse(response)
}

async function ensureCsrfCookie() {
  await getJson('/csrf/')
}

async function postJson(path, payload) {
  await ensureCsrfCookie()
  const csrfToken = getCookie('csrftoken')
  if (!csrfToken) {
    throw new Error('Missing CSRF token')
  }

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
  return parseResponse(response)
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

export async function createCheckoutUrl(items, checkoutRef) {
  const body = await postJson('/shop/checkout-url/', { items, checkoutRef })
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
    if (error?.message === 'Checkout not found') {
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
