export function validateProductionConfig(env = process.env) {
  if (String(env.VITE_REQUIRE_PRODUCTION_CONFIG || '').toLowerCase() !== 'true') {
    return
  }

  const failures = []
  const stripeKey = String(env.VITE_STRIPE_PUBLISHABLE_KEY || '').trim()
  const turnstileKey = String(env.VITE_TURNSTILE_SITE_KEY || '').trim()

  if (!/^pk_(test|live)_[A-Za-z0-9_]+$/.test(stripeKey)) {
    failures.push('VITE_STRIPE_PUBLISHABLE_KEY')
  }
  if (!turnstileKey) {
    failures.push('VITE_TURNSTILE_SITE_KEY')
  }

  if (failures.length > 0) {
    throw new Error(`Production frontend configuration failed: ${failures.join(', ')}`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  validateProductionConfig()
  console.log('Production frontend configuration is valid')
}
