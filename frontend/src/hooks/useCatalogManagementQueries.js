import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../queryKeys'
import { authFetch, parseResponse } from '../utils/portalApi'

async function catalogRequest(path, options = {}) {
  const isMultipart = typeof FormData !== 'undefined' && options.body instanceof FormData
  const response = await authFetch(path, {
    headers: isMultipart ? (options.headers || {}) : { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  })
  return parseResponse(response, path)
}

export function useCatalogManagementQuery({ search = '', isActive, page = 1 } = {}) {
  return useQuery({
    queryKey: queryKeys.ownerCatalog({ search, isActive, page }),
    queryFn: () => catalogRequest(`/portal/catalog/products/?search=${encodeURIComponent(search)}&page=${page}${isActive == null ? '' : `&isActive=${isActive}`}`),
    staleTime: 30 * 1000,
  })
}

function invalidateCatalogQueries(queryClient, product) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.ownerCatalog() }),
    queryClient.invalidateQueries({ queryKey: queryKeys.products() }),
    queryClient.invalidateQueries({ queryKey: queryKeys.product(product?.handle) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.collections() }),
  ])
}

export function useCatalogManagementMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ productId, action, payload }) => {
      const path = action === 'stock'
        ? `/portal/catalog/products/${productId}/stock/`
        : action === 'state'
          ? `/portal/catalog/products/${productId}/state/`
          : productId
            ? `/portal/catalog/products/${productId}/`
            : '/portal/catalog/products/'
      const images = Array.isArray(payload?.images) ? payload.images.filter(Boolean) : []
      const body = images.length > 0
        ? (() => {
            const formData = new FormData()
            Object.entries(payload || {}).forEach(([key, value]) => {
              if (key !== 'images' && value != null) {
                const serializedValue = Array.isArray(value) ? JSON.stringify(value) : String(value)
                formData.set(key, serializedValue)
              }
            })
            images.forEach((image) => formData.append('images', image))
            return formData
          })()
        : JSON.stringify(payload || {})
      return catalogRequest(path, {
        method: productId && action !== 'stock' && action !== 'state' ? 'PATCH' : 'POST',
        body,
      })
    },
    onSuccess: (product) => invalidateCatalogQueries(queryClient, product),
  })
}
