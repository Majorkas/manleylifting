import { Route, Routes } from 'react-router-dom'
import './App.css'
import ContactPage from './components/ContactPage'
import LegalPage from './components/LegalPage'
import HomePage from './pages/HomePage'
import PortalDashboardPage from './pages/PortalDashboardPage'
import PortalLoginPage from './pages/PortalLoginPage'
import StoreWorkInProgressPage from './pages/StoreWorkInProgressPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/shop" element={<StoreWorkInProgressPage />} />
      <Route path="/shop/collections/:handle" element={<StoreWorkInProgressPage />} />
      <Route path="/shop/products/:handle" element={<StoreWorkInProgressPage />} />
      <Route path="/cart" element={<StoreWorkInProgressPage />} />
      <Route path="/checkout" element={<StoreWorkInProgressPage />} />
      <Route path="/order-confirmed" element={<StoreWorkInProgressPage />} />
      <Route path="/portal" element={<PortalDashboardPage />} />
      <Route path="/portal/login" element={<PortalLoginPage />} />
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
