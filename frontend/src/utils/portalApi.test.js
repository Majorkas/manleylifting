import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearPortalSession,
  createPortalEquipment,
  createStaffAssignment,
  getAccountBootstrap,
  getPortalMe,
  portalLogin,
  registerCommerceAccount,
  resendCommerceVerification,
  savePortalAccessToken,
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
      },
    })
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
