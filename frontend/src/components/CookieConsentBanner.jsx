import { useEffect, useState } from 'react'
import { useAriaLive } from '../hooks/useAccessibility'
import { defaultPreferences, getRegionPolicy, loadConsent, saveConsent } from '../utils/cookieConsent'
import './CookieConsentBanner.css'

const CONSENT_VERSION = '1.0'

export default function CookieConsentBanner({ regionPolicy = getRegionPolicy(), onConsentChange = () => {} }) {
  const [initialConsent] = useState(() => loadConsent())
  const [showCookieBanner, setShowCookieBanner] = useState(() => !initialConsent)
  const [showPreferences, setShowPreferences] = useState(false)
  const [prefs, setPrefs] = useState(() => initialConsent?.preferences || defaultPreferences())
  const statusRef = useAriaLive('')

  useEffect(() => {
    if (initialConsent) {
      onConsentChange(initialConsent.type)
    }
  }, [initialConsent, onConsentChange])

  function finish(type, preferences) {
    saveConsent(type, preferences, regionPolicy)
    onConsentChange(type)
    setPrefs(preferences)
    setShowCookieBanner(false)
    setShowPreferences(false)
    if (statusRef.current) {
      statusRef.current.textContent = type === 'rejected_non_essential'
        ? 'Cookie consent rejected.'
        : 'Cookie consent accepted.'
    }
  }

  async function recordConsent(preferences) {
    try {
      await fetch('/api/consent/record/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          consent_version: CONSENT_VERSION,
          consent_categories: Object.entries(preferences)
            .filter(([, enabled]) => enabled)
            .map(([category]) => category),
        }),
      })
    } catch (error) {
      console.error('Failed to record consent:', error)
    }
  }

  async function onAcceptAll() {
    const preferences = {
      analytics: true,
      marketing: true,
      functional: true,
    }
    await recordConsent(preferences)
    finish('accepted_all', {
      ...preferences,
    })
  }

  async function onRejectNonEssential() {
    const preferences = {
      analytics: false,
      marketing: false,
      functional: true,
    }
    await recordConsent(preferences)
    finish('rejected_non_essential', preferences)
  }

  function onSavePreferences() {
    finish('custom_preferences', {
      ...prefs,
      functional: true,
    })
  }

  if (!showCookieBanner) return null

  return (
    <div className="cookie-panel" role="dialog" aria-live="polite" aria-label="Cookie preferences">
      <div className="mx-auto w-full max-w-7xl px-4 py-4 md:px-6 md:py-5">
        <div className="rounded-xl border border-slate-300 bg-white p-4 md:p-6">
          <p className="text-sm font-bold uppercase tracking-[0.12em] text-[#C61F2A]">Cookies</p>
          <h3 className="mt-1 text-lg font-extrabold text-[#123A7A]">Your Privacy Choices</h3>
          <p className="mt-2 text-sm text-slate-600">
            Essential cookies are always on. Optional cookies depend on your preference. Policy
            version {CONSENT_VERSION}.{' '}
            <a href="/cookie-policy#cookies">View our Cookie Policy</a>.
          </p>

          {showPreferences && (
            <div className="mt-4 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
              <label className="flex items-center justify-between gap-4">
                <span>Functional cookies (required)</span>
                <input type="checkbox" checked disabled aria-label="Functional cookies are required" />
              </label>
              <label className="flex items-center justify-between gap-4">
                <span>Analytics cookies</span>
                <input
                  type="checkbox"
                  checked={prefs.analytics}
                  onChange={(e) => setPrefs((p) => ({ ...p, analytics: e.target.checked }))}
                />
              </label>
              <label className="flex items-center justify-between gap-4">
                <span>Marketing cookies</span>
                <input
                  type="checkbox"
                  checked={prefs.marketing}
                  onChange={(e) => setPrefs((p) => ({ ...p, marketing: e.target.checked }))}
                />
              </label>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={onAcceptAll} aria-label="Accept all cookies" className="rounded-md bg-[#123A7A] px-4 py-2 text-sm font-bold text-white">
              Accept All
            </button>
            <button type="button" onClick={onRejectNonEssential} aria-label="Reject optional cookies" className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">
              Reject Non-Essential
            </button>
            <button type="button" onClick={() => setShowPreferences((v) => !v)} aria-expanded={showPreferences} aria-label="Manage cookie preferences" className="rounded-md border border-[#C61F2A] px-4 py-2 text-sm font-semibold text-[#C61F2A]">
              {showPreferences ? 'Hide Preferences' : 'Manage Preferences'}
            </button>
            {showPreferences && (
              <button type="button" onClick={onSavePreferences} aria-label="Save cookie preferences" className="rounded-md bg-[#C61F2A] px-4 py-2 text-sm font-bold text-white">
                Save Preferences
              </button>
            )}
          </div>
        </div>
      </div>
      <div ref={statusRef} className="sr-only" role="status" aria-live="polite" />
    </div>
  )
}
