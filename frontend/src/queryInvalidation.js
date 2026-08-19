import { queryKeys } from './queryKeys'

export function invalidateAccountAddresses(queryClient) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.addresses() })
}

export async function invalidatePortalOrderQueries(queryClient, orderNumber) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['portal-fulfillment-orders'] }),
    queryClient.invalidateQueries({ queryKey: queryKeys.portalOrder(orderNumber) }),
  ])
}

export async function invalidateCheckoutQueries(queryClient, checkoutRef) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.checkout(checkoutRef) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.orders() }),
    queryClient.invalidateQueries({ queryKey: queryKeys.portalCustomerOrders() }),
  ])
}