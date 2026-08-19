import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../queryKeys'
import { getAccountAddresses, getAccountOrders } from '../utils/portalApi'

export function useAccountOrdersQuery() {
  return useQuery({
    queryKey: queryKeys.orders(),
    queryFn: getAccountOrders,
  })
}

export function useAccountAddressesQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.addresses(),
    queryFn: getAccountAddresses,
    enabled,
  })
}
