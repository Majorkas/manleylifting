import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PortalCatalogManagementPanel from '../components/PortalCatalogManagementPanel'

const mockState = vi.hoisted(() => ({ mutationError: false }))

vi.mock('../hooks/useCatalogManagementQueries', () => ({
  useCatalogManagementQuery: () => ({
    data: {
      results: [
        {
          id: 1,
          title: 'Chain Block',
          handle: 'chain-block',
          currencyCode: 'EUR',
          priceAmount: '10.00',
          availableQty: 5,
          reservedQty: 0,
          isActive: true,
          variantRef: 'chain-block-variant',
          sku: '',
          images: [{ id: 1, url: 'https://example.com/chain-block.png', alt: 'Chain Block' }],
        },
      ],
    },
    isPending: false,
    isError: false,
  }),
  useCatalogManagementMutation: () => ({ mutate: vi.fn(), isPending: false, isError: mockState.mutationError, error: mockState.mutationError ? new Error('Duplicate handle') : null }),
}))

describe('catalog management panel', () => {
  beforeEach(() => {
    mockState.mutationError = false
  })

  it('renders the owner and office-staff catalog management surface', () => {
    render(<MemoryRouter><PortalCatalogManagementPanel /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Store products' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add product' })).toBeInTheDocument()
    expect(screen.queryByLabelText('stockPolicy')).not.toBeInTheDocument()
  })

  it('opens the product form in a modal and closes it with Escape', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    render(<MemoryRouter><PortalCatalogManagementPanel /></MemoryRouter>)

    expect(screen.queryByRole('dialog', { name: /add a product/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add product' }))

    expect(screen.getByRole('dialog', { name: /add a product/i })).toBeInTheDocument()
    expect(screen.queryByLabelText('stockPolicy')).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: /add a product/i })).not.toBeInTheDocument()
  })

  it('renders mutation errors and supports status filtering', () => {
    mockState.mutationError = true
    render(<MemoryRouter><PortalCatalogManagementPanel /></MemoryRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent('Duplicate handle')
    expect(screen.getByLabelText('Visibility')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Visibility'), { target: { value: 'false' } })
  })

  it('keeps stock adjustment behind a dedicated action', () => {
    render(<MemoryRouter><PortalCatalogManagementPanel /></MemoryRouter>)

    expect(screen.getAllByRole('button', { name: 'Adjust stock for Chain Block' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows a result count and dedicated stock adjustment action', () => {
    render(<MemoryRouter><PortalCatalogManagementPanel /></MemoryRouter>)
    expect(screen.getByText('Showing 1-1 of 1')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Adjust stock for Chain Block/i }).length).toBeGreaterThan(0)
  })

  it('shows current product images when editing', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    render(<MemoryRouter><PortalCatalogManagementPanel /></MemoryRouter>)
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0])
    expect(screen.getByText('Product images')).toBeInTheDocument()
  })
})
