import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import CartToast from './CartToast'

describe('CartToast', () => {
  it('announces additions and links directly to the cart', () => {
    render(
      <MemoryRouter>
        <CartToast
          toast={{ title: 'Chain Block', addedCost: '€10.00', cartValue: '€10.00' }}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByRole('link', { name: /view cart/i })).toHaveAttribute('href', '/cart')
    expect(screen.getByRole('button', { name: /close cart notification/i })).toBeInTheDocument()
  })
})
