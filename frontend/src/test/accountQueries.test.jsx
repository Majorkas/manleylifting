import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { QueryProvider } from './testQueryClient'
import { createTestQueryClient } from './createTestQueryClient'
import { useAccountAddressesQuery, useAccountOrdersQuery } from '../hooks/useAccountQueries'
import { getAccountAddresses, getAccountOrders } from '../utils/portalApi'
import { invalidateAccountAddresses, invalidateCheckoutQueries, invalidatePortalOrderQueries } from '../queryInvalidation'

vi.mock('../utils/portalApi', async () => {
  const actual = await vi.importActual('../utils/portalApi')
  return { ...actual, getAccountAddresses: vi.fn(), getAccountOrders: vi.fn() }
})

describe('account queries', () => {
  it('shares the account orders request for identical consumers', async () => {
    getAccountOrders.mockResolvedValue([])
    const client = createTestQueryClient()
    const wrapper = ({ children }) => <QueryProvider client={client}>{children}</QueryProvider>
    const first = renderHook(() => useAccountOrdersQuery(), { wrapper })
    const second = renderHook(() => useAccountOrdersQuery(), { wrapper })

    await waitFor(() => expect(first.result.current.isSuccess).toBe(true))
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true))
    expect(getAccountOrders).toHaveBeenCalledTimes(1)
  })

  it('shares the account addresses request for identical consumers', async () => {
    getAccountAddresses.mockResolvedValue([])
    const client = createTestQueryClient()
    const wrapper = ({ children }) => <QueryProvider client={client}>{children}</QueryProvider>
    const first = renderHook(() => useAccountAddressesQuery(), { wrapper })
    const second = renderHook(() => useAccountAddressesQuery(), { wrapper })

    await waitFor(() => expect(first.result.current.isSuccess).toBe(true))
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true))
    expect(getAccountAddresses).toHaveBeenCalledTimes(1)
  })

  it('invalidates the account address cache key after an address mutation', async () => {
    const client = createTestQueryClient()
    const invalidateQueries = vi.spyOn(client, 'invalidateQueries')
    await invalidateAccountAddresses(client)
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['account', 'addresses'] })
  })

  it('invalidates portal order lists and detail after fulfillment mutation', async () => {
    const client = createTestQueryClient()
    const invalidateQueries = vi.spyOn(client, 'invalidateQueries').mockResolvedValue(true)
    await invalidatePortalOrderQueries(client, 'MNL-100')
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['portal-fulfillment-orders'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['portal', 'order', 'MNL-100'] })
  })

  it('invalidates checkout and account orders after payment confirmation', async () => {
    const client = createTestQueryClient()
    const invalidateQueries = vi.spyOn(client, 'invalidateQueries').mockResolvedValue(true)
    await invalidateCheckoutQueries(client, 'checkout-100')
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['checkout', 'checkout-100'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['account', 'orders', 'list'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['portal-customer-orders'] })
  })
})