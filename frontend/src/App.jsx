import { Route, Routes } from 'react-router-dom'
import './App.css'
import ContactPage from './components/ContactPage'
import LegalPage from './components/LegalPage'
import HomePage from './pages/HomePage'
import ShopPage from './pages/ShopPage'
import ShopCollectionPage from './pages/ShopCollectionPage'
import ShopProductPage from './pages/ShopProductPage'
import CartPage from './pages/CartPage'
import CheckoutPage from './pages/CheckoutPage'
import OrderConfirmedPage from './pages/OrderConfirmedPage'

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
