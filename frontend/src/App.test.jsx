import { act, render, screen } from '@testing-library/react'
import axe from 'axe-core'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import App from './App'

vi.mock('./components/ShopPageLayout', () => ({
  default: ({ children }) => <div>{children}</div>,
}))

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
  it('renders the home page hierarchy and primary actions', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Manley Lifting', level: 1 })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /open customer portal/i })).toHaveLength(2)
    expect(screen.getAllByRole('link', { name: /talk to our team/i })).toHaveLength(2)
    expect(screen.getByRole('heading', { name: /keep lifting operations safe/i })).toBeInTheDocument()
  })

  it('uses skeleton blocks instead of loading text while a route loads', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/checkout']}>
        <App />
      </MemoryRouter>,
    )

    expect(screen.getByRole('status', { name: /loading page/i })).toBeInTheDocument()
    expect(screen.getByTestId('page-loading-skeleton')).toBeInTheDocument()
    expect(screen.queryByText('Loading page...')).not.toBeInTheDocument()
    let accessibilityResults
    await act(async () => {
      accessibilityResults = await axe.run(container)
    })
    expect(accessibilityResults.violations).toEqual([])
    expect(await screen.findByText('Checkout page')).toBeInTheDocument()
  })

  it('renders the real cart page for /cart', async () => {
    render(
      <MemoryRouter initialEntries={['/cart']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Cart page')).toBeInTheDocument()
  })

  it('renders the real checkout page for /checkout', async () => {
    render(
      <MemoryRouter initialEntries={['/checkout']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Checkout page')).toBeInTheDocument()
  })

  it('renders the real order-confirmed page for /order-confirmed', async () => {
    render(
      <MemoryRouter initialEntries={['/order-confirmed']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Order confirmed page')).toBeInTheDocument()
  })

  it('renders the real shop page for /shop', async () => {
    render(
      <MemoryRouter initialEntries={['/shop']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Shop page')).toBeInTheDocument()
  })

  it('renders the real collection page for /shop/collections/:handle', async () => {
    render(
      <MemoryRouter initialEntries={['/shop/collections/inspection-kit']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Shop collection page')).toBeInTheDocument()
  })

  it('renders the real product page for /shop/products/:handle', async () => {
    render(
      <MemoryRouter initialEntries={['/shop/products/inspection-kit']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Shop product page')).toBeInTheDocument()
  })

  it('renders the legal/privacy pages for policy routes', async () => {
    render(
      <MemoryRouter initialEntries={['/privacy-policy']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByText(/this privacy policy explains/i)).toBeInTheDocument()

    render(
      <MemoryRouter initialEntries={['/accessibility-statement']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByText(/manley lifting is committed to making/i)).toBeInTheDocument()
  })

  it('renders a not-found page for unknown routes', async () => {
    render(
      <MemoryRouter initialEntries={['/definitely-missing-route']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByText(/page not found/i)).toBeInTheDocument()
  })
})
