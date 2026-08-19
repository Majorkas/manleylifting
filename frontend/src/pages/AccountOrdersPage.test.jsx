import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AccountOrdersPage from './AccountOrdersPage'
import * as portalApi from '../utils/portalApi'
import { QueryProvider } from '../test/testQueryClient'
import { createTestQueryClient } from '../test/createTestQueryClient'

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
  downloadAccountOrderInvoice: vi.fn(),
  getAccountOrders: vi.fn(),
}))

describe('AccountOrdersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders account order history details and opens a customer invoice', async () => {
    const user = userEvent.setup()
    portalApi.getAccountOrders.mockResolvedValue([
      {
        checkoutRef: 'chk_123',
        orderNumber: 'ML-2042',
        status: 'paid',
        amountTotalCents: 25999,
        subtotalCents: 22999,
        shippingCents: 1000,
        taxCents: 2000,
        currency: 'GBP',
        createdAt: '2026-08-03T10:00:00Z',
        customerName: 'Jane Doe',
        shippingName: 'Jane Doe',
        shippingAddressLine1: '1 Main Street',
        shippingCity: 'Dublin',
        shippingPostcode: 'D01 TEST',
        shippingCountryCode: 'IE',
        lineItems: [
          { sku: 'SLING-10T', title: '10T Sling', quantity: 1, lineTotalCents: 19999, currency: 'GBP' },
          { sku: 'HOOK-5T', title: '5T Hook', quantity: 1, lineTotalCents: 3000, currency: 'GBP' },
        ],
      },
    ])

    render(<QueryProvider client={createTestQueryClient()}><MemoryRouter><AccountOrdersPage /></MemoryRouter></QueryProvider>)

    expect(await screen.findByText('ML-2042')).toBeInTheDocument()
    expect(screen.getByText('2 items')).toBeInTheDocument()
    expect(screen.getByText('£259.99')).toBeInTheDocument()
    expect(screen.getByText('Paid')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /view invoice for ml-2042/i }))

    expect(screen.getByRole('dialog', { name: /invoice ml-2042/i })).toBeInTheDocument()
    expect(screen.getByText('10T Sling')).toBeInTheDocument()
    expect(screen.getByText('Shipping paid')).toBeInTheDocument()
    expect(screen.getByText('Taxes')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /print invoice/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /download invoice/i })).toBeInTheDocument()
  })

  it('redirects unauthenticated users to login with a safe return path', async () => {
    portalApi.getAccountOrders.mockRejectedValue({ status: 401, message: 'Unauthorized' })

    render(<QueryProvider client={createTestQueryClient()}><MemoryRouter initialEntries={['/account/orders']}><Routes><Route path="/account/orders" element={<AccountOrdersPage />} /><Route path="/account/login" element={<div>Account Login</div>} /></Routes></MemoryRouter></QueryProvider>)

    await waitFor(() => expect(screen.getByText('Account Login')).toBeInTheDocument())
  })
})
