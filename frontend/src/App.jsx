import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import './App.css'
import AccessibleErrorBoundary from './components/AccessibleErrorBoundary'
import CookieConsentBanner from './components/CookieConsentBanner'
import {
  AccountFallback,
  AuthFormFallback,
  CartFallback,
  CheckoutFallback,
  ContentFallback,
  FulfillmentFallback,
  HomeFallback,
  PortalFallback,
  ProductFallback,
  ShopFallback,
  ShopManagementFallback,
} from './components/RouteFallbacks'

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
  return <ContentFallback />
}

function lazyRoute(element, fallback) {
  return <Suspense fallback={fallback}>{element}</Suspense>
}

export default function App() {
  return (
    <AccessibleErrorBoundary>
      <CookieConsentBanner />
      <Suspense fallback={<PageLoadingFallback />}>
        <Routes>
        <Route path="/" element={lazyRoute(<HomePage />, <HomeFallback />)} />
        <Route path="/shop" element={lazyRoute(<ShopPage />, <ShopFallback />)} />
        <Route path="/shop/collections/:handle" element={lazyRoute(<ShopCollectionPage />, <ShopFallback />)} />
        <Route path="/shop/products/:handle" element={lazyRoute(<ShopProductPage />, <ProductFallback />)} />
        <Route path="/cart" element={lazyRoute(<CartPage />, <CartFallback />)} />
        <Route path="/checkout" element={lazyRoute(<CheckoutPage />, <CheckoutFallback />)} />
        <Route path="/order-confirmed" element={lazyRoute(<OrderConfirmedPage />, <ContentFallback />)} />
        <Route path="/account" element={lazyRoute(<AccountOverviewPage />, <AccountFallback />)} />
        <Route path="/account/orders" element={lazyRoute(<AccountOrdersPage />, <AccountFallback />)} />
        <Route path="/account/addresses" element={lazyRoute(<AccountAddressesPage />, <AccountFallback />)} />
        <Route path="/account/security" element={lazyRoute(<AccountSecurityPage />, <AccountFallback />)} />
        <Route path="/account/login" element={lazyRoute(<AccountLoginPage />, <AuthFormFallback />)} />
        <Route path="/account/login/mfa" element={lazyRoute(<AccountMfaChallengePage />, <AuthFormFallback />)} />
        <Route path="/account/register" element={lazyRoute(<AccountRegisterPage />, <AuthFormFallback />)} />
        <Route path="/account/verify-email" element={lazyRoute(<AccountVerifyEmailPage />, <AuthFormFallback />)} />
        <Route path="/account/resend-verification" element={lazyRoute(<AccountResendVerificationPage />, <AuthFormFallback />)} />
        <Route path="/account/reset-password" element={lazyRoute(<AccountResetPasswordPage />, <AuthFormFallback />)} />
        <Route path="/account/change-email" element={lazyRoute(<AccountChangeEmailPage />, <AuthFormFallback />)} />
        <Route path="/portal" element={lazyRoute(<PortalDashboardPage />, <PortalFallback />)} />
        <Route path="/shop/fulfillment" element={lazyRoute(<FulfillmentOperationsPage />, <FulfillmentFallback />)} />
        <Route path="/shop/shop-management" element={lazyRoute(<ShopManagementPage />, <ShopManagementFallback />)} />
        <Route path="/portal-demo" element={lazyRoute(<PortalDemoPage />, <PortalFallback />)} />
        <Route path="/contact" element={lazyRoute(<ContactPage />, <ContentFallback />)} />
        <Route path="/privacy-policy" element={lazyRoute(<LegalPage title="Privacy Policy" />, <ContentFallback />)} />
        <Route path="/cookie-policy" element={lazyRoute(<LegalPage title="Cookie Policy" />, <ContentFallback />)} />
        <Route path="/terms-and-conditions" element={lazyRoute(<LegalPage title="Terms and Conditions" />, <ContentFallback />)} />
        <Route path="/returns-and-refunds" element={lazyRoute(<LegalPage title="Returns and Refunds" />, <ContentFallback />)} />
        <Route path="/shipping-and-delivery" element={lazyRoute(<LegalPage title="Shipping and Delivery" />, <ContentFallback />)} />
        <Route path="/accessibility-statement" element={lazyRoute(<LegalPage title="Accessibility Statement" />, <ContentFallback />)} />
        <Route path="*" element={lazyRoute(<NotFoundPage />, <ContentFallback />)} />
        </Routes>
      </Suspense>
    </AccessibleErrorBoundary>
  )
}
