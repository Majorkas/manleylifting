import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { QueryProvider } from './testQueryClient'
import { createTestQueryClient } from './createTestQueryClient'
import { useCollectionQuery } from '../hooks/useCatalogQueries'
import { getCollectionByHandle } from '../utils/shopConfig'

vi.mock('../utils/shopConfig', async () => {
  const actual = await vi.importActual('../utils/shopConfig')
  return { ...actual, getCollectionByHandle: vi.fn() }
})

describe('catalog queries', () => {
  it('shares a collection request for identical handles', async () => {
    getCollectionByHandle.mockResolvedValue({ handle: 'chains', title: 'Chains' })
    const client = createTestQueryClient()
    const wrapper = ({ children }) => <QueryProvider client={client}>{children}</QueryProvider>
    const first = renderHook(() => useCollectionQuery('chains'), { wrapper })
    const second = renderHook(() => useCollectionQuery('chains'), { wrapper })

    await waitFor(() => expect(first.result.current.data?.title).toBe('Chains'))
    await waitFor(() => expect(second.result.current.data?.title).toBe('Chains'))
    expect(getCollectionByHandle).toHaveBeenCalledTimes(1)
  })
})