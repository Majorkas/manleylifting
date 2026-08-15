import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AccountOrdersPage from './AccountOrdersPage'
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
  getAccountOrders: vi.fn(),
}))

describe('AccountOrdersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders account order history details for ecommerce users', async () => {
    portalApi.getAccountOrders.mockResolvedValue([
      {
        checkoutRef: 'chk_123',
        orderNumber: 'ML-2042',
        status: 'paid',
        amountTotalCents: 25999,
        currency: 'GBP',
        createdAt: '2026-08-03T10:00:00Z',
        lineItems: [{ sku: 'SLING-10T' }, { sku: 'HOOK-5T' }],
      },
    ])

    render(
      <MemoryRouter>
        <AccountOrdersPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('ML-2042')).toBeInTheDocument()
    expect(screen.getByText('2 items')).toBeInTheDocument()
    expect(screen.getByText('£259.99')).toBeInTheDocument()
    expect(screen.getByText('Paid')).toBeInTheDocument()
  })

  it('redirects unauthenticated users to login with a safe return path', async () => {
    portalApi.getAccountOrders.mockRejectedValue({ status: 401, message: 'Unauthorized' })

    render(
      <MemoryRouter initialEntries={['/account/orders']}>
        <Routes>
          <Route path="/account/orders" element={<AccountOrdersPage />} />
          <Route path="/account/login" element={<div>Account Login</div>} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText('Account Login')).toBeInTheDocument())
  })
})
