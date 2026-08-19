import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ShopManagementPage from './ShopManagementPage'
import * as portalApi from '../utils/portalApi'

vi.mock('../components/PortalCatalogManagementPanel', () => ({
  default: () => <h2>Store products</h2>,
}))

vi.mock('../components/PortalLayout', () => ({
  default: ({ children }) => <main>{children}</main>,
}))

vi.mock('../utils/portalApi', () => ({
  getPortalMe: vi.fn(),
}))

vi.mock('../utils/usePageMeta', () => ({
  default: () => undefined,
}))

describe('ShopManagementPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders catalog management for an owner', async () => {
    portalApi.getPortalMe.mockResolvedValue({ role: 'owner', fullName: 'Owner Example' })

    render(
      <MemoryRouter>
        <ShopManagementPage />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Store products' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Back to profile/i })).toHaveAttribute('href', '/account')
  })

  it('redirects non-managers to the portal', async () => {
    portalApi.getPortalMe.mockResolvedValue({ role: 'staff', fullName: 'Staff User' })

    render(
      <MemoryRouter initialEntries={['/shop/shop-management']}>
        <Routes>
          <Route path="/shop/shop-management" element={<ShopManagementPage />} />
          <Route path="/portal" element={<p>Portal dashboard</p>} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByText('Portal dashboard')).toBeInTheDocument())
  })
})