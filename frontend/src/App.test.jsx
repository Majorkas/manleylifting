import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import App from './App'

vi.mock('./pages/CartPage', () => ({
  default: () => <div>Cart page</div>,
}))

vi.mock('./pages/CheckoutPage', () => ({
  default: () => <div>Checkout page</div>,
}))

vi.mock('./pages/OrderConfirmedPage', () => ({
  default: () => <div>Order confirmed page</div>,
}))

vi.mock('./pages/ShopPage', () => ({
  default: () => <div>Shop page</div>,
}))

vi.mock('./pages/ShopCollectionPage', () => ({
  default: () => <div>Shop collection page</div>,
}))

vi.mock('./pages/ShopProductPage', () => ({
  default: () => <div>Shop product page</div>,
}))

describe('App routes', () => {
  it('renders the real cart page for /cart', () => {
    render(
      <MemoryRouter initialEntries={['/cart']}>
        <App />
      </MemoryRouter>,
    )

    expect(screen.getByText('Cart page')).toBeInTheDocument()
  })

  it('renders the real checkout page for /checkout', () => {
    render(
      <MemoryRouter initialEntries={['/checkout']}>
        <App />
      </MemoryRouter>,
    )

    expect(screen.getByText('Checkout page')).toBeInTheDocument()
  })

  it('renders the real order-confirmed page for /order-confirmed', () => {
    render(
      <MemoryRouter initialEntries={['/order-confirmed']}>
        <App />
      </MemoryRouter>,
    )

    expect(screen.getByText('Order confirmed page')).toBeInTheDocument()
  })

  it('renders the real shop page for /shop', () => {
    render(
      <MemoryRouter initialEntries={['/shop']}>
        <App />
      </MemoryRouter>,
    )

    expect(screen.getByText('Shop page')).toBeInTheDocument()
  })

  it('renders the real collection page for /shop/collections/:handle', () => {
    render(
      <MemoryRouter initialEntries={['/shop/collections/inspection-kit']}>
        <App />
      </MemoryRouter>,
    )

    expect(screen.getByText('Shop collection page')).toBeInTheDocument()
  })

  it('renders the real product page for /shop/products/:handle', () => {
    render(
      <MemoryRouter initialEntries={['/shop/products/inspection-kit']}>
        <App />
      </MemoryRouter>,
    )

    expect(screen.getByText('Shop product page')).toBeInTheDocument()
  })
})
