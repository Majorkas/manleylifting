import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { QueryProvider } from './testQueryClient'
import { createTestQueryClient } from './createTestQueryClient'
import {
  useEquipmentActivityQuery,
  useEquipmentReportsQuery,
  useGeneratedCertificatesQuery,
} from '../hooks/usePortalReadQueries'
import { getEquipmentActivity, getEquipmentReports, getSiteCertificates } from '../utils/portalApi'

vi.mock('../utils/portalApi', async () => {
  const actual = await vi.importActual('../utils/portalApi')
  return {
    ...actual,
    getEquipmentActivity: vi.fn(),
    getEquipmentReports: vi.fn(),
    getSiteCertificates: vi.fn(),
  }
})

describe('portal read queries', () => {
  it('loads equipment reports only when an equipment id is enabled', async () => {
    getEquipmentReports.mockResolvedValue([])
    const client = createTestQueryClient()
    const wrapper = ({ children }) => <QueryProvider client={client}>{children}</QueryProvider>
    const result = renderHook(() => useEquipmentReportsQuery(7, true), { wrapper })

    await waitFor(() => expect(result.result.current.isSuccess).toBe(true))
    expect(getEquipmentReports).toHaveBeenCalledWith(7)
  })

  it('loads activity and certificates through stable shared keys', async () => {
    getEquipmentActivity.mockResolvedValue([])
    getSiteCertificates.mockResolvedValue([])
    const client = createTestQueryClient()
    const wrapper = ({ children }) => <QueryProvider client={client}>{children}</QueryProvider>
    const activity = renderHook(() => useEquipmentActivityQuery(7, true), { wrapper })
    const certificates = renderHook(() => useGeneratedCertificatesQuery(3, true), { wrapper })

    await waitFor(() => expect(activity.result.current.isSuccess).toBe(true))
    await waitFor(() => expect(certificates.result.current.isSuccess).toBe(true))
    expect(client.getQueryData(['portal-equipment-activity', '7'])).toEqual([])
    expect(client.getQueryData(['portal-generated-certificates', '3'])).toEqual([])
  })
})