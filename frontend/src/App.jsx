import { Route, Routes } from 'react-router-dom'
import './App.css'
import ContactPage from './components/ContactPage'
import LegalPage from './components/LegalPage'
import HomePage from './pages/HomePage'
import PortalDashboardPage from './pages/PortalDashboardPage'
import PortalDemoPage from './pages/PortalDemoPage'
import CartPage from './pages/CartPage'
import ShopCollectionPage from './pages/ShopCollectionPage'
import ShopPage from './pages/ShopPage'
import ShopProductPage from './pages/ShopProductPage'
import CheckoutPage from './pages/CheckoutPage'
import OrderConfirmedPage from './pages/OrderConfirmedPage'
import AccountLoginPage from './pages/AccountLoginPage'
import AccountMfaChallengePage from './pages/AccountMfaChallengePage'
import AccountAddressesPage from './pages/AccountAddressesPage'
import AccountOverviewPage from './pages/AccountOverviewPage'
import AccountOrdersPage from './pages/AccountOrdersPage'
import AccountSecurityPage from './pages/AccountSecurityPage'
import AccountRegisterPage from './pages/AccountRegisterPage'
import AccountResendVerificationPage from './pages/AccountResendVerificationPage'
import AccountResetPasswordPage from './pages/AccountResetPasswordPage'
import AccountVerifyEmailPage from './pages/AccountVerifyEmailPage'
import AccountChangeEmailPage from './pages/AccountChangeEmailPage'

export default function App() {
  return (
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
      <Route path="/portal-demo" element={<PortalDemoPage />} />
      <Route path="/contact" element={<ContactPage />} />
      <Route path="/privacy-policy" element={<LegalPage title="Privacy Policy" />} />
      <Route path="/cookie-policy" element={<LegalPage title="Cookie Policy" />} />
      <Route path="/terms-and-conditions" element={<LegalPage title="Terms and Conditions" />} />
      <Route path="/returns-and-refunds" element={<LegalPage title="Returns and Refunds" />} />
      <Route path="/shipping-and-delivery" element={<LegalPage title="Shipping and Delivery" />} />
      <Route path="/accessibility-statement" element={<LegalPage title="Accessibility Statement" />} />
    </Routes>
  )
}
