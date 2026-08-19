import assert from 'node:assert/strict'
import test from 'node:test'
import { validateProductionConfig } from './check-production-config.mjs'

test('allows local configuration when production validation is disabled', () => {
  assert.doesNotThrow(() => validateProductionConfig({}))
})

test('accepts complete production-scoped public configuration', () => {
  assert.doesNotThrow(() => validateProductionConfig({
    VITE_REQUIRE_PRODUCTION_CONFIG: 'true',
    VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_staging',
    VITE_TURNSTILE_SITE_KEY: '0x4AAAAA-staging',
  }))
})

test('rejects incomplete production-scoped public configuration', () => {
  assert.throws(
    () => validateProductionConfig({
      VITE_REQUIRE_PRODUCTION_CONFIG: 'true',
      VITE_STRIPE_PUBLISHABLE_KEY: 'sk_live_server-secret',
      VITE_TURNSTILE_SITE_KEY: '',
    }),
    /VITE_STRIPE_PUBLISHABLE_KEY, VITE_TURNSTILE_SITE_KEY/,
  )
})
