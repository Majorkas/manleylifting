import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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
        },
      ],
    },
    isPending: false,
    isError: false,
  }),
  useCatalogManagementMutation: () => ({ mutate: vi.fn(), isPending: false, isError: mockState.mutationError, error: mockState.mutationError ? new Error('Duplicate handle') : null }),
}))

describe('catalog management panel', () => {
  it('renders the owner and office-staff catalog management surface', () => {
    render(<PortalCatalogManagementPanel />)
    expect(screen.getByRole('heading', { name: 'Store products' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add product' })).toBeInTheDocument()
    expect(screen.queryByLabelText('stockPolicy')).not.toBeInTheDocument()
  })

  it('opens the product form in a modal and closes it with Escape', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    render(<PortalCatalogManagementPanel />)

    expect(screen.queryByRole('dialog', { name: /add a product/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add product' }))

    expect(screen.getByRole('dialog', { name: /add a product/i })).toBeInTheDocument()
    expect(screen.queryByLabelText('stockPolicy')).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: /add a product/i })).not.toBeInTheDocument()
  })

  it('renders mutation errors and supports status filtering', () => {
    mockState.mutationError = true
    render(<PortalCatalogManagementPanel />)
    expect(screen.getByRole('alert')).toHaveTextContent('Duplicate handle')
    expect(screen.getByLabelText('Visibility')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Visibility'), { target: { value: 'false' } })
  })

  it('does not open the product modal when typing in the stock adjustment field', () => {
    render(<PortalCatalogManagementPanel />)

    const stockInput = screen.getByLabelText('Stock change for Chain Block')
    fireEvent.change(stockInput, { target: { value: '5' } })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(stockInput).toHaveValue('5')
  })
})
