import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AccessibleErrorBoundary from './AccessibleErrorBoundary'
import CookieConsentBanner from './CookieConsentBanner'

function ThrowingChild() {
  throw new Error('Test failure')
}

describe('CookieConsentBanner', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('shows on first visit and records accepted consent', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))

    render(<CookieConsentBanner />)

    expect(screen.getByRole('dialog', { name: /cookie preferences/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /accept all cookies/i }))

    expect(fetch).toHaveBeenCalledWith(
      '/api/consent/record/',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(JSON.parse(localStorage.getItem('manley-cookie-consent-v1')).policyVersion).toBe(1)
    expect(screen.queryByRole('dialog', { name: /cookie preferences/i })).not.toBeInTheDocument()
  })
})

describe('AccessibleErrorBoundary', () => {
  it('announces a render error with a retry action', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <AccessibleErrorBoundary>
        <ThrowingChild />
      </AccessibleErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Test failure')
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    consoleError.mockRestore()
  })
})
