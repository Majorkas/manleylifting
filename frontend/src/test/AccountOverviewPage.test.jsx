import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AccountOverviewPage from '../pages/AccountOverviewPage'
import * as portalApi from '../utils/portalApi'
import * as shopConfig from '../utils/shopConfig'

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
  claimGuestOrder: vi.fn(),
  getAccountBootstrap: vi.fn(),
  getAccountSecurityEvents: vi.fn(),
  getAccountSessions: vi.fn(),
  portalLogout: vi.fn(),
}))

vi.mock('../utils/shopConfig', () => ({
  clearPendingOrderClaim: vi.fn(),
  loadPendingOrderClaim: vi.fn(),
}))

describe('AccountOverviewPage shell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    portalApi.getAccountBootstrap.mockResolvedValue({
      email: 'owner@example.com',
      fullName: 'Owner Example',
      emailVerified: true,
      capabilities: { canShop: true, canAccessPortal: false },
    })
    portalApi.getAccountSecurityEvents.mockResolvedValue([
      {
        action: 'account.password_changed',
        createdAt: '2026-08-01T10:00:00Z',
      },
    ])
    portalApi.getAccountSessions.mockResolvedValue([
      { id: 'session-1', isActive: true, isRevoked: false },
    ])
    shopConfig.loadPendingOrderClaim.mockReturnValue(null)
  })

  it('shows direct account action cards for customer accounts', async () => {
    render(
      <MemoryRouter>
        <AccountOverviewPage />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('link', { name: 'Orders' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Addresses' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Security' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Account sections' })).not.toBeInTheDocument()
    expect(screen.getByText('Recent security activity')).toBeInTheDocument()
    expect(screen.getByText('Active sessions')).toBeInTheDocument()
  })

  it('shows portal-first choices for portal-linked accounts', async () => {
    portalApi.getAccountBootstrap.mockResolvedValue({
      email: 'portal-user@example.com',
      fullName: 'Portal User',
      emailVerified: true,
      capabilities: { canShop: true, canViewOrders: true, canAccessPortal: true, canFulfillOrders: false },
    })

    render(
      <MemoryRouter>
        <AccountOverviewPage />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('link', { name: /Open portal/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Store orders/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open security center/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Fulfillment operations/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Account sections' })).not.toBeInTheDocument()
  })

  it('shows fulfillment operations shortcut for fulfillment-capable portal users', async () => {
    portalApi.getAccountBootstrap.mockResolvedValue({
      email: 'ops-user@example.com',
      fullName: 'Ops User',
      emailVerified: true,
      capabilities: { canShop: false, canViewOrders: false, canAccessPortal: true, canFulfillOrders: true },
    })

    render(
      <MemoryRouter>
        <AccountOverviewPage />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('link', { name: /Fulfillment operations/i })).toHaveAttribute('href', '/shop/fulfillment')
    expect(screen.queryByRole('link', { name: /Store orders/i })).not.toBeInTheDocument()
  })

  it('shows a separate shop management shortcut for catalog managers', async () => {
    portalApi.getAccountBootstrap.mockResolvedValue({
      email: 'owner@example.com',
      fullName: 'Owner Example',
      emailVerified: true,
      capabilities: { canShop: true, canViewOrders: true, canAccessPortal: true, canFulfillOrders: true, canManageShop: true },
    })

    render(
      <MemoryRouter>
        <AccountOverviewPage />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('link', { name: /Shop management/i })).toHaveAttribute('href', '/shop/shop-management')
  })

  it('redirects unauthenticated users to login with a safe /account return path', async () => {
    portalApi.getAccountBootstrap.mockRejectedValue({ status: 401, message: 'Unauthorized' })

    render(
      <MemoryRouter initialEntries={['/account']}>
        <Routes>
          <Route path="/account" element={<AccountOverviewPage />} />
          <Route path="/account/login" element={<div>Account Login</div>} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText('Account Login')).toBeInTheDocument())
  })

  it('claims a pending guest order for a verified account and clears the capability', async () => {
    shopConfig.loadPendingOrderClaim.mockReturnValue({
      orderNumber: 'MNL-CLAIM-1',
      claimToken: 'claim-token-1',
    })
    portalApi.claimGuestOrder.mockResolvedValue({ ok: true })

    render(
      <MemoryRouter>
        <AccountOverviewPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(portalApi.claimGuestOrder).toHaveBeenCalledWith('MNL-CLAIM-1', 'claim-token-1')
      expect(shopConfig.clearPendingOrderClaim).toHaveBeenCalledTimes(1)
    })
  })

  it('does not claim a pending order before email verification', async () => {
    shopConfig.loadPendingOrderClaim.mockReturnValue({
      orderNumber: 'MNL-CLAIM-2',
      claimToken: 'claim-token-2',
    })
    portalApi.getAccountBootstrap.mockResolvedValue({
      email: 'pending@example.com',
      fullName: 'Pending Customer',
      emailVerified: false,
      capabilities: { canShop: false, canAccessPortal: false },
    })

    render(
      <MemoryRouter>
        <AccountOverviewPage />
      </MemoryRouter>,
    )

    await screen.findByText('Pending Customer')
    expect(portalApi.claimGuestOrder).not.toHaveBeenCalled()
  })
})