import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import PortalCatalogManagementPanel from '../components/PortalCatalogManagementPanel'

const mockState = vi.hoisted(() => ({ mutationError: false }))

vi.mock('../hooks/useCatalogManagementQueries', () => ({
  useCatalogManagementQuery: () => ({ data: { results: [] }, isPending: false, isError: false }),
  useCatalogManagementMutation: () => ({ mutate: vi.fn(), isPending: false, isError: mockState.mutationError, error: mockState.mutationError ? new Error('Duplicate handle') : null }),
}))

describe('catalog management panel', () => {
  it('renders the owner and office-staff catalog management surface', () => {
    render(<PortalCatalogManagementPanel />)
    expect(screen.getByRole('heading', { name: 'Store products' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add product' })).toBeInTheDocument()
  })

  it('renders mutation errors and supports status filtering', () => {
    mockState.mutationError = true
    render(<PortalCatalogManagementPanel />)
    expect(screen.getByRole('alert')).toHaveTextContent('Duplicate handle')
    expect(screen.getByLabelText('Visibility')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Visibility'), { target: { value: 'false' } })
  })
})
