import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OrderConfirmedPage from './OrderConfirmedPage'
import * as shopConfig from '../utils/shopConfig'

vi.mock('../components/ShopPageLayout', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../utils/usePageMeta', () => ({ default: () => {} }))
vi.mock('../utils/portalApi', () => ({ registerCommerceAccount: vi.fn() }))

vi.mock('../utils/shopConfig', async () => {
  const actual = await vi.importActual('../utils/shopConfig')
  return { ...actual, getOnsiteOrderSummary: vi.fn() }
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
