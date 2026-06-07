import { useEffect, useState } from 'react'
import { defaultPreferences, loadConsent, saveConsent } from '../utils/cookieConsent'

export default function CookieConsentBanner({ regionPolicy, onConsentChange }) {
  const [showCookieBanner, setShowCookieBanner] = useState(false)
  const [showPreferences, setShowPreferences] = useState(false)
  const [prefs, setPrefs] = useState(defaultPreferences())

  useEffect(() => {
    const saved = loadConsent()
    if (saved) {
      setPrefs(saved.preferences || defaultPreferences())
      onConsentChange(saved.type)
      setShowCookieBanner(false)
      return
    }
    setShowCookieBanner(true)
  }, [onConsentChange])

  function finish(type, preferences) {
    saveConsent(type, preferences, regionPolicy)
    onConsentChange(type)
    setPrefs(preferences)
    setShowCookieBanner(false)
    setShowPreferences(false)
  }

  function onAcceptAll() {
    finish('accepted_all', {
      analytics: true,
      marketing: true,
      functional: true,
    })
  }

  function onRejectNonEssential() {
    finish('rejected_non_essential', {
      analytics: false,
      marketing: false,
      functional: true,
    })
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
            Essential cookies are always on. Optional cookies depend on your preference.
          </p>

          {showPreferences && (
            <div className="mt-4 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
              <label className="flex items-center justify-between gap-4">
                <span>Functional cookies (required)</span>
                <input type="checkbox" checked disabled />
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
            <button onClick={onAcceptAll} className="rounded-md bg-[#123A7A] px-4 py-2 text-sm font-bold text-white">
              Accept All
            </button>
            <button onClick={onRejectNonEssential} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">
              Reject Non-Essential
            </button>
            <button onClick={() => setShowPreferences((v) => !v)} className="rounded-md border border-[#C61F2A] px-4 py-2 text-sm font-semibold text-[#C61F2A]">
              {showPreferences ? 'Hide Preferences' : 'Manage Preferences'}
            </button>
            {showPreferences && (
              <button onClick={onSavePreferences} className="rounded-md bg-[#C61F2A] px-4 py-2 text-sm font-bold text-white">
                Save Preferences
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
