import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AccountLoginPage from './AccountLoginPage'
import AccountRegisterPage from './AccountRegisterPage'
import AccountVerifyEmailPage from './AccountVerifyEmailPage'
import {
  getAccountBootstrap,
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
  getAccountBootstrap: vi.fn(),
  portalLogin: vi.fn(),
  registerCommerceAccount: vi.fn(),
  verifyCommerceEmail: vi.fn(),
}))

describe('account lifecycle pages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/')
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
})
