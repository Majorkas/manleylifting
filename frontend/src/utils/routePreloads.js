const routeLoaders = {
  '/shop': () => import('../pages/ShopPage'),
  '/cart': () => import('../pages/CartPage'),
  '/checkout': () => import('../pages/CheckoutPage'),
  '/account/login': () => import('../pages/AccountLoginPage'),
}

const requestedRoutes = new Set()

export function prefetchRoute(path) {
  const loader = routeLoaders[path]
  if (!loader || requestedRoutes.has(path)) return

  requestedRoutes.add(path)
  void loader().catch(() => {
    requestedRoutes.delete(path)
  })
}
