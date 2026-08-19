import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import CartDrawer from './CartDrawer'

const defaultProps = {
  items: [],
  subtotal: 0,
  onClose: vi.fn(),
  onIncreaseQuantity: vi.fn(),
  onDecreaseQuantity: vi.fn(),
  onRemoveItem: vi.fn(),
}

describe('CartDrawer', () => {
  it('keeps the closed drawer out of the accessibility tree', () => {
    render(
      <MemoryRouter>
        <CartDrawer {...defaultProps} open={false} />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('dialog', { name: /shopping cart/i })).not.toBeInTheDocument()
  })

  it('closes when Escape is pressed while open', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <MemoryRouter>
        <CartDrawer {...defaultProps} open onClose={onClose} />
      </MemoryRouter>,
    )

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
