import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import QuantityAddToCart from './QuantityAddToCart'

describe('QuantityAddToCart', () => {
  it('hides quantity controls and mutes the add button when unavailable', () => {
    render(
      <QuantityAddToCart
        buttonLabel="Out of stock"
        disabled
        onAdd={vi.fn()}
        productTitle="Load Test Record Folder"
      />,
    )

    expect(screen.queryByRole('spinbutton', { name: /quantity for load test record folder/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /increase quantity/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Out of stock' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Out of stock' })).toHaveClass('disabled:bg-slate-200')
  })
})