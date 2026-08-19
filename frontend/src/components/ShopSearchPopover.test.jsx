import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import ShopSearchPopover from './ShopSearchPopover'

vi.mock('../hooks/useCatalogQueries', () => ({
  useFeaturedProductsQuery: () => ({
    data: [
      {
        handle: 'electric-chain-hoist-2t',
        title: 'Electric Chain Hoist (2T)',
        description: 'Powered lifting for repetitive cycles.',
        price: 620,
        currency: 'EUR',
        imageUrl: '',
        inventoryTracked: true,
        availableQty: 4,
      },
    ],
    isPending: false,
  }),
}))

describe('ShopSearchPopover', () => {
  it('opens a searchable product popover and links directly to a result', async () => {
    const user = userEvent.setup()

    render(
      <MemoryRouter>
        <ShopSearchPopover />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: /search products/i }))
    await user.type(screen.getByRole('searchbox', { name: /search shop products/i }), 'hoist')

    expect(screen.getByRole('link', { name: /electric chain hoist/i })).toHaveAttribute(
      'href',
      '/shop/products/electric-chain-hoist-2t',
    )
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup()

    render(
      <MemoryRouter>
        <ShopSearchPopover />
      </MemoryRouter>,
    )

    const trigger = screen.getByRole('button', { name: /search products/i })
    await user.click(trigger)
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: /shop product search/i })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
