import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import CartPage from './CartPage'

vi.mock('../components/ShopPageLayout', () => ({
  default: ({ children }) => <div>{children}</div>,
}))

vi.mock('../context/CartContext', () => ({
  useCart: () => ({
    cartItems: [{ handle: 'chain-block', title: 'Chain Block', quantity: 1, price: 10, currency: 'EUR' }],
    cartCount: 1,
    subtotal: 10,
    removeItem: vi.fn(),
  }),
}))

vi.mock('../utils/usePageMeta', () => ({
  default: () => {},
}))

describe('CartPage', () => {
  it('shows the polished checkout guidance for the cart', () => {
    render(
      <MemoryRouter>
        <CartPage />
      </MemoryRouter>,
    )

    expect(screen.getByText(/Secure checkout/i)).toBeInTheDocument()
    expect(screen.getByText(/Delivery updates/i)).toBeInTheDocument()
  })
})
