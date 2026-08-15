import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PortalEntryLink from './PortalEntryLink'
import { getAccountBootstrap, hasPortalSession } from '../utils/portalApi'

vi.mock('../utils/portalApi', () => ({
  getAccountBootstrap: vi.fn(),
  hasPortalSession: vi.fn(),
}))

function renderEntryLink() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <PortalEntryLink className="portal-link">Customer Portal</PortalEntryLink>
      <Routes>
        <Route path="/" element={<div>Home</div>} />
        <Route path="/portal" element={<div>Portal Dashboard</div>} />
        <Route path="/portal-demo" element={<div>Portal Demo</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PortalEntryLink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hasPortalSession.mockReturnValue(false)
  })

  it('opens the mock demo for users without portal access', async () => {
    const user = userEvent.setup()
    renderEntryLink()

    await user.click(screen.getByRole('link', { name: 'Customer Portal' }))

    expect(await screen.findByText('Portal Demo')).toBeInTheDocument()
    expect(getAccountBootstrap).not.toHaveBeenCalled()
  })

  it('opens the real portal for authenticated portal users', async () => {
    const user = userEvent.setup()
    hasPortalSession.mockReturnValue(true)
    getAccountBootstrap.mockResolvedValue({ capabilities: { canAccessPortal: true } })
    renderEntryLink()

    await user.click(screen.getByRole('link', { name: 'Customer Portal' }))

    expect(await screen.findByText('Portal Dashboard')).toBeInTheDocument()
    await waitFor(() => expect(getAccountBootstrap).toHaveBeenCalledTimes(1))
  })

  it('opens the mock demo for authenticated users without portal access', async () => {
    const user = userEvent.setup()
    hasPortalSession.mockReturnValue(true)
    getAccountBootstrap.mockResolvedValue({ capabilities: { canAccessPortal: false } })
    renderEntryLink()

    await user.click(screen.getByRole('link', { name: 'Customer Portal' }))

    expect(await screen.findByText('Portal Demo')).toBeInTheDocument()
  })
})
