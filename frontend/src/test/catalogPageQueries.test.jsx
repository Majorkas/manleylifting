import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { QueryProvider } from './testQueryClient'
import { createTestQueryClient } from './createTestQueryClient'
import { useFeaturedCollectionsQuery, useFeaturedProductsQuery, useProductQuery } from '../hooks/useCatalogQueries'
import { getFeaturedCollections, getFeaturedProducts, getProductByHandle } from '../utils/shopConfig'

vi.mock('../utils/shopConfig', async () => {
  const actual = await vi.importActual('../utils/shopConfig')
  return {
    ...actual,
    getFeaturedCollections: vi.fn(),
    getFeaturedProducts: vi.fn(),
    getProductByHandle: vi.fn(),
  }
})

describe('catalog page queries', () => {
  it('loads featured collections and products through shared query keys', async () => {
    getFeaturedCollections.mockResolvedValue([])
    getFeaturedProducts.mockResolvedValue([])
    const client = createTestQueryClient()
    const wrapper = ({ children }) => <QueryProvider client={client}>{children}</QueryProvider>
    const collections = renderHook(() => useFeaturedCollectionsQuery(), { wrapper })
    const products = renderHook(() => useFeaturedProductsQuery(), { wrapper })

    await waitFor(() => expect(collections.result.current.isSuccess).toBe(true))
    await waitFor(() => expect(products.result.current.isSuccess).toBe(true))
    expect(client.getQueryData(['catalog', 'collections', {}])).toEqual([])
    expect(client.getQueryData(['catalog', 'products', {}])).toEqual([])
  })

  it('does not request product detail without a handle', async () => {
    const client = createTestQueryClient()
    const wrapper = ({ children }) => <QueryProvider client={client}>{children}</QueryProvider>
    renderHook(() => useProductQuery(''), { wrapper })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(getProductByHandle).not.toHaveBeenCalled()
  })
})