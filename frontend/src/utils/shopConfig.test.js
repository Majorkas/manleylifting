import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CART_STORAGE_KEY,
  clearShopCsrfTokenCache,
  clearPendingCheckout,
  clearPendingOrderClaim,
  clearCompletedCheckout,
  createOnsitePaymentIntent,
  getOnsiteCheckoutStatus,
  generateCapabilityToken,
  getStockStatus,
  loadGuestCheckoutOffer,
  loadCartItems,
  loadPendingCheckout,
  loadPendingOrderClaim,
  savePendingCheckout,
  savePendingOrderClaim,
  saveGuestCheckoutOffer,
} from './shopConfig'

describe('shopConfig cart normalization', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    clearShopCsrfTokenCache()
    clearPendingCheckout()
    clearPendingOrderClaim()
    clearCompletedCheckout()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('clamps and filters malformed cart data from storage', () => {
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify([
        {
          handle: 'chain-block',
          title: 'Chain Block',
          variantId: 'variant-1',
          price: '12.50',
          currency: 'EUR',
          quantity: '4',
        },
        {
          handle: 'rope-sling',
          title: 'Rope Sling',
          variantId: 'variant-2',
          price: '-1',
          currency: 'EUR',
          quantity: '0',
        },
        {
          handle: 'bad-item',
          title: 'Bad Item',
          variantId: '',
          price: 'NaN',
          currency: 'EUR',
          quantity: '2',
        },
        {
          handle: 'heavy-duty',
          title: 'Heavy Duty',
          variantId: 'variant-3',
          price: '5',
          currency: 'EUR',
          quantity: '120',
        },
        'not-an-object',
      ]),
    )

    expect(loadCartItems()).toEqual([
      {
        handle: 'chain-block',
        title: 'Chain Block',
        variantId: 'variant-1',
        price: 12.5,
        currency: 'EUR',
        imageUrl: '',
        quantity: 4,
      },
      {
        handle: 'heavy-duty',
        title: 'Heavy Duty',
        variantId: 'variant-3',
        price: 5,
        currency: 'EUR',
        imageUrl: '',
        quantity: 99,
      },
    ])
  })

  it('keeps checkout capability tokens out of browser storage', () => {
    savePendingCheckout('checkout-1', 'status-token-1')
    savePendingOrderClaim('MNL-1', 'claim-token-1', 'checkout-1', 'status-token-1')

    expect(window.localStorage.getItem('manley-shop-pending-checkout-v1')).toBeNull()
    expect(window.localStorage.getItem('manley-shop-pending-order-claim-v1')).toBeNull()
    expect(window.sessionStorage.getItem('manley-shop-pending-checkout-v1')).toBeNull()
    expect(window.sessionStorage.getItem('manley-shop-pending-order-claim-v1')).toBeNull()
    expect(loadPendingCheckout()).toEqual(expect.objectContaining({
      checkoutRef: 'checkout-1',
      statusToken: 'status-token-1',
    }))
  })

  it('generates high-entropy URL-safe capability tokens', () => {
    const first = generateCapabilityToken()
    const second = generateCapabilityToken()

    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(second).toMatch(/^[a-f0-9]{64}$/)
    expect(first).not.toBe(second)
  })

  it('expires stale pending order claims from session storage', () => {
    window.sessionStorage.setItem(
      'manley-shop-pending-order-claim-v1',
      JSON.stringify({
        orderNumber: 'MNL-STALE',
        claimToken: 'a'.repeat(64),
        createdAt: new Date(Date.now() - (3 * 60 * 60 * 1000)).toISOString(),
      }),
    )

    expect(loadPendingOrderClaim()).toBeNull()
    expect(window.sessionStorage.getItem('manley-shop-pending-order-claim-v1')).toBeNull()
  })

  it('stores guest offers only for the current tab and expires stale PII', () => {
    saveGuestCheckoutOffer('guest@example.com', 'Guest Customer')
    expect(window.localStorage.getItem('manley-guest-checkout-offer')).toBeNull()
    expect(loadGuestCheckoutOffer()).toEqual(expect.objectContaining({
      email: 'guest@example.com',
      fullName: 'Guest Customer',
    }))

    window.sessionStorage.setItem('manley-guest-checkout-offer', JSON.stringify({
      email: 'stale@example.com',
      fullName: 'Stale Customer',
      createdAt: new Date(Date.now() - (3 * 60 * 60 * 1000)).toISOString(),
    }))
    expect(loadGuestCheckoutOffer()).toBeNull()
  })

  it('refreshes a rejected CSRF token once before retrying a shop POST', async () => {
    const jsonResponse = (status, body) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(200, { csrf_token: 'old-token' }))
      .mockResolvedValueOnce(jsonResponse(403, { error: 'CSRF failed' }))
      .mockResolvedValueOnce(jsonResponse(200, { csrf_token: 'new-token' }))
      .mockResolvedValueOnce(jsonResponse(200, {
        checkoutRef: 'checkout-1',
        status: 'pending',
        amountTotalCents: 1000,
        currency: 'EUR',
      }))

    await expect(getOnsiteCheckoutStatus('checkout-1', 'a'.repeat(64))).resolves.toEqual(
      expect.objectContaining({ status: 'pending' }),
    )
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock.mock.calls[1][1].headers['X-CSRFToken']).toBe('old-token')
    expect(fetchMock.mock.calls[3][1].headers['X-CSRFToken']).toBe('new-token')
  })

  it('forwards the in-memory access token for authenticated checkout ownership', async () => {
    const jsonResponse = (status, body) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(200, { csrf_token: 'csrf-token' }))
      .mockResolvedValueOnce(jsonResponse(200, {
        checkoutRef: 'checkout-auth',
        statusToken: 'a'.repeat(64),
        claimToken: 'b'.repeat(64),
        clientSecret: 'pi_secret',
        paymentIntentId: 'pi_auth',
      }))

    await createOnsitePaymentIntent(
      [{ variantId: 'variant-1', quantity: 1 }],
      'checkout-auth',
      { name: 'Jane Doe', email: 'jane@example.com' },
      {
        accessToken: 'access-token',
        statusToken: 'a'.repeat(64),
        claimToken: 'b'.repeat(64),
      },
    )

    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer access-token')
  })

  it('preserves server pricing breakdown fields from checkout intent', async () => {
    const jsonResponse = (status, body) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(200, { csrf_token: 'csrf-token' }))
      .mockResolvedValueOnce(jsonResponse(200, {
        checkoutRef: 'checkout-pricing',
        statusToken: 'a'.repeat(64),
        claimToken: 'b'.repeat(64),
        clientSecret: 'secret',
        amountTotalCents: 2299,
        subtotalCents: 1000,
        discountCents: 0,
        shippingCents: 1299,
        taxCents: 0,
      }))

    const result = await createOnsitePaymentIntent(
      [{ variantId: 'variant-1', quantity: 1 }],
      'checkout-pricing',
      { name: 'Jane Doe', email: 'jane@example.com' },
      { statusToken: 'a'.repeat(64), claimToken: 'b'.repeat(64) },
    )

    expect(result.shippingCents).toBe(1299)
    expect(result.subtotalCents).toBe(1000)
    expect(result.amountTotalCents).toBe(2299)
  })
})

describe('shopConfig stock presentation', () => {
  it('describes healthy tracked stock', () => {
    expect(getStockStatus({ inventoryTracked: true, availableQty: 12 })).toEqual({
      label: 'In stock',
      detail: '12 available',
      tone: 'positive',
      canAdd: true,
    })
  })

  it('shows quantities below five as low stock', () => {
    expect(getStockStatus({ inventoryTracked: true, availableQty: 3 })).toEqual({
      label: 'Low stock',
      detail: 'Only 3 left',
      tone: 'caution',
      canAdd: true,
    })
  })

  it('keeps five remaining units in stock', () => {
    expect(getStockStatus({ inventoryTracked: true, availableQty: 5 })).toEqual({
      label: 'In stock',
      detail: '5 available',
      tone: 'positive',
      canAdd: true,
    })
  })

  it('blocks an out-of-stock tracked product', () => {
    expect(getStockStatus({ inventoryTracked: true, availableQty: 0 })).toEqual({
      label: 'Out of stock',
      detail: 'Currently unavailable',
      tone: 'negative',
      canAdd: false,
    })
  })

  it('blocks a finite product with no remaining quantity', () => {
    expect(getStockStatus({ inventoryTracked: false, stockPolicy: 'finite', availableQty: 0 })).toEqual({
      label: 'Out of stock',
      detail: 'Currently unavailable',
      tone: 'negative',
      canAdd: false,
    })
  })

  it('treats legacy untracked products as out of stock until inventory is configured', () => {
    expect(getStockStatus({ inventoryTracked: false, stockPolicy: 'untracked', availableQty: 0 })).toEqual({
      label: 'Out of stock',
      detail: 'Currently unavailable',
      tone: 'negative',
      canAdd: false,
    })
  })

  it('blocks products explicitly marked unavailable', () => {
    expect(getStockStatus({ inventoryTracked: false, stockPolicy: 'unavailable' })).toEqual({
      label: 'Unavailable',
      detail: 'Contact us for availability',
      tone: 'negative',
      canAdd: false,
    })
  })
})
