import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AccountSecurityPage from '../pages/AccountSecurityPage'
import * as portalApi from '../utils/portalApi'

vi.mock('../components/AccountLayout', () => ({
  default: ({ children, title }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}))

vi.mock('../components/AccountSectionTabs', () => ({
  default: () => <nav aria-label="Account sections" />,
}))

vi.mock('../utils/usePageMeta', () => ({
  default: () => undefined,
}))

vi.mock('../utils/portalApi', () => ({
  changeAccountPassword: vi.fn(),
  deleteAccount: vi.fn(),
  getAccountBootstrap: vi.fn(),
  getAccountSecurityEvents: vi.fn(),
  getAccountSessions: vi.fn(),
  logoutAllAccountSessions: vi.fn(),
  portalLogout: vi.fn(),
  revokeAccountSession: vi.fn(),
  setupAccountMfa: vi.fn(),
  verifyAccountMfa: vi.fn(),
}))

describe('AccountSecurityPage MFA experience', () => {
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
    portalApi.setupAccountMfa.mockResolvedValue({
      setupInProgress: true,
      secret: 'JBSWY3DPEHPK3PXP',
      otpauthUri: 'otpauth://totp/Manley%20Lifting:owner%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Manley%20Lifting',
      qrCodeUrl: 'https://quickchart.io/qr?size=240&text=otpauth%3A%2F%2Ftotp%2Fexample',
    })
    portalApi.verifyAccountMfa.mockResolvedValue({ ok: true, recoveryCodes: ['recovery-ABC123'] })
  })

  it('starts the MFA setup flow from the security page', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <AccountSecurityPage />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText('Account security')).toBeInTheDocument())

    await user.type(screen.getByLabelText(/current password for mfa/i), 'Strong-Password-123!')
    await user.click(screen.getByRole('button', { name: /enable mfa/i }))

    await waitFor(() => expect(portalApi.setupAccountMfa).toHaveBeenCalled())
    expect(await screen.findAllByText(/verification code/i)).not.toHaveLength(0)
    expect(screen.getByAltText('MFA setup QR code')).toBeInTheDocument()
    expect(screen.getByText(/Secret: JBSWY3DPEHPK3PXP/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out all devices' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open email change' })).toBeInTheDocument()
    expect(screen.getByText('Recent security activity')).toBeInTheDocument()
  })
})