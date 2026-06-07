const COOKIE_KEY = 'manley-cookie-consent-v1'

export function defaultPreferences() {
  return {
    analytics: false,
    marketing: false,
    functional: true,
  }
}

export function getRegionPolicy() {
  const locale = (navigator.language || '').toLowerCase()
  const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone || '').toLowerCase()

  const euOrUkLocale =
    locale.startsWith('en-gb') ||
    locale.endsWith('-ie') ||
    locale.endsWith('-fr') ||
    locale.endsWith('-de') ||
    locale.endsWith('-es') ||
    locale.endsWith('-it') ||
    locale.endsWith('-nl')

  const euOrUkTimezone =
    tz.includes('london') ||
    tz.includes('dublin') ||
    tz.includes('paris') ||
    tz.includes('berlin') ||
    tz.includes('madrid') ||
    tz.includes('rome') ||
    tz.includes('amsterdam')

  const requiresExplicitOptIn = euOrUkLocale || euOrUkTimezone

  return {
    region: requiresExplicitOptIn ? 'uk_eu' : 'rest_of_world',
    requiresExplicitOptIn,
    label: requiresExplicitOptIn ? 'UK/EU explicit opt-in' : 'Global baseline',
  }
}

export function loadConsent() {
  try {
    const raw = localStorage.getItem(COOKIE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveConsent(type, preferences, regionPolicy) {
  const payload = {
    type,
    preferences,
    region: regionPolicy.region,
    timestamp: new Date().toISOString(),
    policyVersion: 1,
  }
  localStorage.setItem(COOKIE_KEY, JSON.stringify(payload))
  return payload
}
