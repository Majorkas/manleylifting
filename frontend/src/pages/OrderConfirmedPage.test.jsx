import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OrderConfirmedPage from './OrderConfirmedPage'
import * as shopConfig from '../utils/shopConfig'
import * as portalApi from '../utils/portalApi'

const mockClearCart = vi.hoisted(() => vi.fn())

vi.mock('../components/ShopPageLayout', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../utils/usePageMeta', () => ({ default: () => {} }))
vi.mock('../utils/portalApi', () => ({
  getAccountBootstrap: vi.fn(() => Promise.reject(new Error('not signed in'))),
  registerCommerceAccount: vi.fn(),
}))
vi.mock('../context/CartContext', () => ({ useCart: () => ({ clearCart: mockClearCart }) }))

vi.mock('../utils/shopConfig', async () => {
  const actual = await vi.importActual('../utils/shopConfig')
  return { ...actual, getOnsiteCheckoutStatus: vi.fn(), getOnsiteOrderSummary: vi.fn() }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('OrderConfirmedPage', () => {
  function renderOrder(paymentStatus) {
    vi.spyOn(shopConfig, 'loadCompletedCheckout').mockReturnValue({ checkoutRef: 'checkout-1', statusToken: 'token-1' })
    shopConfig.getOnsiteOrderSummary.mockResolvedValue({
      paymentStatus,
      fulfillmentStatus: 'unfulfilled',
      customerEmail: 'customer@example.com',
      amountTotalCents: 1000,
      currency: 'EUR',
      lineItems: [],
    })

    render(<MemoryRouter><OrderConfirmedPage /></MemoryRouter>)
  }

  it('shows processing state until the backend verifies payment', async () => {
    renderOrder('processing')

    await waitFor(() => expect(screen.getByText(/payment is processing/i)).toBeInTheDocument())
    expect(screen.queryByText('Order Confirmed')).not.toBeInTheDocument()
  })

  it('shows the order reference and date when payment is confirmed', async () => {
    vi.spyOn(shopConfig, 'loadCompletedCheckout').mockReturnValue({ checkoutRef: 'checkout-1', statusToken: 'token-1' })
    shopConfig.getOnsiteOrderSummary.mockResolvedValue({
      paymentStatus: 'paid',
      fulfillmentStatus: 'unfulfilled',
      customerEmail: 'customer@example.com',
      orderNumber: 'MNL-260819-ABC123',
      createdAt: '2026-08-19T12:00:00Z',
      amountTotalCents: 1000,
      currency: 'EUR',
      lineItems: [],
    })

    render(<MemoryRouter><OrderConfirmedPage /></MemoryRouter>)

    expect(await screen.findByText('MNL-260819-ABC123')).toBeInTheDocument()
    expect(screen.getByText(/Order date/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copy order number/i })).toBeInTheDocument()
  })

  it('hides the guest account offer for signed-in customers', async () => {
    vi.spyOn(shopConfig, 'loadCompletedCheckout').mockReturnValue({ checkoutRef: 'checkout-1', statusToken: 'token-1' })
    vi.spyOn(shopConfig, 'loadGuestCheckoutOffer').mockReturnValue({
      email: 'customer@example.com',
      fullName: 'Customer Example',
    })
    portalApi.getAccountBootstrap.mockResolvedValue({ email: 'customer@example.com' })
    shopConfig.getOnsiteOrderSummary.mockResolvedValue({
      paymentStatus: 'paid',
      fulfillmentStatus: 'unfulfilled',
      customerEmail: 'customer@example.com',
      amountTotalCents: 1000,
      currency: 'EUR',
      lineItems: [],
    })

    render(<MemoryRouter><OrderConfirmedPage /></MemoryRouter>)

    await screen.findByText(/payment received/i)
    expect(screen.queryByText(/create your account for faster future orders/i)).not.toBeInTheDocument()
  })

  it('promotes a pending checkout to the full confirmation after backend payment acceptance', async () => {
    vi.spyOn(shopConfig, 'loadCompletedCheckout').mockReturnValue(null)
    vi.spyOn(shopConfig, 'loadPendingCheckout').mockReturnValue({ checkoutRef: 'checkout-1', statusToken: 'token-1' })
    shopConfig.getOnsiteCheckoutStatus.mockResolvedValue({ status: 'paid' })
    shopConfig.getOnsiteOrderSummary
      .mockResolvedValueOnce({
        paymentStatus: 'pending',
        fulfillmentStatus: 'unfulfilled',
        amountTotalCents: 1000,
        currency: 'EUR',
        lineItems: [],
      })
      .mockResolvedValueOnce({
        paymentStatus: 'paid',
        fulfillmentStatus: 'unfulfilled',
        orderNumber: 'MNL-260819-PAID01',
        customerEmail: 'customer@example.com',
        amountTotalCents: 1000,
        currency: 'EUR',
        lineItems: [],
      })

    render(<MemoryRouter><OrderConfirmedPage /></MemoryRouter>)

    expect(await screen.findByText('MNL-260819-PAID01')).toBeInTheDocument()
    expect(screen.getByText(/order confirmed/i)).toBeInTheDocument()
    expect(shopConfig.getOnsiteCheckoutStatus).toHaveBeenCalledWith('checkout-1', 'token-1')
    expect(shopConfig.getOnsiteOrderSummary).toHaveBeenCalledTimes(2)
  })

  it('keeps polling when a completed checkout marker still has a pending payment summary', async () => {
    vi.spyOn(shopConfig, 'loadCompletedCheckout').mockReturnValue({ checkoutRef: 'checkout-1', statusToken: 'token-1' })
    shopConfig.getOnsiteCheckoutStatus.mockResolvedValue({ status: 'paid' })
    shopConfig.getOnsiteOrderSummary
      .mockResolvedValueOnce({
        paymentStatus: 'pending',
        fulfillmentStatus: 'unfulfilled',
        amountTotalCents: 1000,
        currency: 'EUR',
        lineItems: [],
      })
      .mockResolvedValueOnce({
        paymentStatus: 'paid',
        fulfillmentStatus: 'unfulfilled',
        orderNumber: 'MNL-260819-PAID02',
        customerEmail: 'customer@example.com',
        amountTotalCents: 1000,
        currency: 'EUR',
        lineItems: [],
      })

    render(<MemoryRouter><OrderConfirmedPage /></MemoryRouter>)

    expect(await screen.findByText('MNL-260819-PAID02')).toBeInTheDocument()
    expect(screen.getByText(/order confirmed/i)).toBeInTheDocument()
    expect(shopConfig.getOnsiteCheckoutStatus).toHaveBeenCalledWith('checkout-1', 'token-1')
  })

  it.each(['failed', 'canceled'])('shows an actionable state for %s payments', async (paymentStatus) => {
    renderOrder(paymentStatus)

    await waitFor(() => expect(screen.getAllByText(/payment could not be completed/i).length).toBeGreaterThan(0))
    expect(screen.queryByText('Order Confirmed')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /contact support/i })).toBeInTheDocument()
  })

  it('offers an accessible retry after a transient confirmation failure', async () => {
    vi.spyOn(shopConfig, 'loadCompletedCheckout').mockReturnValue({ checkoutRef: 'checkout-1', statusToken: 'token-1' })
    shopConfig.getOnsiteOrderSummary
      .mockRejectedValueOnce(new Error('Temporary confirmation failure'))
      .mockResolvedValueOnce({
        paymentStatus: 'paid',
        fulfillmentStatus: 'unfulfilled',
        customerEmail: 'customer@example.com',
        amountTotalCents: 1000,
        currency: 'EUR',
        lineItems: [],
      })

    const user = userEvent.setup()
    const { container } = render(<MemoryRouter><OrderConfirmedPage /></MemoryRouter>)

    expect(await screen.findByRole('alert')).toHaveTextContent(/temporary confirmation failure/i)
    const accessibilityResults = await axe.run(container)
    expect(accessibilityResults.violations).toEqual([])
    await user.click(screen.getByRole('button', { name: /retry confirmation/i }))

    await waitFor(() => expect(screen.getByText(/order confirmed/i)).toBeInTheDocument())
    expect(shopConfig.getOnsiteOrderSummary).toHaveBeenCalledTimes(2)
  })
})
