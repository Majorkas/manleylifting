import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { QueryProvider } from '../test/testQueryClient'
import { createTestQueryClient } from '../test/createTestQueryClient'
import { useCatalogManagementMutation, useCatalogManagementQuery } from './useCatalogManagementQueries'

const mocks = vi.hoisted(() => ({
  authFetch: vi.fn(),
  parseResponse: vi.fn(),
}))

vi.mock('../utils/portalApi', () => ({
  authFetch: mocks.authFetch,
  parseResponse: mocks.parseResponse,
}))

describe('useCatalogManagementQuery', () => {
  it('requests the catalog route without duplicating the API prefix', async () => {
    mocks.authFetch.mockResolvedValue({ ok: true })
    mocks.parseResponse.mockResolvedValue({ results: [] })

    renderHook(
      () => useCatalogManagementQuery({ search: 'chain', page: 2, isActive: true }),
      {
        wrapper: ({ children }) => (
          <QueryProvider client={createTestQueryClient()}>{children}</QueryProvider>
        ),
      },
    )

    await waitFor(() => expect(mocks.authFetch).toHaveBeenCalled())
    expect(mocks.authFetch).toHaveBeenCalledWith(
      '/portal/catalog/products/?search=chain&page=2&isActive=true',
      expect.objectContaining({ headers: expect.any(Object) }),
    )
  })

  it('uses the same unprefixed API route for stock mutations', async () => {
    mocks.authFetch.mockResolvedValue({ ok: true })
    mocks.parseResponse.mockResolvedValue({ id: 12, handle: 'chain-block' })

    const { result } = renderHook(() => useCatalogManagementMutation(), {
      wrapper: ({ children }) => (
        <QueryProvider client={createTestQueryClient()}>{children}</QueryProvider>
      ),
    })

    await result.current.mutateAsync({
      productId: 12,
      action: 'stock',
      payload: { quantity: 3, reason: 'Restock' },
    })

    expect(mocks.authFetch).toHaveBeenCalledWith(
      '/portal/catalog/products/12/stock/',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
