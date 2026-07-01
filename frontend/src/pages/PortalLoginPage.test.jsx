import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PortalLoginPage from './PortalLoginPage'

vi.mock('../components/PortalLayout', () => ({
  default: ({ children }) => <div>{children}</div>,
}))

vi.mock('../utils/portalApi', () => ({
  hasPortalSession: vi.fn(),
  portalLogin: vi.fn(),
}))

import { hasPortalSession } from '../utils/portalApi'

function renderLoginPage() {
  return render(
    <MemoryRouter initialEntries={['/portal/login']}>
      <Routes>
        <Route path="/portal/login" element={<PortalLoginPage />} />
        <Route path="/portal" element={<div>Portal Home</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PortalLoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('redirects authenticated users to the portal dashboard', () => {
    hasPortalSession.mockReturnValue(true)

    renderLoginPage()

    expect(screen.getByText('Portal Home')).toBeInTheDocument()
  })

  it('shows the login form for signed-out users', () => {
    hasPortalSession.mockReturnValue(false)

    renderLoginPage()

    expect(screen.getByRole('heading', { name: 'Portal Login' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument()
  })
})