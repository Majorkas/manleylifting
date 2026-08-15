import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  claimGuestOrder,
  clearPortalSession,
  createAccountAddress,
  createPortalEquipment,
  createStaffAssignment,
  deleteAccountAddress,
  getAccountAddresses,
  getAccountBootstrap,
  getAccountOrders,
  getPortalMe,
  portalLogin,
  registerCommerceAccount,
  resendCommerceVerification,
  savePortalAccessToken,
  updateAccountAddress,
  updatePortalCustomer,
  verifyCommerceEmail,
} from './portalApi'

function mockJsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  }
}

describe('portalApi error messaging', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    const storage = {}
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: vi.fn((key) => (Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null)),
        setItem: vi.fn((key, value) => {
          storage[key] = String(value)
        }),
        removeItem: vi.fn((key) => {
          delete storage[key]
        }),
        clear: vi.fn(() => {
          for (const key of Object.keys(storage)) {
            delete storage[key]
          }
        }),
      },
    })
    clearPortalSession()
    window.localStorage.clear()
    document.cookie = 'csrftoken=test-csrf-token; path=/'
    globalThis.fetch = vi.fn()
  })

  it('shows generic login message for invalid credentials', async () => {
    fetch.mockResolvedValueOnce(mockJsonResponse(400, { detail: 'Invalid credentials' }))

    await expect(portalLogin('wrong_user', 'password123')).rejects.toThrow(
      'Username or password is incorrect. Try again.',
    )
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/token/'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-CSRFToken': 'test-csrf-token' }),
      }),
    )
  })

  it('uses the CSRF seed response when the API cookie is not readable', async () => {
    document.cookie = 'csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
    clearPortalSession()
    fetch
      .mockResolvedValueOnce(mockJsonResponse(200, { ok: true, csrf_token: 'seeded-csrf-token' }))
      .mockResolvedValueOnce(mockJsonResponse(200, { access: 'access-token' }))

    await portalLogin('owner', 'password123')

    expect(fetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/auth/token/'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-CSRFToken': 'seeded-csrf-token' }),
      }),
    )
  })

  it('includes mfa_code in login payload when provided', async () => {
    fetch.mockResolvedValueOnce(mockJsonResponse(200, { access: 'access-token' }))

    await portalLogin('owner', 'password123', ' 123456 ')

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/auth/token/'),
      expect.objectContaining({
        body: JSON.stringify({
          username: 'owner',
          password: 'password123',
          mfa_code: '123456',
        }),
      }),
    )
  })

  it('submits commerce registration using the CSRF-protected account contract', async () => {
    fetch.mockResolvedValueOnce(mockJsonResponse(202, { detail: 'Check your email.' }))

    await registerCommerceAccount({
      email: ' customer@example.com ',
      password: 'A-Strong-Password-123!',
      firstName: 'Customer',
      lastName: 'Example',
      acceptTerms: true,
      acceptPrivacy: true,
      turnstileToken: 'turnstile-token',
    })

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/account/register/'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-CSRFToken': 'test-csrf-token' }),
        body: JSON.stringify({
          email: 'customer@example.com',
          password: 'A-Strong-Password-123!',
          first_name: 'Customer',
          last_name: 'Example',
          accept_terms: true,
          accept_privacy: true,
          turnstile_token: 'turnstile-token',
        }),
      }),
    )
  })

  it('submits verification and resend tokens only in JSON bodies', async () => {
    fetch
      .mockResolvedValueOnce(mockJsonResponse(200, { ok: true }))
      .mockResolvedValueOnce(mockJsonResponse(202, { detail: 'Check your email.' }))

    await verifyCommerceEmail(' secret-verification-token ')
    await resendCommerceVerification(' customer@example.com ', 'turnstile-token')

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/account/verify-email/'),
      expect.objectContaining({ body: JSON.stringify({ token: 'secret-verification-token' }) }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/account/resend-verification/'),
      expect.objectContaining({
        body: JSON.stringify({
          email: 'customer@example.com',
          turnstile_token: 'turnstile-token',
        }),
      }),
    )
    expect(fetch.mock.calls.flat().join(' ')).not.toContain('?token=')
  })

  it('maps the minimal shared account bootstrap response', async () => {
    savePortalAccessToken('test-access-token')
    fetch.mockResolvedValueOnce(mockJsonResponse(200, {
      username: 'commerce_internal',
      email: 'customer@example.com',
      full_name: 'Customer Example',
      email_verified: true,
      capabilities: {
        can_shop: true,
        can_view_orders: true,
        can_access_portal: false,
        can_fulfill_orders: false,
      },
    }))

    await expect(getAccountBootstrap()).resolves.toEqual({
      username: 'commerce_internal',
      email: 'customer@example.com',
      fullName: 'Customer Example',
      emailVerified: true,
      capabilities: {
        canShop: true,
        canViewOrders: true,
        canAccessPortal: false,
        canFulfillOrders: false,
      },
    })
  })

  it('loads account orders and addresses through the authenticated account API', async () => {
    savePortalAccessToken('test-access-token')
    fetch
      .mockResolvedValueOnce(mockJsonResponse(200, [{
        checkoutRef: 'chk_123',
        status: 'paid',
        customerName: 'Customer Example',
        customerEmail: 'customer@example.com',
        lineItems: [{ name: 'Rope sling', quantity: 1 }],
        amountTotalCents: 15000,
        currency: 'GBP',
        createdAt: '2024-01-01T00:00:00Z',
        shippingName: 'Customer Example',
        shippingPhone: '07123456789',
        shippingAddressLine1: '1 Main Street',
        shippingCity: 'Leeds',
        shippingPostcode: 'LS1 1AA',
        shippingCountryCode: 'GB',
      }]))
      .mockResolvedValueOnce(mockJsonResponse(200, [{
        id: 7,
        label: 'Home',
        recipientName: 'Customer Example',
        recipientPhone: '07123456789',
        addressLine1: '1 Main Street',
        addressLine2: 'Unit 2',
        city: 'Leeds',
        county: 'West Yorkshire',
        postcode: 'LS1 1AA',
        countryCode: 'GB',
        isDefaultShipping: true,
        isDefaultBilling: false,
      }]))

    await expect(getAccountOrders()).resolves.toEqual([expect.objectContaining({
      checkoutRef: 'chk_123',
      shippingName: 'Customer Example',
      shippingAddressLine1: '1 Main Street',
      shippingCity: 'Leeds',
      shippingPostcode: 'LS1 1AA',
      shippingCountryCode: 'GB',
    })])
    await expect(getAccountAddresses()).resolves.toEqual([expect.objectContaining({ id: 7, label: 'Home' })])
  })

  it('submits guest-order claims through the secured account API', async () => {
    savePortalAccessToken('test-access-token')
    fetch.mockResolvedValueOnce(mockJsonResponse(200, { ok: true, orderNumber: 'MNL-260805-ABC123' }))

    await expect(claimGuestOrder('MNL-260805-ABC123', 'claim-token-123')).resolves.toEqual({
      ok: true,
      orderNumber: 'MNL-260805-ABC123',
    })

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/account/claim-order/'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          orderNumber: 'MNL-260805-ABC123',
          claimToken: 'claim-token-123',
        }),
      }),
    )
  })

  it('submits a new address through the secured account API', async () => {
    savePortalAccessToken('test-access-token')
    fetch.mockResolvedValueOnce(mockJsonResponse(201, {
      id: 9,
      label: 'Work',
      recipientName: 'Customer Example',
      addressLine1: '2 Other Street',
      city: 'Manchester',
      postcode: 'M1 1AA',
      countryCode: 'GB',
      isDefaultShipping: false,
      isDefaultBilling: false,
    }))

    await createAccountAddress({
      label: 'Work',
      recipientName: 'Customer Example',
      addressLine1: '2 Other Street',
      city: 'Manchester',
      postcode: 'M1 1AA',
      countryCode: 'GB',
    })

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/account/addresses/'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"label":"Work"'),
      }),
    )
  })

  it('updates and removes addresses through the secured account API', async () => {
    savePortalAccessToken('test-access-token')
    fetch
      .mockResolvedValueOnce(mockJsonResponse(200, { id: 7, label: 'Home' }))
      .mockResolvedValueOnce(mockJsonResponse(200, { ok: true }))

    await updateAccountAddress(7, { label: 'Home' })
    await deleteAccountAddress(7)

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/account/addresses/7/'),
      expect.objectContaining({ method: 'PATCH', body: expect.stringContaining('"label":"Home"') }),
    )
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/account/addresses/7/'),
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('shows username suggestion when backend provides one', async () => {
    savePortalAccessToken('test-access-token')
    fetch.mockResolvedValueOnce(
      mockJsonResponse(400, {
        detail: 'Username is unavailable',
        suggested_username: 'ops_staff2',
      }),
    )

    await expect(
      createStaffAssignment({
        username: 'ops_staff',
        email: 'ops_staff@example.com',
        password: 'StrongPass!234',
      }),
    ).rejects.toThrow("That username is already taken. Try 'ops_staff2' instead.")
  })

  it('formats validation dictionary errors with field labels', async () => {
    savePortalAccessToken('test-access-token')
    fetch.mockResolvedValueOnce(
      mockJsonResponse(400, {
        company_name: ['This field may not be blank.'],
      }),
    )

    await expect(
      updatePortalCustomer({
        company_id: 1,
        company_name: '',
      }),
    ).rejects.toThrow('Company name: This field may not be blank.')
  })

  it('maps invalid status detail to a clear next step', async () => {
    savePortalAccessToken('test-access-token')
    fetch.mockResolvedValueOnce(mockJsonResponse(400, { detail: 'Invalid status value' }))

    await expect(
      createPortalEquipment({
        company_id: 1,
        name: 'Demo Equipment',
        status: 'not-real',
      }),
    ).rejects.toThrow(
      'The selected status is invalid. Choose one of the available status options and retry.',
    )
  })

  it('returns a session-expired message for portal 401 responses', async () => {
    fetch.mockResolvedValueOnce(mockJsonResponse(401, { detail: 'Authentication credentials were not provided.' }))

    await expect(getPortalMe()).rejects.toThrow('Your session has expired. Please sign in again.')
  })

  it('returns permission guidance for 403 responses', async () => {
    savePortalAccessToken('test-access-token')
    fetch.mockResolvedValueOnce(mockJsonResponse(403, { detail: 'Only owner can create customers' }))

    await expect(
      updatePortalCustomer({
        company_id: 1,
        company_name: 'Acme',
      }),
    ).rejects.toThrow(
      'You do not have permission to perform this action. Contact an account owner if you need access.',
    )
  })

  it('shows temporary lockout guidance for repeated failed logins', async () => {
    fetch.mockResolvedValueOnce(
      mockJsonResponse(400, {
        detail: 'Account temporarily locked due to failed login attempts. Try again in 15 minutes.',
      }),
    )

    await expect(portalLogin('owner', 'wrong-password')).rejects.toThrow(
      'Too many failed sign-in attempts. Please wait 15 minutes and try again.',
    )
  })

  it('maps certificate content mismatch error to clear guidance', async () => {
    savePortalAccessToken('test-access-token')
    fetch.mockResolvedValueOnce(
      mockJsonResponse(400, {
        detail: 'Certificate file content does not match the file extension',
      }),
    )

    await expect(
      createPortalEquipment({
        company_id: 1,
        name: 'Demo Equipment',
      }),
    ).rejects.toThrow('The certificate file content does not match its extension. Upload a valid PDF or image file.')
  })

  it('maps report image content mismatch error to clear guidance', async () => {
    savePortalAccessToken('test-access-token')
    fetch.mockResolvedValueOnce(
      mockJsonResponse(400, {
        detail: 'Report image content does not match the file extension',
      }),
    )

    await expect(
      createPortalEquipment({
        company_id: 1,
        name: 'Demo Equipment',
      }),
    ).rejects.toThrow('One or more report images are invalid. Upload valid PNG, JPG, JPEG, or WEBP files only.')
  })
})
