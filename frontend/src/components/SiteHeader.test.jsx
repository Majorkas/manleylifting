import { act, render, screen, within, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

import SiteHeader from './SiteHeader'
import { SESSION_CHANGED_EVENT } from '../utils/portalApi'

const sessionStorageKey = 'manley-portal-session-v1'

function renderHeader() {
  return render(
    <MemoryRouter>
      <SiteHeader
        navbarLogo="/logo-navbar.png"
        isScrolled
        isMobileMenuOpen={false}
        onToggleMobileMenu={() => {}}
        onCloseMobileMenu={() => {}}
        navItems={[
          { label: 'Home', to: '/' },
          { label: 'Shop', to: '/shop' },
          { label: 'Contact', to: '/contact' },
        ]}
      />
    </MemoryRouter>,
  )
}

describe('SiteHeader account navigation', () => {
  afterEach(() => {
    window.localStorage.removeItem(sessionStorageKey)
  })

  it('renders Home, Shop, Contact with Login at the end for signed-out visitors', () => {
    const { container } = renderHeader()

    const desktopNav = container.querySelector('nav.hidden.items-center.gap-8.text-sm.font-semibold.md\\:flex')
    expect(desktopNav).toBeTruthy()

    const links = within(desktopNav).getAllByRole('link')
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      'Home',
      'Shop',
      'Contact',
      'Login',
    ])

    const loginLink = within(desktopNav).getByRole('link', { name: 'Login' })
    expect(loginLink).toHaveAttribute('href', '/account/login')
  })

  it('swaps Login for profile icon when an authenticated portal session is present', async () => {
    const { container } = renderHeader()

    act(() => {
      window.localStorage.setItem(sessionStorageKey, '1')
      window.dispatchEvent(new CustomEvent(SESSION_CHANGED_EVENT))
    })

    const desktopNav = container.querySelector('nav.hidden.items-center.gap-8.text-sm.font-semibold.md\\:flex')
    expect(desktopNav).toBeTruthy()

    await waitFor(() => {
      expect(within(desktopNav).queryByRole('link', { name: 'Login' })).not.toBeInTheDocument()
    })

    const profileLink = within(desktopNav).getByRole('link', {
      name: 'Open account profile',
    })
    expect(profileLink).toHaveAttribute('href', '/account')
    expect(screen.getByRole('link', { name: 'My account' })).toBeInTheDocument()
  })
})
