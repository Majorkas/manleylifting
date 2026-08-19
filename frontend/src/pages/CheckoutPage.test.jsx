import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CheckoutPage from './CheckoutPage'
import { QueryProvider } from '../test/testQueryClient'
import { createTestQueryClient } from '../test/createTestQueryClient'
import { createOnsitePaymentIntent, getOnsiteCheckoutStatus, loadPendingCheckout } from '../utils/shopConfig'
import { getAccessToken, getAccountAddresses, getAccountBootstrap, registerCommerceAccount } from '../utils/portalApi'

const mockUseCart = vi.hoisted(() => vi.fn())
const mockPaymentElement = vi.hoisted(() => vi.fn())
const mockUseStripe = vi.hoisted(() => vi.fn())
const mockUseElements = vi.hoisted(() => vi.fn())

vi.mock('../components/ShopPageLayout', () => ({
  default: ({ children }) => <div>{children}</div>,
}))

vi.mock('../context/CartContext', () => ({
  useCart: () => mockUseCart(),
}))

const defaultCart = {
    cartItems: [{ handle: 'chain-block', title: 'Chain Block', quantity: 1, price: 10, currency: 'EUR' }],
    cartCount: 1,
    subtotal: 10,
    clearCart: vi.fn(),
}

vi.mock('../utils/portalApi', () => ({
  createAccountAddress: vi.fn(),
  getAccountAddresses: vi.fn(),
  getAccountBootstrap: vi.fn(),
  getAccessToken: vi.fn(),
  registerCommerceAccount: vi.fn(),
  hasPortalSession: vi.fn(() => false),
}))

vi.mock('../utils/shopConfig', async () => {
  const actual = await vi.importActual('../utils/shopConfig')
  return {
    ...actual,
    createOnsitePaymentIntent: vi.fn(),
    clearPendingCheckout: vi.fn(),
    saveCompletedCheckout: vi.fn(),
    loadPendingCheckout: vi.fn(() => null),
    getOnsiteCheckoutStatus: vi.fn(),
    savePendingCheckout: vi.fn(),
    generateCheckoutRef: vi.fn(() => 'chk_test_123'),
  }
})

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }) => <div>{children}</div>,
  PaymentElement: (props) => {
    mockPaymentElement(props)
    return <button type="button" onClick={props.onReady}>Mark payment element ready</button>
  },
  useStripe: () => mockUseStripe(),
  useElements: () => mockUseElements(),
}))

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() => Promise.resolve({})),
}))

vi.mock('../utils/usePageMeta', () => ({
  default: () => {},
}))

describe('checkout saved-address flow', () => {
  function renderWithQuery(ui) {
    return render(<QueryProvider client={createTestQueryClient()}>{ui}</QueryProvider>)
  }

  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    mockUseStripe.mockReturnValue(null)
    mockUseElements.mockReturnValue(null)
    mockUseCart.mockReturnValue(defaultCart)
    getAccountBootstrap.mockRejectedValue(new Error('not signed in'))
    getAccessToken.mockReturnValue('')
    getAccountAddresses.mockResolvedValue([
      {
        id: 7,
        label: 'Home',
        recipientName: 'Jane Doe',
        recipientPhone: '+353871234567',
        addressLine1: '1 Main Street',
        addressLine2: 'Apartment 2',
        city: 'Dublin',
        county: 'Dublin',
        postcode: 'D01',
        countryCode: 'IE',
        isDefaultShipping: true,
        isDefaultBilling: false,
      },
    ])
    registerCommerceAccount.mockResolvedValue({ ok: true })
    createOnsitePaymentIntent.mockImplementation(async (_items, checkoutRef, _customer, options) => ({
      checkoutRef,
      statusToken: options.statusToken,
      claimToken: options.claimToken,
      clientSecret: 'secret',
      amountTotalCents: 1000,
      currency: 'EUR',
    }))
  })

  it('guides an empty cart back to the shop without showing payment setup', async () => {
    mockUseCart.mockReturnValue({
      cartItems: [],
      cartCount: 0,
      subtotal: 0,
      clearCart: vi.fn(),
    })

    renderWithQuery(
      <MemoryRouter>
        <CheckoutPage />
      </MemoryRouter>,
    )

    expect((await screen.findAllByText(/your cart is empty/i)).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('link', { name: /browse products/i })).toHaveAttribute('href', '/shop')
    expect(screen.queryByRole('heading', { name: /customer details/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /continue to payment/i })).not.toBeInTheDocument()
  })

  it('sends the selected saved address as shipping details during payment preparation', async () => {
    const user = userEvent.setup()
    getAccountBootstrap.mockResolvedValue({
      fullName: 'Jane Doe',
      email: 'jane@example.com',
    })

    renderWithQuery(
      <MemoryRouter>
        <CheckoutPage />
      </MemoryRouter>,
    )

    const savedAddressSelect = await screen.findByLabelText(/Saved address/i)
    await user.selectOptions(savedAddressSelect, '7')
    await user.click(screen.getByRole('button', { name: /Continue to payment/i }))

    await waitFor(() => expect(createOnsitePaymentIntent).toHaveBeenCalled())
    expect(screen.getByTestId('delivery-address-heading')).toBeInTheDocument()
    expect(createOnsitePaymentIntent).toHaveBeenCalledWith(
      expect.any(Array),
      'chk_test_123',
      { name: 'Jane Doe', email: 'jane@example.com' },
      expect.objectContaining({
        antiBotToken: '',
        shipping: expect.objectContaining({
          name: 'Jane Doe',
          phone: '+353871234567',
          addressLine1: '1 Main Street',
          addressLine2: 'Apartment 2',
          city: 'Dublin',
          postcode: 'D01',
          countryCode: 'IE',
        }),
      }),
    )
  })

  it('offers to create an account for a guest checkout when the checkbox is selected', async () => {
    const user = userEvent.setup()
    getAccountBootstrap.mockRejectedValue(new Error('not signed in'))

    renderWithQuery(
      <MemoryRouter>
        <CheckoutPage />
      </MemoryRouter>,
    )

    await user.click(await screen.findByRole('button', { name: /Continue as guest/i }))
    await user.type(screen.getByLabelText(/Full Name/i), 'Guest User')
    await user.type(screen.getByLabelText(/Email/i), 'guest@example.com')
    await user.type(screen.getByLabelText(/Phone/i), '+353871234567')
    await screen.findByLabelText(/Address line 1/i)
    await user.type(screen.getByLabelText(/Address line 1/i), '10 Harbour Road')
    await user.type(screen.getByLabelText(/Town or city/i), 'Cork')
    await user.type(screen.getByLabelText(/Postcode/i), 'T12 3AB')
    await user.click(screen.getByLabelText(/Create an account/i))
    await user.type(screen.getByLabelText(/^Password$/i), 'StrongPassword123')
    await user.type(screen.getByLabelText(/^Confirm password$/i), 'StrongPassword123')
    await user.click(screen.getByRole('button', { name: /Continue to payment/i }))

    await waitFor(() => expect(registerCommerceAccount).toHaveBeenCalled())
    expect(registerCommerceAccount).toHaveBeenCalledWith(expect.objectContaining({
      email: 'guest@example.com',
      firstName: 'Guest',
      lastName: 'User',
      recipientName: 'Guest User',
      recipientPhone: '+353871234567',
      addressLine1: '10 Harbour Road',
      city: 'Cork',
      postcode: 'T12 3AB',
      countryCode: 'IE',
      password: 'StrongPassword123',
      acceptTerms: true,
      acceptPrivacy: true,
    }))
  })

  it('shows the default saved address in a card and lets the user change it', async () => {
    const user = userEvent.setup()
    getAccountBootstrap.mockResolvedValue({
      fullName: 'Jane Doe',
      email: 'jane@example.com',
    })

    renderWithQuery(
      <MemoryRouter>
        <CheckoutPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText(/1 Main Street/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /change address/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /change address/i }))
    expect(screen.getByLabelText(/Saved address/i)).toBeInTheDocument()
  })

  it('shows a customer-facing payment step and order refresh notice after preparation', async () => {
    const user = userEvent.setup()
    createOnsitePaymentIntent.mockImplementationOnce(async (_items, checkoutRef, _customer, options) => ({
      checkoutRef,
      statusToken: options.statusToken,
      claimToken: options.claimToken,
      clientSecret: 'secret',
      amountTotalCents: 1250,
      currency: 'EUR',
      lineItems: [
        { title: 'Chain Block', quantity: 1, unitAmountCents: 1000, lineTotalCents: 1000 },
        { title: 'Rope Sling', quantity: 1, unitAmountCents: 250, lineTotalCents: 250 },
      ],
      priceRefreshNotice: 'We refreshed your order with the latest pricing and stock availability.',
    }))

    renderWithQuery(
      <MemoryRouter>
        <CheckoutPage />
      </MemoryRouter>,
    )

    await user.click(await screen.findByRole('button', { name: /Continue as guest/i }))
    await user.type(screen.getByLabelText(/Full Name/i), 'Guest User')
    await user.type(screen.getByLabelText(/Email/i), 'guest@example.com')
    await user.click(screen.getByRole('button', { name: /Continue to payment/i }))

    expect(screen.queryByText(/Server-confirmed summary/i)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Payment/i })).toBeInTheDocument()
    expect(screen.getByText(/We refreshed your order with the latest pricing and stock availability/i)).toBeInTheDocument()
    expect(screen.getAllByText(/Chain Block/i).length).toBeGreaterThan(0)
    expect(screen.getByText('€12.50')).toBeInTheDocument()
  })

  it('renders the secure payment shell in an interaction-safe layer and opens the first payment method', async () => {
    const user = userEvent.setup()

    renderWithQuery(
      <MemoryRouter>
        <CheckoutPage />
      </MemoryRouter>,
    )

    await user.click(await screen.findByRole('button', { name: /Continue as guest/i }))
    await user.type(screen.getByLabelText(/Full Name/i), 'Guest User')
    await user.type(screen.getByLabelText(/Email/i), 'guest@example.com')
    await user.click(screen.getByRole('button', { name: /Continue to payment/i }))

    await waitFor(() => expect(mockPaymentElement).toHaveBeenCalled())
    const paymentShell = screen.getByTestId('checkout-payment-shell')
    expect(paymentShell).toHaveClass('pointer-events-auto')
    expect(paymentShell).toHaveClass('relative')
    expect(mockPaymentElement).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        layout: expect.objectContaining({
          type: 'tabs',
        }),
      }),
    }))
  })

  it('redirects to the pending order page after Stripe accepts the payment', async () => {
    const user = userEvent.setup()
    const confirmPayment = vi.fn().mockResolvedValue({ paymentIntent: { status: 'succeeded' } })
    const clearCart = vi.fn()
    mockUseStripe.mockReturnValue({ confirmPayment })
    mockUseElements.mockReturnValue({})
    mockUseCart.mockReturnValue({ ...defaultCart, clearCart })
    function CurrentPath() {
      return <output data-testid="current-path">{useLocation().pathname}</output>
    }

    renderWithQuery(
      <MemoryRouter initialEntries={['/checkout']}>
        <CheckoutPage />
        <CurrentPath />
      </MemoryRouter>,
    )

    await user.click(await screen.findByRole('button', { name: /Continue as guest/i }))
    await user.type(screen.getByLabelText(/Full Name/i), 'Guest User')
    await user.type(screen.getByLabelText(/Email/i), 'guest@example.com')
    await user.click(screen.getByRole('button', { name: /Continue to payment/i }))
    await user.click(await screen.findByRole('button', { name: /Mark payment element ready/i }))
    await user.click(screen.getByRole('button', { name: /Pay €10.00/i }))

    await waitFor(() => expect(screen.getByTestId('current-path')).toHaveTextContent('/order-confirmed'))
    expect(clearCart).not.toHaveBeenCalled()
  })

  it('shows a sign-in prompt for guests and lets them continue as guests', async () => {
    const user = userEvent.setup()

    renderWithQuery(
      <MemoryRouter>
        <CheckoutPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText(/Sign in to your account/i)).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: /Continue as guest/i }))

    expect(screen.getByLabelText(/Full Name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Email/i)).toBeInTheDocument()
  })

  it('keeps saved-address controls hidden until the guest chooses to continue', async () => {
    renderWithQuery(
      <MemoryRouter>
        <CheckoutPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText(/Sign in to your account/i)).toBeInTheDocument()
    expect(screen.queryByText(/Delivery address/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Saved address/i)).not.toBeInTheDocument()
  })

  it('creates a customer account for guests when the checkbox is selected', async () => {
    const user = userEvent.setup()

    renderWithQuery(
      <MemoryRouter>
        <CheckoutPage />
      </MemoryRouter>,
    )

    await user.click(await screen.findByRole('button', { name: /Continue as guest/i }))
    await user.type(screen.getByLabelText(/Full Name/i), 'Guest User')
    await user.type(screen.getByLabelText(/Email/i), 'guest@example.com')
    await user.type(screen.getByLabelText(/Phone/i), '+353871234567')
    await user.type(screen.getByLabelText(/Address line 1/i), '10 Harbour Road')
    await user.type(screen.getByLabelText(/Town or city/i), 'Cork')
    await user.type(screen.getByLabelText(/Postcode/i), 'T12 3AB')
    await user.click(screen.getByLabelText(/Create an account/i))
    await user.type(screen.getByLabelText(/^Password$/i), 'StrongPassword123')
    await user.type(screen.getByLabelText(/^Confirm password$/i), 'StrongPassword123')
    await user.click(screen.getByRole('button', { name: /Continue to payment/i }))

    await waitFor(() => expect(registerCommerceAccount).toHaveBeenCalled())
    expect(registerCommerceAccount).toHaveBeenCalledWith(expect.objectContaining({
      email: 'guest@example.com',
      firstName: 'Guest',
      lastName: 'User',
      recipientName: 'Guest User',
      recipientPhone: '+353871234567',
      addressLine1: '10 Harbour Road',
      city: 'Cork',
      postcode: 'T12 3AB',
      countryCode: 'IE',
      password: 'StrongPassword123',
      acceptTerms: true,
      acceptPrivacy: true,
    }))
  })

  it('prefills customer details when a signed-in account is detected', async () => {
    getAccountBootstrap.mockResolvedValue({
      fullName: 'Jane Smith',
      email: 'jane.smith@example.com',
    })

    renderWithQuery(
      <MemoryRouter>
        <CheckoutPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText(/Signed in as/i)).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByLabelText(/Full Name/i)).toHaveValue('Jane Smith')
      expect(screen.getByLabelText(/Email/i)).toHaveValue('jane.smith@example.com')
    })
  })

  it('shows a retry-safe timeout message when payment verification stalls', async () => {
    vi.useFakeTimers()
    try {
      loadPendingCheckout.mockReturnValue({ checkoutRef: 'chk_pending_001', statusToken: 'tok_pending_001' })
      getOnsiteCheckoutStatus.mockResolvedValue({ status: 'processing' })

      renderWithQuery(
        <MemoryRouter>
          <CheckoutPage />
        </MemoryRouter>,
      )

      await act(async () => {
        await vi.advanceTimersByTimeAsync(125000)
      })

      expect(screen.getByText(/still being verified/i)).toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent(/still being verified/i)
      expect(screen.getByRole('button', { name: /clear and retry/i })).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('prevents duplicate payment-intent requests while preparation is pending', async () => {
    const user = userEvent.setup()
    let resolvePaymentIntent
    let paymentIntentOptions
    createOnsitePaymentIntent.mockImplementationOnce(
      (_items, checkoutRef, _customer, options) => new Promise((resolve) => {
        paymentIntentOptions = { checkoutRef, options }
        resolvePaymentIntent = resolve
      }),
    )
    getAccountBootstrap.mockResolvedValue({
      fullName: 'Jane Doe',
      email: 'jane@example.com',
    })

    renderWithQuery(
      <MemoryRouter>
        <CheckoutPage />
      </MemoryRouter>,
    )

    await screen.findByText(/Signed in as/i)
    const prepareButton = await screen.findByRole('button', { name: /Continue to payment/i })
    await user.click(prepareButton)
    await user.click(prepareButton)

    expect(createOnsitePaymentIntent).toHaveBeenCalledTimes(1)
    expect(prepareButton).toBeDisabled()

    await act(async () => {
      resolvePaymentIntent({
        checkoutRef: paymentIntentOptions.checkoutRef,
        statusToken: paymentIntentOptions.options.statusToken,
        claimToken: paymentIntentOptions.options.claimToken,
        clientSecret: 'secret',
        amountTotalCents: 1000,
        currency: 'EUR',
      })
      await Promise.resolve()
    })
  })

  it('keeps checkout details available after a network failure so payment preparation can be retried', async () => {
    const user = userEvent.setup()
    getAccountBootstrap.mockResolvedValue({
      fullName: 'Jane Doe',
      email: 'jane@example.com',
    })
    createOnsitePaymentIntent
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockImplementationOnce(async (_items, checkoutRef, _customer, options) => ({
        checkoutRef,
        statusToken: options.statusToken,
        claimToken: options.claimToken,
        clientSecret: 'secret',
        amountTotalCents: 1000,
        currency: 'EUR',
      }))

    renderWithQuery(
      <MemoryRouter>
        <CheckoutPage />
      </MemoryRouter>,
    )

    await screen.findByText(/Signed in as/i)
    const prepareButton = await screen.findByRole('button', { name: /Continue to payment/i })
    await user.click(prepareButton)
    expect(await screen.findByText(/could not reach checkout/i)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/could not reach checkout/i)
    expect(screen.getByLabelText(/Full Name/i)).toHaveValue('Jane Doe')

    await user.click(screen.getByRole('button', { name: /Continue to payment/i }))
    expect(await screen.findByText(/Secure payment details loaded/i)).toBeInTheDocument()
    expect(createOnsitePaymentIntent).toHaveBeenCalledTimes(2)
  })
})
