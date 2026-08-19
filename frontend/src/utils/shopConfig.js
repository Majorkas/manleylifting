export const shopRoutes = {
  home: '/shop',
  collection: '/shop/collections/:handle',
  product: '/shop/products/:handle',
  cart: '/cart',
  checkout: '/checkout',
  orderConfirmed: '/order-confirmed',
}

const configuredApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim()
const defaultApiBaseUrl = import.meta.env.PROD ? '/api' : 'http://localhost:8000/api'

export const shopConfig = {
  apiBaseUrl: configuredApiBaseUrl || defaultApiBaseUrl,
  currencyCode: 'EUR',
}

export const CART_STORAGE_KEY = 'manley-shop-cart-v2'
const PENDING_CHECKOUT_KEY = 'manley-shop-pending-checkout-v1'
const COMPLETED_CHECKOUT_KEY = 'manley-shop-completed-checkout-v1'
const PENDING_ORDER_CLAIM_KEY = 'manley-shop-pending-order-claim-v1'
const GUEST_CHECKOUT_OFFER_KEY = 'manley-guest-checkout-offer'
const PENDING_CHECKOUT_MAX_AGE_MS = 2 * 60 * 60 * 1000
let csrfTokenMemory = ''
let pendingCheckoutMemory = null
let pendingOrderClaimMemory = null
let completedCheckoutMemory = null

function apiUrl(path) {
  const base = shopConfig.apiBaseUrl.replace(/\/+$/, '')
  return base + path
}

function toFriendlyApiError(rawMessage, status) {
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

  if (message === 'valid customer email is required') {
    return 'Please provide a valid email address to continue.'
  }

  if (message === 'customer name is required') {
    return 'Please provide your full name to continue.'
  }

  if (message === 'could not load live product pricing') {
    return 'We could not verify current pricing. Please refresh and try again.'
  }

  if (message === 'one or more checkout items are no longer available') {
    return 'Some items in your cart changed. Please refresh your cart and try again.'
  }

  if (message === 'checkout currency mismatch') {
    return 'Your cart has mixed currencies and cannot be checked out together.'
  }

  if (message === 'checkout total must be greater than zero') {
    return 'Your order total must be greater than zero.'
  }

  if (message === 'payment provider is not configured right now.') {
    return 'Payments are temporarily unavailable. Please try again shortly.'
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

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    return 'chk_' + Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  throw new Error('Secure checkout reference generation is unavailable')
}

export function generateCapabilityToken() {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
  }

  throw new Error('Secure checkout token generation is unavailable')
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

  window.localStorage.removeItem(PENDING_CHECKOUT_KEY)
  window.sessionStorage.removeItem(PENDING_CHECKOUT_KEY)
  pendingCheckoutMemory = payload
}

export function loadPendingCheckout() {
  if (typeof window === 'undefined') return null

  window.localStorage.removeItem(PENDING_CHECKOUT_KEY)
  window.sessionStorage.removeItem(PENDING_CHECKOUT_KEY)
  if (!pendingCheckoutMemory || createdAtIsStale(pendingCheckoutMemory.createdAt)) {
    pendingCheckoutMemory = null
    return null
  }

  return pendingCheckoutMemory
}

export function clearPendingCheckout() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(PENDING_CHECKOUT_KEY)
  window.sessionStorage.removeItem(PENDING_CHECKOUT_KEY)
  pendingCheckoutMemory = null
}

export function savePendingOrderClaim(orderNumber, claimToken, checkoutRef = '', statusToken = '') {
  if (typeof window === 'undefined') return
  const normalizedOrderNumber = String(orderNumber || '').trim()
  const normalizedClaimToken = String(claimToken || '').trim()
  if (!normalizedOrderNumber || !normalizedClaimToken) return

  const payload = {
    orderNumber: normalizedOrderNumber,
    claimToken: normalizedClaimToken,
    checkoutRef: String(checkoutRef || '').trim(),
    statusToken: String(statusToken || '').trim(),
    createdAt: safeNowIso(),
  }

  window.localStorage.removeItem(PENDING_ORDER_CLAIM_KEY)
  window.sessionStorage.removeItem(PENDING_ORDER_CLAIM_KEY)
  pendingOrderClaimMemory = payload
}

export function loadPendingOrderClaim() {
  if (typeof window === 'undefined') return null

  window.localStorage.removeItem(PENDING_ORDER_CLAIM_KEY)
  window.sessionStorage.removeItem(PENDING_ORDER_CLAIM_KEY)
  if (!pendingOrderClaimMemory || createdAtIsStale(pendingOrderClaimMemory.createdAt)) {
    pendingOrderClaimMemory = null
    return null
  }

  return pendingOrderClaimMemory
}

export function clearPendingOrderClaim() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(PENDING_ORDER_CLAIM_KEY)
  window.sessionStorage.removeItem(PENDING_ORDER_CLAIM_KEY)
  pendingOrderClaimMemory = null
}

export function saveGuestCheckoutOffer(email, fullName) {
  if (typeof window === 'undefined') return
  const normalizedEmail = String(email || '').trim()
  if (!normalizedEmail) return
  window.localStorage.removeItem(GUEST_CHECKOUT_OFFER_KEY)
  window.sessionStorage.setItem(GUEST_CHECKOUT_OFFER_KEY, JSON.stringify({
    email: normalizedEmail,
    fullName: String(fullName || '').trim(),
    createdAt: safeNowIso(),
  }))
}

export function loadGuestCheckoutOffer() {
  if (typeof window === 'undefined') return null
  window.localStorage.removeItem(GUEST_CHECKOUT_OFFER_KEY)
  try {
    const raw = window.sessionStorage.getItem(GUEST_CHECKOUT_OFFER_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.email || createdAtIsStale(parsed.createdAt)) {
      window.sessionStorage.removeItem(GUEST_CHECKOUT_OFFER_KEY)
      return null
    }
    return parsed
  } catch {
    window.sessionStorage.removeItem(GUEST_CHECKOUT_OFFER_KEY)
    return null
  }
}

export function clearGuestCheckoutOffer() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(GUEST_CHECKOUT_OFFER_KEY)
  window.sessionStorage.removeItem(GUEST_CHECKOUT_OFFER_KEY)
}

export function saveCompletedCheckout(checkoutRef, statusToken) {
  if (typeof window === 'undefined') return
  if (!checkoutRef || !statusToken) return

  const payload = {
    checkoutRef: String(checkoutRef),
    statusToken: String(statusToken),
    createdAt: safeNowIso(),
  }

  window.localStorage.removeItem(COMPLETED_CHECKOUT_KEY)
  window.sessionStorage.removeItem(COMPLETED_CHECKOUT_KEY)
  completedCheckoutMemory = payload
}

export function loadCompletedCheckout() {
  if (typeof window === 'undefined') return null

  window.localStorage.removeItem(COMPLETED_CHECKOUT_KEY)
  window.sessionStorage.removeItem(COMPLETED_CHECKOUT_KEY)
  if (!completedCheckoutMemory || createdAtIsStale(completedCheckoutMemory.createdAt)) {
    completedCheckoutMemory = null
    return null
  }

  return completedCheckoutMemory
}

export function clearCompletedCheckout() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(COMPLETED_CHECKOUT_KEY)
  window.sessionStorage.removeItem(COMPLETED_CHECKOUT_KEY)
  completedCheckoutMemory = null
}

async function parseResponse(response, path = '') {
  const body = await response.json().catch(() => ({}))

  if (!response.ok) {
    const rawMessage = typeof body.error === 'string' ? body.error : 'Request failed'
    const friendlyMessage = toFriendlyApiError(rawMessage, response.status)

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

async function getCsrfToken() {
  if (csrfTokenMemory) return csrfTokenMemory

  const cookieToken = getCookie('csrftoken')
  if (cookieToken) {
    csrfTokenMemory = cookieToken
    return csrfTokenMemory
  }

  const body = await getJson('/csrf/')
  csrfTokenMemory = String(body?.csrf_token || getCookie('csrftoken') || '')
  if (!csrfTokenMemory) {
    throw new Error('Missing CSRF token')
  }
  return csrfTokenMemory
}

async function postJson(path, payload, options = {}) {
  const requireCsrf = options.requireCsrf !== false
  let csrfToken = ''

  if (requireCsrf) {
    csrfToken = await getCsrfToken()
  }

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(options.headers || {}),
  }

  if (requireCsrf) {
    headers['X-CSRFToken'] = csrfToken
  }

  let response = await fetch(apiUrl(path), {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify(payload),
  })

  if (response.status === 403 && requireCsrf && options.retryCsrf !== false) {
    csrfTokenMemory = ''
    const retryToken = await getCsrfToken()
    response = await fetch(apiUrl(path), {
      method: 'POST',
      credentials: 'include',
      headers: { ...headers, 'X-CSRFToken': retryToken },
      body: JSON.stringify(payload),
    })
  }
  return parseResponse(response, path)
}

export function clearShopCsrfTokenCache() {
  csrfTokenMemory = ''
}

export function formatCurrency(amount, currencyCode = shopConfig.currencyCode) {
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

export async function createOnsitePaymentIntent(items, checkoutRef, customer, options = {}) {
  const antiBotToken = String(options.antiBotToken || '').trim()
  const statusToken = String(options.statusToken || '').trim()
  const claimToken = String(options.claimToken || '').trim()
  const payload = {
    items,
    checkoutRef,
    statusToken: statusToken || generateCapabilityToken(),
    claimToken: claimToken || generateCapabilityToken(),
    customer: {
      name: String(customer?.name || '').trim(),
      email: String(customer?.email || '').trim(),
    },
    shipping: {
      name: String(options.shipping?.name || '').trim(),
      phone: String(options.shipping?.phone || '').trim(),
      addressLine1: String(options.shipping?.addressLine1 || '').trim(),
      addressLine2: String(options.shipping?.addressLine2 || '').trim(),
      city: String(options.shipping?.city || '').trim(),
      county: String(options.shipping?.county || '').trim(),
      postcode: String(options.shipping?.postcode || '').trim(),
      countryCode: String(options.shipping?.countryCode || '').trim(),
    },
  }

  if (antiBotToken) {
    payload.antiBotToken = antiBotToken
  }

  const accessToken = String(options.accessToken || '').trim()
  const body = await postJson('/payments/onsite-intent/', payload, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  })
  return {
    checkoutRef: String(body.checkoutRef || ''),
    statusToken: String(body.statusToken || ''),
    clientSecret: String(body.clientSecret || ''),
    paymentIntentId: String(body.paymentIntentId || ''),
    orderNumber: String(body.orderNumber || ''),
    claimToken: String(body.claimToken || ''),
    amountTotalCents: Number(body.amountTotalCents || 0),
    subtotalCents: Number(body.subtotalCents || 0),
    discountCents: Number(body.discountCents || 0),
    shippingCents: Number(body.shippingCents || 0),
    taxCents: Number(body.taxCents || 0),
    currency: String(body.currency || shopConfig.currencyCode),
    lineItems: Array.isArray(body.lineItems) ? body.lineItems : [],
    priceRefreshNotice: String(body.priceRefreshNotice || ''),
  }
}

export async function getOnsiteCheckoutStatus(checkoutRef, statusToken) {
  const ref = String(checkoutRef || '').trim()
  const token = String(statusToken || '').trim()
  if (!ref) {
    throw new Error('checkoutRef is required')
  }
  if (!token) {
    throw new Error('statusToken is required')
  }

  const body = await postJson('/payments/onsite-status/', {
    checkoutRef: ref,
    statusToken: token,
  })
  return {
    checkoutRef: String(body.checkoutRef || ''),
    status: String(body.status || ''),
    paidAt: body.paidAt || null,
    amountTotalCents: Number(body.amountTotalCents || 0),
    currency: String(body.currency || shopConfig.currencyCode),
  }
}

export async function getOnsiteOrderSummary(checkoutRef, statusToken) {
  const ref = String(checkoutRef || '').trim()
  const token = String(statusToken || '').trim()
  if (!ref) {
    throw new Error('checkoutRef is required')
  }
  if (!token) {
    throw new Error('statusToken is required')
  }

  const body = await postJson('/payments/onsite-order-summary/', {
    checkoutRef: ref,
    statusToken: token,
  })
  return {
    checkoutRef: String(body.checkoutRef || ''),
    status: String(body.status || ''),
    customerName: String(body.customerName || ''),
    customerEmail: String(body.customerEmail || ''),
    lineItems: Array.isArray(body.lineItems) ? body.lineItems : [],
    amountTotalCents: Number(body.amountTotalCents || 0),
    currency: String(body.currency || shopConfig.currencyCode),
    paidAt: body.paidAt || null,
    createdAt: body.createdAt || null,
    shippingName: String(body.shippingName || ''),
    shippingPhone: String(body.shippingPhone || ''),
    shippingAddressLine1: String(body.shippingAddressLine1 || ''),
    shippingAddressLine2: String(body.shippingAddressLine2 || ''),
    shippingCity: String(body.shippingCity || ''),
    shippingCounty: String(body.shippingCounty || ''),
    shippingPostcode: String(body.shippingPostcode || ''),
    shippingCountryCode: String(body.shippingCountryCode || ''),
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
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const parsedPrice = Number(item.price)
      const parsedQuantity = Number(item.quantity)
      const safePrice = Number.isFinite(parsedPrice) && parsedPrice > 0 ? parsedPrice : 0
      const safeQuantity = Number.isFinite(parsedQuantity) && parsedQuantity > 0 ? Math.min(99, Math.floor(parsedQuantity)) : 0

      return {
        handle: String(item.handle || ''),
        title: String(item.title || ''),
        variantId: String(item.variantId || ''),
        price: safePrice,
        currency: String(item.currency || shopConfig.currencyCode),
        imageUrl: String(item.imageUrl || ''),
        quantity: safeQuantity,
      }
    })
    .filter((item) => item.handle && item.variantId && item.quantity > 0 && item.price > 0)
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
