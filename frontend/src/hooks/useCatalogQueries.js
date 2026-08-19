import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../queryKeys'
import {
  getCollectionByHandle,
  getFeaturedCollections,
  getFeaturedProducts,
  getProductByHandle,
} from '../utils/shopConfig'

export function useFeaturedCollectionsQuery() {
  return useQuery({
    queryKey: queryKeys.collections(),
    queryFn: getFeaturedCollections,
    staleTime: 5 * 60 * 1000,
  })
}

export function useFeaturedProductsQuery() {
  return useQuery({
    queryKey: queryKeys.products(),
    queryFn: getFeaturedProducts,
    staleTime: 5 * 60 * 1000,
  })
}

export function useCollectionQuery(handle) {
  return useQuery({
    queryKey: queryKeys.collection(handle),
    queryFn: () => getCollectionByHandle(handle),
    enabled: Boolean(handle),
  })
}

export function useProductQuery(handle) {
  return useQuery({
    queryKey: queryKeys.product(handle),
    queryFn: () => getProductByHandle(handle),
    enabled: Boolean(handle),
  })
}
