import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import CartPage from './CartPage'

const increaseQuantity = vi.fn()
const decreaseQuantity = vi.fn()

vi.mock('../components/ShopPageLayout', () => ({
  default: ({ children }) => <div>{children}</div>,
}))

vi.mock('../context/CartContext', () => ({
  useCart: () => ({
    cartItems: [{ handle: 'chain-block', title: 'Chain Block', quantity: 1, price: 10, currency: 'EUR' }],
    cartCount: 1,
    subtotal: 10,
    removeItem: vi.fn(),
    increaseQuantity,
    decreaseQuantity,
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

  it('provides accessible quantity controls for each cart item', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()

    render(
      <MemoryRouter>
        <CartPage />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: /increase quantity for chain block/i }))

    expect(increaseQuantity).toHaveBeenCalledWith('chain-block')
    expect(screen.getByRole('button', { name: /decrease quantity for chain block/i })).toBeDisabled()
    expect(decreaseQuantity).not.toHaveBeenCalled()
  })
})
