import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import AccountSectionTabs from './AccountSectionTabs'

describe('AccountSectionTabs', () => {
  it('shows Orders, Addresses, and Security for shopping-capable accounts', () => {
    render(
      <MemoryRouter>
        <AccountSectionTabs />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Orders' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Addresses' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Security' })).toBeInTheDocument()
  })

  it('hides Orders and Addresses for owner/office accounts without shopping access', () => {
    render(
      <MemoryRouter>
        <AccountSectionTabs hideShoppingTabs />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('link', { name: 'Orders' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Addresses' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Security' })).toBeInTheDocument()
  })
})
