import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { QueryProvider } from './testQueryClient'
import { createTestQueryClient } from './createTestQueryClient'
import { useFulfillmentOrdersQuery, usePortalCustomerOrdersQuery } from '../hooks/usePortalOrderQueries'
import { getAccountOrders, getPortalOrders } from '../utils/portalApi'
import { queryKeys } from '../queryKeys'

vi.mock('../utils/portalApi', async () => {
  const actual = await vi.importActual('../utils/portalApi')
  return { ...actual, getAccountOrders: vi.fn(), getPortalOrders: vi.fn() }
})

describe('portal order queries', () => {
  it('normalizes shared portal company and equipment keys', () => {
    expect(queryKeys.portalProfile()).toEqual(['portal-profile'])
    expect(queryKeys.portalCompanies()).toEqual(['portal-companies'])
    expect(queryKeys.portalCompanyHeader(4)).toEqual(['portal-company-header', '4'])
    expect(queryKeys.portalEquipment({ companyId: 4, siteId: 2, search: 'hoist' })).toEqual([
      'portal-equipment',
      '4',
      '2',
      'hoist',
    ])
    expect(queryKeys.portalReports(9)).toEqual(['portal-reports', '9'])
    expect(queryKeys.portalEquipmentActivity(9)).toEqual(['portal-equipment-activity', '9'])
    expect(queryKeys.portalGeneratedCertificates(3)).toEqual(['portal-generated-certificates', '3'])
    expect(queryKeys.portalPendingApprovals('owner')).toEqual(['portal-pending-approvals', 'owner'])
    expect(queryKeys.portalDashboardStats('owner')).toEqual(['portal-dashboard-stats', 'owner'])
    expect(queryKeys.portalStaffAssignments('active')).toEqual(['portal-staff-assignments', 'active'])
  })

  it('loads customer orders through the shared customer-order key', async () => {
    getAccountOrders.mockResolvedValue([])
    const client = createTestQueryClient()
    const wrapper = ({ children }) => <QueryProvider client={client}>{children}</QueryProvider>
    const result = renderHook(() => usePortalCustomerOrdersQuery(true), { wrapper })

    await waitFor(() => expect(result.result.current.isSuccess).toBe(true))
    expect(getAccountOrders).toHaveBeenCalledTimes(1)
    expect(client.getQueryData(['portal-customer-orders'])).toEqual([])
  })

  it('loads fulfillment orders with bucket and pagination in the query key', async () => {
    getPortalOrders.mockResolvedValue({ results: [], totalPages: 1 })
    const client = createTestQueryClient()
    const wrapper = ({ children }) => <QueryProvider client={client}>{children}</QueryProvider>
    const result = renderHook(
      () => useFulfillmentOrdersQuery({ bucket: 'recent', page: 2, pageSize: 6, enabled: true }),
      { wrapper },
    )

    await waitFor(() => expect(result.result.current.isSuccess).toBe(true))
    expect(getPortalOrders).toHaveBeenCalledWith({ bucket: 'recent', page: 2, pageSize: 6 })
    expect(client.getQueryData(['portal-fulfillment-orders', 'recent', 2, 6])).toEqual({ results: [], totalPages: 1 })
  })

  it('does not load fulfillment orders when disabled', async () => {
    getPortalOrders.mockClear()
    const client = createTestQueryClient()
    const wrapper = ({ children }) => <QueryProvider client={client}>{children}</QueryProvider>
    renderHook(
      () => useFulfillmentOrdersQuery({ bucket: 'recent', page: 1, pageSize: 3, enabled: false }),
      { wrapper },
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(getPortalOrders).not.toHaveBeenCalled()
  })
})