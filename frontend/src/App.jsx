import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import './App.css'
import AccessibleErrorBoundary from './components/AccessibleErrorBoundary'
import CookieConsentBanner from './components/CookieConsentBanner'

const ContactPage = lazy(() => import('./components/ContactPage'))
const LegalPage = lazy(() => import('./components/LegalPage'))
const HomePage = lazy(() => import('./pages/HomePage'))
const PortalDashboardPage = lazy(() => import('./pages/PortalDashboardPage'))
const FulfillmentOperationsPage = lazy(() => import('./pages/FulfillmentOperationsPage'))
const ShopManagementPage = lazy(() => import('./pages/ShopManagementPage'))
const PortalDemoPage = lazy(() => import('./pages/PortalDemoPage'))
const CartPage = lazy(() => import('./pages/CartPage'))
const ShopCollectionPage = lazy(() => import('./pages/ShopCollectionPage'))
const ShopPage = lazy(() => import('./pages/ShopPage'))
const ShopProductPage = lazy(() => import('./pages/ShopProductPage'))
const CheckoutPage = lazy(() => import('./pages/CheckoutPage'))
const OrderConfirmedPage = lazy(() => import('./pages/OrderConfirmedPage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))
const AccountLoginPage = lazy(() => import('./pages/AccountLoginPage'))
const AccountMfaChallengePage = lazy(() => import('./pages/AccountMfaChallengePage'))
const AccountAddressesPage = lazy(() => import('./pages/AccountAddressesPage'))
const AccountOverviewPage = lazy(() => import('./pages/AccountOverviewPage'))
const AccountOrdersPage = lazy(() => import('./pages/AccountOrdersPage'))
const AccountSecurityPage = lazy(() => import('./pages/AccountSecurityPage'))
const AccountRegisterPage = lazy(() => import('./pages/AccountRegisterPage'))
const AccountResendVerificationPage = lazy(() => import('./pages/AccountResendVerificationPage'))
const AccountResetPasswordPage = lazy(() => import('./pages/AccountResetPasswordPage'))
const AccountVerifyEmailPage = lazy(() => import('./pages/AccountVerifyEmailPage'))
const AccountChangeEmailPage = lazy(() => import('./pages/AccountChangeEmailPage'))

function PageLoadingFallback() {
  return (
    <div className="mx-auto min-h-[40vh] w-full max-w-7xl px-6 py-16" role="status" aria-label="Loading page" aria-live="polite">
      <div className="animate-pulse space-y-8" data-testid="page-loading-skeleton">
        <div className="space-y-3">
          <div className="h-4 w-24 rounded bg-slate-200" />
          <div className="h-10 w-2/3 max-w-xl rounded bg-slate-200" />
          <div className="h-4 w-full max-w-2xl rounded bg-slate-200" />
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          <div className="h-40 rounded-xl bg-slate-200" />
          <div className="h-40 rounded-xl bg-slate-200" />
          <div className="h-40 rounded-xl bg-slate-200" />
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AccessibleErrorBoundary>
      <CookieConsentBanner />
      <Suspense fallback={<PageLoadingFallback />}>
        <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/shop" element={<ShopPage />} />
        <Route path="/shop/collections/:handle" element={<ShopCollectionPage />} />
        <Route path="/shop/products/:handle" element={<ShopProductPage />} />
        <Route path="/cart" element={<CartPage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/order-confirmed" element={<OrderConfirmedPage />} />
        <Route path="/account" element={<AccountOverviewPage />} />
        <Route path="/account/orders" element={<AccountOrdersPage />} />
        <Route path="/account/addresses" element={<AccountAddressesPage />} />
        <Route path="/account/security" element={<AccountSecurityPage />} />
        <Route path="/account/login" element={<AccountLoginPage />} />
        <Route path="/account/login/mfa" element={<AccountMfaChallengePage />} />
        <Route path="/account/register" element={<AccountRegisterPage />} />
        <Route path="/account/verify-email" element={<AccountVerifyEmailPage />} />
        <Route path="/account/resend-verification" element={<AccountResendVerificationPage />} />
        <Route path="/account/reset-password" element={<AccountResetPasswordPage />} />
        <Route path="/account/change-email" element={<AccountChangeEmailPage />} />
        <Route path="/portal" element={<PortalDashboardPage />} />
        <Route path="/shop/fulfillment" element={<FulfillmentOperationsPage />} />
        <Route path="/shop/shop-management" element={<ShopManagementPage />} />
        <Route path="/portal-demo" element={<PortalDemoPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/privacy-policy" element={<LegalPage title="Privacy Policy" />} />
        <Route path="/cookie-policy" element={<LegalPage title="Cookie Policy" />} />
        <Route path="/terms-and-conditions" element={<LegalPage title="Terms and Conditions" />} />
        <Route path="/returns-and-refunds" element={<LegalPage title="Returns and Refunds" />} />
        <Route path="/shipping-and-delivery" element={<LegalPage title="Shipping and Delivery" />} />
        <Route path="/accessibility-statement" element={<LegalPage title="Accessibility Statement" />} />
        <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </AccessibleErrorBoundary>
  )
}
