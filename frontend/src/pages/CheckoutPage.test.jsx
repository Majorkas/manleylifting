import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CheckoutPage from './CheckoutPage'
import { createOnsitePaymentIntent } from '../utils/shopConfig'
import { getAccountAddresses, getAccountBootstrap, portalLogin, registerCommerceAccount } from '../utils/portalApi'

vi.mock('../components/ShopPageLayout', () => ({
  default: ({ children }) => <div>{children}</div>,
}))

vi.mock('../context/CartContext', () => ({
  useCart: () => ({
    cartItems: [{ handle: 'chain-block', title: 'Chain Block', quantity: 1, price: 10, currency: 'EUR' }],
    cartCount: 1,
    subtotal: 10,
    clearCart: vi.fn(),
  }),
}))

vi.mock('../utils/portalApi', () => ({
  createAccountAddress: vi.fn(),
  getAccountAddresses: vi.fn(),
  getAccountBootstrap: vi.fn(),
  portalLogin: vi.fn(),
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
    savePendingCheckout: vi.fn(),
    generateCheckoutRef: vi.fn(() => 'chk_test_123'),
  }
})

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }) => <div>{children}</div>,
  PaymentElement: () => null,
  useStripe: () => null,
  useElements: () => null,
}))

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() => Promise.resolve({})),
}))

vi.mock('../utils/usePageMeta', () => ({
  default: () => {},
}))

describe('checkout saved-address flow', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    getAccountBootstrap.mockRejectedValue(new Error('not signed in'))
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
    createOnsitePaymentIntent.mockResolvedValue({
      checkoutRef: 'chk_test_123',
      statusToken: 'status-token',
      clientSecret: 'secret',
      amountTotalCents: 1000,
      currency: 'EUR',
    })
  })

  it('sends the selected saved address as shipping details during payment preparation', async () => {
    const user = userEvent.setup()
    getAccountBootstrap.mockResolvedValue({
      fullName: 'Jane Doe',
      email: 'jane@example.com',
    })

    render(
      <MemoryRouter>
        <CheckoutPage />
      </MemoryRouter>,
    )

    const savedAddressSelect = await screen.findByLabelText(/Saved address/i)
    await user.selectOptions(savedAddressSelect, '7')
    await user.click(screen.getByRole('button', { name: /Prepare Secure Payment/i }))

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

    render(
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
    await user.click(screen.getByRole('button', { name: /Prepare Secure Payment/i }))

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

    render(
      <MemoryRouter>
        <CheckoutPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText(/1 Main Street/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /change address/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /change address/i }))
    expect(screen.getByLabelText(/Saved address/i)).toBeInTheDocument()
  })

  it('shows server-confirmed pricing and a stale-cart notice after payment preparation', async () => {
    const user = userEvent.setup()
    createOnsitePaymentIntent.mockResolvedValue({
      checkoutRef: 'chk_test_123',
      statusToken: 'status-token',
      clientSecret: 'secret',
      amountTotalCents: 1250,
      currency: 'EUR',
      lineItems: [
        { title: 'Chain Block', quantity: 1, unitAmountCents: 1000, lineTotalCents: 1000 },
        { title: 'Rope Sling', quantity: 1, unitAmountCents: 250, lineTotalCents: 250 },
      ],
      priceRefreshNotice: 'We refreshed your order with the latest pricing and stock availability.',
    })

    render(
      <MemoryRouter>
        <CheckoutPage />
      </MemoryRouter>,
    )

    await user.click(await screen.findByRole('button', { name: /Continue as guest/i }))
    await user.type(screen.getByLabelText(/Full Name/i), 'Guest User')
    await user.type(screen.getByLabelText(/Email/i), 'guest@example.com')
    await user.click(screen.getByRole('button', { name: /Prepare Secure Payment/i }))

    expect(await screen.findByText(/Server-confirmed summary/i)).toBeInTheDocument()
    expect(screen.getByText(/We refreshed your order with the latest pricing and stock availability/i)).toBeInTheDocument()
    expect(screen.getAllByText(/Chain Block/i).length).toBeGreaterThan(0)
    expect(screen.getByText('€12.50')).toBeInTheDocument()
  })

  it('shows a sign-in prompt for guests and lets them continue as guests', async () => {
    const user = userEvent.setup()

    render(
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
    render(
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

    render(
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
    await user.click(screen.getByRole('button', { name: /Prepare Secure Payment/i }))

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

    render(
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
})
