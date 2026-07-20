import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PortalLoginPage from './PortalLoginPage'

vi.mock('../components/PortalLayout', () => ({
  default: ({ children }) => <div>{children}</div>,
}))

vi.mock('../utils/portalApi', () => ({
  clearPortalSession: vi.fn(),
  hasPortalSession: vi.fn(),
  portalLogin: vi.fn(),
}))

import { clearPortalSession, hasPortalSession, portalLogin } from '../utils/portalApi'

function renderLoginPage(initialEntries = ['/portal/login']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/portal/login" element={<PortalLoginPage />} />
        <Route path="/portal" element={<div>Portal Home</div>} />
        <Route path="/portal/*" element={<div>Portal Home</div>} />
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

  it('redirects authenticated users to preserved deep link target when present', () => {
    hasPortalSession.mockReturnValue(true)

    renderLoginPage([{ pathname: '/portal/login', state: { redirectTo: '/portal?companyId=1&eqId=101' } }])

    expect(screen.getByText('Portal Home')).toBeInTheDocument()
  })

  it('redirects authenticated users using redirect query parameter when present', () => {
    hasPortalSession.mockReturnValue(true)

    renderLoginPage(['/portal/login?redirect=%2Fportal%3FcompanyId%3D1%26eqId%3D101'])

    expect(screen.getByText('Portal Home')).toBeInTheDocument()
  })

  it('shows the login form for signed-out users', () => {
    hasPortalSession.mockReturnValue(false)

    renderLoginPage()

    expect(screen.getByRole('heading', { name: 'Portal Login' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument()
  })

  it('requires full login after session expiry even when a stale session is present', () => {
    hasPortalSession.mockReturnValue(true)

    renderLoginPage([{ pathname: '/portal/login', state: { sessionExpired: true } }])

    expect(screen.getByRole('heading', { name: 'Portal Login' })).toBeInTheDocument()
    expect(screen.queryByText('Portal Home')).not.toBeInTheDocument()
    expect(clearPortalSession).toHaveBeenCalledTimes(1)
  })

  it('trims whitespace from the username before submitting', async () => {
    hasPortalSession.mockReturnValue(false)
    portalLogin.mockResolvedValue({})
    const user = userEvent.setup()

    renderLoginPage()

    await user.type(screen.getByRole('textbox', { name: 'Username' }), '  DemoUser  ')
    await user.type(screen.getByLabelText('Password'), 'testpass123')
    await user.click(screen.getByRole('button', { name: 'Sign In' }))

    expect(portalLogin).toHaveBeenCalledWith('DemoUser', 'testpass123')
  })

  it('navigates to preserved redirect target after successful login', async () => {
    hasPortalSession.mockReturnValue(false)
    portalLogin.mockResolvedValue({})
    const user = userEvent.setup()

    renderLoginPage([{ pathname: '/portal/login', state: { redirectTo: '/portal?companyId=1&eqId=101' } }])

    await user.type(screen.getByRole('textbox', { name: 'Username' }), 'demo_owner')
    await user.type(screen.getByLabelText('Password'), 'DemoPass!234')
    await user.click(screen.getByRole('button', { name: 'Sign In' }))

    expect(await screen.findByText('Portal Home')).toBeInTheDocument()
  })

  it('navigates to redirect query target after successful login', async () => {
    hasPortalSession.mockReturnValue(false)
    portalLogin.mockResolvedValue({})
    const user = userEvent.setup()

    renderLoginPage(['/portal/login?redirect=%2Fportal%3FcompanyId%3D1%26eqId%3D101'])

    await user.type(screen.getByRole('textbox', { name: 'Username' }), 'demo_owner')
    await user.type(screen.getByLabelText('Password'), 'DemoPass!234')
    await user.click(screen.getByRole('button', { name: 'Sign In' }))

    expect(await screen.findByText('Portal Home')).toBeInTheDocument()
  })

  it('toggles password visibility', async () => {
    hasPortalSession.mockReturnValue(false)
    const user = userEvent.setup()

    renderLoginPage()

    const passwordInput = screen.getByLabelText('Password')
    expect(passwordInput).toHaveAttribute('type', 'password')

    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(passwordInput).toHaveAttribute('type', 'text')

    await user.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(passwordInput).toHaveAttribute('type', 'password')
  })
})
