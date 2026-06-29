/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { formatCurrency, loadCartItems, saveCartItems } from '../utils/shopConfig'

const CartContext = createContext(null)

function normalizeIncomingProduct(product) {
  if (!product) return null

  return {
    handle: product.handle || '',
    title: product.title || '',
    variantId: product.variantId || '',
    price: Number(product.price || 0),
    currency: product.currency || 'EUR',
    imageUrl: product.imageUrl || '',
  }
}

export function CartProvider({ children }) {
  const [cartState, setCartState] = useState(() => loadCartItems())
  const [toast, setToast] = useState(null)

  useEffect(() => {
    saveCartItems(cartState)
  }, [cartState])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(timer)
  }, [toast])

  const cartItems = useMemo(() => cartState, [cartState])

  const cartCount = useMemo(
    () => cartState.reduce((total, item) => total + Number(item.quantity || 0), 0),
    [cartState],
  )

  const subtotal = useMemo(
    () =>
      cartState.reduce(
        (total, item) => total + Number(item.price || 0) * Number(item.quantity || 0),
        0,
      ),
    [cartState],
  )

  const addItem = useCallback((product, quantity = 1) => {
    const normalized = normalizeIncomingProduct(product)
    if (!normalized || !normalized.handle || !normalized.variantId) return

    const addQuantity = Math.max(1, Number(quantity || 1))

    setCartState((current) => {
      const existing = current.find((item) => item.handle === normalized.handle)

      let nextState
      if (existing) {
        nextState = current.map((item) =>
          item.handle === normalized.handle
            ? { ...item, quantity: Number(item.quantity) + addQuantity }
            : item,
        )
      } else {
        nextState = [...current, { ...normalized, quantity: addQuantity }]
      }

      const nextSubtotal = nextState.reduce(
        (total, item) => total + Number(item.price || 0) * Number(item.quantity || 0),
        0,
      )

      setToast({
        title: normalized.title,
        addedCost: formatCurrency(normalized.price * addQuantity, normalized.currency),
        cartValue: formatCurrency(nextSubtotal, normalized.currency),
      })

      return nextState
    })
  }, [])

  const increaseQuantity = useCallback((handle) => {
    setCartState((current) =>
      current.map((item) =>
        item.handle === handle ? { ...item, quantity: Number(item.quantity) + 1 } : item,
      ),
    )
  }, [])

  const decreaseQuantity = useCallback((handle) => {
    setCartState((current) =>
      current
        .map((item) =>
          item.handle === handle ? { ...item, quantity: Number(item.quantity) - 1 } : item,
        )
        .filter((item) => item.quantity > 0),
    )
  }, [])

  const removeItem = useCallback((handle) => {
    setCartState((current) => current.filter((item) => item.handle !== handle))
  }, [])

  const clearCart = useCallback(() => {
    setCartState([])
  }, [])

  const dismissToast = useCallback(() => {
    setToast(null)
  }, [])

  const value = {
    cartState,
    cartItems,
    cartCount,
    subtotal,
    toast,
    addItem,
    increaseQuantity,
    decreaseQuantity,
    removeItem,
    clearCart,
    dismissToast,
  }

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart() {
  const context = useContext(CartContext)
  if (!context) {
    throw new Error('useCart must be used inside a CartProvider')
  }
  return context
}
