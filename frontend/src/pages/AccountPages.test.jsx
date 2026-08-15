import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AccountLoginPage from './AccountLoginPage'
import AccountMfaChallengePage from './AccountMfaChallengePage'
import AccountRegisterPage from './AccountRegisterPage'
import AccountResetPasswordPage from './AccountResetPasswordPage'
import AccountChangeEmailPage from './AccountChangeEmailPage'
import AccountVerifyEmailPage from './AccountVerifyEmailPage'
import AccountAddressesPage from './AccountAddressesPage'
import {
  completeAccountEmailChange,
  completeCommercePasswordReset,
  deleteAccountAddress,
  getAccountAddresses,
  getAccountBootstrap,
  hasPortalSession,
  portalLogin,
  registerCommerceAccount,
  verifyCommerceEmail,
} from '../utils/portalApi'

vi.mock('../components/AccountLayout', () => ({
  default: ({ title, children }) => <main><h1>{title}</h1>{children}</main>,
}))

vi.mock('../components/TurnstileWidget', () => ({
  default: () => null,
}))

vi.mock('../utils/portalApi', () => ({
  completeAccountEmailChange: vi.fn(),
  completeCommercePasswordReset: vi.fn(),
  deleteAccountAddress: vi.fn(),
  getAccountAddresses: vi.fn(),
  getAccountBootstrap: vi.fn(),
  hasPortalSession: vi.fn(),
  portalLogin: vi.fn(),
  registerCommerceAccount: vi.fn(),
  verifyCommerceEmail: vi.fn(),
}))

describe('account lifecycle pages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/')
    hasPortalSession.mockReturnValue(false)
  })

  it('submits registration with password confirmation and legal consent', async () => {
    const user = userEvent.setup()
    registerCommerceAccount.mockResolvedValue({ detail: 'Check your email.' })
    render(<MemoryRouter><AccountRegisterPage /></MemoryRouter>)

    await user.type(screen.getByLabelText('Email'), 'customer@example.com')
    await user.type(screen.getByLabelText('Password'), 'A-Strong-Commerce-Password-123!')
    await user.type(screen.getByLabelText('Confirm password'), 'A-Strong-Commerce-Password-123!')
    await user.click(screen.getByText(/I accept the/))
    await user.click(screen.getByText(/I have read the/))
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(registerCommerceAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'customer@example.com',
        password: 'A-Strong-Commerce-Password-123!',
        acceptTerms: true,
        acceptPrivacy: true,
      }),
    ))
    expect(await screen.findByText('Verification requested')).toBeInTheDocument()
  })

  it('removes the verification token fragment before confirming the account', async () => {
    window.history.replaceState({}, '', '/account/verify-email#token=secret-token')
    verifyCommerceEmail.mockResolvedValue({ ok: true })
    render(<MemoryRouter><AccountVerifyEmailPage /></MemoryRouter>)

    expect(await screen.findByText('Account activated')).toBeInTheDocument()
    expect(verifyCommerceEmail).toHaveBeenCalledWith('secret-token')
    expect(window.location.hash).toBe('')
  })

  it('preserves a safe redirect through verify-email completion sign-in CTA', async () => {
    window.history.replaceState({}, '', '/account/verify-email?redirect=/portal#token=verify-token')
    verifyCommerceEmail.mockResolvedValue({ ok: true })
    render(
      <MemoryRouter initialEntries={['/account/verify-email?redirect=/portal#token=verify-token']}>
        <AccountVerifyEmailPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Account activated')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/account/login?redirect=%2Fportal')
  })

  it('rejects external verify-email redirect and falls back to account sign-in', async () => {
    window.history.replaceState({}, '', '/account/verify-email?redirect=https://attacker.example#token=verify-token')
    verifyCommerceEmail.mockResolvedValue({ ok: true })
    render(
      <MemoryRouter initialEntries={['/account/verify-email?redirect=https://attacker.example#token=verify-token']}>
        <AccountVerifyEmailPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Account activated')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/account/login?redirect=%2Faccount')
  })

  it('preserves a safe redirect through password-reset completion sign-in CTA', async () => {
    window.history.replaceState({}, '', '/account/reset-password?redirect=/checkout#token=reset-token')
    completeCommercePasswordReset.mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/account/reset-password?redirect=/checkout#token=reset-token']}>
        <AccountResetPasswordPage />
      </MemoryRouter>,
    )

    await user.type(screen.getByLabelText('New password'), 'Reset-Strong-Password-123!')
    await user.type(screen.getByLabelText('Confirm password'), 'Reset-Strong-Password-123!')
    await user.click(screen.getByRole('button', { name: 'Update password' }))

    expect(await screen.findByText(/Your password has been updated/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in with new password' })).toHaveAttribute('href', '/account/login?redirect=%2Fcheckout')
  })

  it('rejects external password-reset redirect and falls back to account sign-in', async () => {
    window.history.replaceState({}, '', '/account/reset-password?redirect=https://attacker.example#token=reset-token')
    render(
      <MemoryRouter initialEntries={['/account/reset-password?redirect=https://attacker.example#token=reset-token']}>
        <AccountResetPasswordPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Sign in with new password' })).toHaveAttribute('href', '/account/login?redirect=%2Faccount')
  })

  it('preserves a safe redirect through email-change completion sign-in CTA', async () => {
    window.history.replaceState({}, '', '/account/change-email?redirect=/shop#token=change-token')
    completeAccountEmailChange.mockResolvedValue({ ok: true })
    render(
      <MemoryRouter initialEntries={['/account/change-email?redirect=/shop#token=change-token']}>
        <AccountChangeEmailPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Email change confirmed')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/account/login?redirect=%2Fshop')
  })

  it('rejects external email-change redirect and falls back to account sign-in', async () => {
    window.history.replaceState({}, '', '/account/change-email?redirect=https://attacker.example#token=change-token')
    completeAccountEmailChange.mockResolvedValue({ ok: true })
    render(
      <MemoryRouter initialEntries={['/account/change-email?redirect=https://attacker.example#token=change-token']}>
        <AccountChangeEmailPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Email change confirmed')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/account/login?redirect=%2Faccount')
  })

  it('rejects an external login redirect and uses account capabilities', async () => {
    const user = userEvent.setup()
    portalLogin.mockResolvedValue({ access: 'access-token' })
    getAccountBootstrap.mockResolvedValue({
      capabilities: { canShop: true, canViewOrders: true, canAccessPortal: false },
    })
    render(
      <MemoryRouter initialEntries={['/account/login?redirect=https://attacker.example']}>
        <Routes>
          <Route path="/account/login" element={<AccountLoginPage />} />
          <Route path="/account" element={<div>Account Home</div>} />
        </Routes>
      </MemoryRouter>,
    )

    await user.type(screen.getByLabelText('Email or portal username'), 'customer@example.com')
    await user.type(screen.getByLabelText('Password'), 'A-Strong-Commerce-Password-123!')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Account Home')).toBeInTheDocument()
    expect(portalLogin).toHaveBeenCalledWith(
      'customer@example.com',
      'A-Strong-Commerce-Password-123!',
    )
  })

  it('returns an authenticated user from the login route to account profile', async () => {
    hasPortalSession.mockReturnValue(true)
    getAccountBootstrap.mockResolvedValue({
      capabilities: { canShop: true, canViewOrders: true, canAccessPortal: false },
    })

    render(
      <MemoryRouter initialEntries={['/account/login']}>
        <Routes>
          <Route path="/account/login" element={<AccountLoginPage />} />
          <Route path="/account" element={<div>Account Profile</div>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Account Profile')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument()
  })

  it('keeps operations-capability users on the generic account home by default', async () => {
    const user = userEvent.setup()
    portalLogin.mockResolvedValue({ access: 'access-token' })
    getAccountBootstrap.mockResolvedValue({
      capabilities: {
        canShop: false,
        canViewOrders: false,
        canAccessPortal: true,
        canFulfillOrders: true,
      },
    })
    render(
      <MemoryRouter initialEntries={['/account/login']}>
        <Routes>
          <Route path="/account/login" element={<AccountLoginPage />} />
          <Route path="/account" element={<div>Account Home</div>} />
          <Route path="/portal" element={<div>Portal Home</div>} />
        </Routes>
      </MemoryRouter>,
    )

    await user.type(screen.getByLabelText('Email or portal username'), 'demo_owner')
    await user.type(screen.getByLabelText('Password'), 'DemoPass!234')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Account Home')).toBeInTheDocument()
    expect(screen.queryByText('Portal Home')).not.toBeInTheDocument()
    expect(portalLogin).toHaveBeenCalledWith('demo_owner', 'DemoPass!234')
  })

  it('preserves a safe internal redirect after account login', async () => {
    const user = userEvent.setup()
    portalLogin.mockResolvedValue({ access: 'access-token' })
    getAccountBootstrap.mockResolvedValue({
      capabilities: { canShop: true, canViewOrders: true, canAccessPortal: false },
    })
    render(
      <MemoryRouter initialEntries={['/account/login?redirect=/account/orders']}>
        <Routes>
          <Route path="/account/login" element={<AccountLoginPage />} />
          <Route path="/account/orders" element={<div>Orders Home</div>} />
          <Route path="/account" element={<div>Account Home</div>} />
        </Routes>
      </MemoryRouter>,
    )

    await user.type(screen.getByLabelText('Email or portal username'), 'customer@example.com')
    await user.type(screen.getByLabelText('Password'), 'A-Strong-Commerce-Password-123!')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Orders Home')).toBeInTheDocument()
    expect(screen.queryByText('Account Home')).not.toBeInTheDocument()
  })

  it('redirects to MFA challenge when login requires a code and blocks account access until verified', async () => {
    const user = userEvent.setup()
    portalLogin
      .mockRejectedValueOnce({
        message: 'Multi-factor authentication code is required',
        body: { detail: 'Multi-factor authentication code is required' },
      })
      .mockResolvedValueOnce({ access: 'access-token' })
    getAccountBootstrap.mockResolvedValue({
      capabilities: { canShop: true, canViewOrders: true, canAccessPortal: false },
    })

    render(
      <MemoryRouter initialEntries={['/account/login?redirect=/account/orders']}>
        <Routes>
          <Route path="/account/login" element={<AccountLoginPage />} />
          <Route path="/account/login/mfa" element={<AccountMfaChallengePage />} />
          <Route path="/account/orders" element={<div>Orders Home</div>} />
          <Route path="/account" element={<div>Account Home</div>} />
        </Routes>
      </MemoryRouter>,
    )

    await user.type(screen.getByLabelText('Email or portal username'), 'customer@example.com')
    await user.type(screen.getByLabelText('Password'), 'A-Strong-Commerce-Password-123!')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Enter security code')).toBeInTheDocument()
    expect(screen.queryByText('Orders Home')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('MFA code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }))

    await waitFor(() => {
      expect(portalLogin).toHaveBeenNthCalledWith(2, 'customer@example.com', 'A-Strong-Commerce-Password-123!', '123456')
    })
    expect(await screen.findByText('Orders Home')).toBeInTheDocument()
  })

  it('lands portal-linked users on the generic account home by default', async () => {
    const user = userEvent.setup()
    portalLogin.mockResolvedValue({ access: 'access-token' })
    getAccountBootstrap.mockResolvedValue({
      capabilities: { canShop: true, canViewOrders: true, canAccessPortal: true },
    })
    render(
      <MemoryRouter initialEntries={['/account/login']}>
        <Routes>
          <Route path="/account/login" element={<AccountLoginPage />} />
          <Route path="/account" element={<div>Account Home</div>} />
          <Route path="/portal" element={<div>Portal Home</div>} />
        </Routes>
      </MemoryRouter>,
    )

    await user.type(screen.getByLabelText('Email or portal username'), 'customer@example.com')
    await user.type(screen.getByLabelText('Password'), 'A-Strong-Commerce-Password-123!')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Account Home')).toBeInTheDocument()
    expect(screen.queryByText('Portal Home')).not.toBeInTheDocument()
  })

  it('shows a recently saved checkout address immediately from local storage', async () => {
    window.localStorage.setItem('manley-recent-account-address', JSON.stringify({
      label: 'Checkout address',
      recipientName: 'Guest User',
      recipientPhone: '+353871234567',
      addressLine1: '10 Harbour Road',
      addressLine2: 'Apartment 2',
      city: 'Cork',
      county: 'Cork',
      postcode: 'T12 3AB',
      countryCode: 'IE',
      isDefaultShipping: true,
      isDefaultBilling: false,
    }))
    getAccountAddresses.mockResolvedValue([])

    render(<MemoryRouter><AccountAddressesPage /></MemoryRouter>)

    expect(await screen.findByText('Checkout address')).toBeInTheDocument()
    expect(screen.getByText(/10 Harbour Road/i)).toBeInTheDocument()
  })

  it('shows inline validation feedback and default-shipping badges for saved addresses', async () => {
    const user = userEvent.setup()
    getAccountAddresses.mockResolvedValue([
      {
        id: 7,
        label: 'Home',
        recipientName: 'Customer Example',
        addressLine1: '1 Main Street',
        city: 'Leeds',
        postcode: 'LS1 1AA',
        countryCode: 'GB',
        isDefaultShipping: true,
        isDefaultBilling: false,
      },
    ])

    render(<MemoryRouter><AccountAddressesPage /></MemoryRouter>)

    expect(await screen.findByText('Default shipping')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save address' }))

    expect(await screen.findByText(/Please complete the required fields/i)).toBeInTheDocument()
  })

  it('asks for confirmation before removing an address and shows a success toast', async () => {
    const user = userEvent.setup()
    deleteAccountAddress.mockResolvedValue({ ok: true })
    getAccountAddresses.mockResolvedValue([
      {
        id: 7,
        label: 'Home',
        recipientName: 'Customer Example',
        addressLine1: '1 Main Street',
        city: 'Leeds',
        postcode: 'LS1 1AA',
        countryCode: 'GB',
        isDefaultShipping: true,
        isDefaultBilling: false,
      },
    ])

    render(<MemoryRouter><AccountAddressesPage /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: 'Remove' }))

    expect(screen.getByText(/Remove this address/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm remove' }))

    expect(deleteAccountAddress).toHaveBeenCalledWith(7)
    expect(await screen.findByText('Address removed.')).toBeInTheDocument()
  })
})
