import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../queryKeys'
import { getAccountOrders, getPortalOrders } from '../utils/portalApi'

export function usePortalCustomerOrdersQuery(enabled) {
  return useQuery({
    queryKey: queryKeys.portalCustomerOrders(),
    queryFn: getAccountOrders,
    enabled,
    staleTime: 5 * 60 * 1000,
  })
}

export function useFulfillmentOrdersQuery({ bucket, page, pageSize, enabled }) {
  return useQuery({
    queryKey: queryKeys.portalFulfillmentOrders(bucket, page, pageSize),
    queryFn: () => getPortalOrders({ bucket, page, pageSize }),
    enabled,
    staleTime: 60 * 1000,
  })
}
