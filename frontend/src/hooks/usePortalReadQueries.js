import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../queryKeys'
import { getEquipmentActivity, getEquipmentReports, getSiteCertificates } from '../utils/portalApi'

export function useEquipmentReportsQuery(equipmentId, enabled) {
  return useQuery({
    queryKey: queryKeys.portalReports(equipmentId),
    queryFn: () => getEquipmentReports(equipmentId),
    enabled: Boolean(equipmentId && enabled),
    staleTime: 30 * 1000,
  })
}

export function useEquipmentActivityQuery(equipmentId, enabled) {
  return useQuery({
    queryKey: queryKeys.portalEquipmentActivity(equipmentId),
    queryFn: () => getEquipmentActivity(equipmentId),
    enabled: Boolean(equipmentId && enabled),
    staleTime: 60 * 1000,
  })
}

export function useGeneratedCertificatesQuery(siteId, enabled) {
  return useQuery({
    queryKey: queryKeys.portalGeneratedCertificates(siteId),
    queryFn: () => getSiteCertificates(siteId),
    enabled: Boolean(siteId && enabled),
    staleTime: 5 * 60 * 1000,
  })
}
