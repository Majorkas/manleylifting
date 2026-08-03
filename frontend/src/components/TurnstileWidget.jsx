import { useEffect, useEffectEvent, useRef } from 'react'

function loadTurnstileScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Turnstile unavailable'))
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (window.__manleyTurnstileLoader) return window.__manleyTurnstileLoader

  window.__manleyTurnstileLoader = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-turnstile-script="true"]')
    if (existing) {
      existing.addEventListener('load', () => resolve(window.turnstile), { once: true })
      existing.addEventListener('error', () => reject(new Error('Turnstile unavailable')), { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.dataset.turnstileScript = 'true'
    script.onload = () => resolve(window.turnstile)
    script.onerror = () => reject(new Error('Turnstile unavailable'))
    document.head.appendChild(script)
  })
  return window.__manleyTurnstileLoader
}

export default function TurnstileWidget({ siteKey, onTokenChange, onError }) {
  const containerRef = useRef(null)
  const widgetIdRef = useRef(null)
  const emitToken = useEffectEvent((token) => onTokenChange?.(token))
  const emitError = useEffectEvent(() => onError?.())

  useEffect(() => {
    if (!siteKey) return undefined
    let cancelled = false

    loadTurnstileScript()
      .then((turnstile) => {
        if (cancelled || !turnstile || !containerRef.current) return
        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: 'light',
          callback: (token) => emitToken(String(token || '')),
          'expired-callback': () => emitToken(''),
          'error-callback': () => {
            emitToken('')
            emitError()
          },
        })
      })
      .catch(() => {
        if (!cancelled) emitError()
      })

    return () => {
      cancelled = true
      if (window.turnstile && widgetIdRef.current !== null) {
        window.turnstile.remove(widgetIdRef.current)
      }
      widgetIdRef.current = null
    }
  }, [siteKey])

  if (!siteKey) return null
  return <div ref={containerRef} aria-label="Security verification" />
}
