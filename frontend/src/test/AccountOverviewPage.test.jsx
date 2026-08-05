import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AccountOverviewPage from '../pages/AccountOverviewPage'
import * as portalApi from '../utils/portalApi'

vi.mock('../components/AccountLayout', () => ({
  default: ({ children, title }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}))

vi.mock('../utils/usePageMeta', () => ({
  default: () => undefined,
}))

vi.mock('../utils/portalApi', () => ({
  changeAccountPassword: vi.fn(),
  deleteAccount: vi.fn(),
  disableAccount: vi.fn(),
  getAccountBootstrap: vi.fn(),
  getAccountSecurityEvents: vi.fn(),
  getAccountSessions: vi.fn(),
  logoutAllAccountSessions: vi.fn(),
  portalLogout: vi.fn(),
  requestAccountEmailChange: vi.fn(),
  revokeAccountSession: vi.fn(),
  setupAccountMfa: vi.fn(),
  verifyAccountMfa: vi.fn(),
}))

describe('AccountOverviewPage MFA experience', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    portalApi.getAccountBootstrap.mockResolvedValue({
      email: 'owner@example.com',
      fullName: 'Owner Example',
      emailVerified: true,
      capabilities: { canShop: true, canAccessPortal: false },
    })
    portalApi.getAccountSecurityEvents.mockResolvedValue([])
    portalApi.getAccountSessions.mockResolvedValue([])
    portalApi.setupAccountMfa.mockResolvedValue({ setupInProgress: true, secret: 'JBSWY3DPEHPK3PXP' })
    portalApi.verifyAccountMfa.mockResolvedValue({ ok: true, recoveryCodes: ['recovery-ABC123'] })
  })

  it('starts the MFA setup flow from the account security controls', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <AccountOverviewPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText('Security controls')).toBeInTheDocument())

    await user.type(screen.getByLabelText(/current password for mfa/i), 'Strong-Password-123!')
    await user.click(screen.getByRole('button', { name: /enable mfa/i }))

    await waitFor(() => expect(portalApi.setupAccountMfa).toHaveBeenCalled())
    expect(await screen.findAllByText(/verification code/i)).not.toHaveLength(0)
  })
})
