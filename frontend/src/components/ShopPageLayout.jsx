import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import SiteHeader from './SiteHeader'
import SiteFooter from './SiteFooter'
import CartDrawer from './CartDrawer'
import CartToast from './CartToast'
import { useCart } from '../context/CartContext'

const navbarLogo = '/logo-navbar.png'

const shopNavItems = [
  { label: 'Home', to: '/' },
  { label: 'Shop', to: '/shop' },
  { label: 'Contact', to: '/contact' },
]

const legalLinks = [
  { label: 'Privacy Policy', to: '/privacy-policy' },
  { label: 'Cookie Policy', to: '/cookie-policy' },
  { label: 'Terms and Conditions', to: '/terms-and-conditions' },
  { label: 'Returns and Refunds', to: '/returns-and-refunds' },
  { label: 'Shipping and Delivery', to: '/shipping-and-delivery' },
  { label: 'Accessibility Statement', to: '/accessibility-statement' },
]

export default function ShopPageLayout({ children }) {
  const location = useLocation()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [isCartOpen, setIsCartOpen] = useState(false)
  const {
    cartItems,
    cartCount,
    subtotal,
    toast,
    dismissToast,
    increaseQuantity,
    decreaseQuantity,
    removeItem,
  } = useCart()

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [location.pathname])

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <SiteHeader
        navbarLogo={navbarLogo}
        variant="shop"
        isMobileMenuOpen={isMobileMenuOpen}
        onToggleMobileMenu={() => setIsMobileMenuOpen((prev) => !prev)}
        onCloseMobileMenu={() => setIsMobileMenuOpen(false)}
        navItems={shopNavItems}
        cartCount={cartCount}
        onCartClick={() => setIsCartOpen(true)}
      />

      <CartDrawer
        open={isCartOpen}
        items={cartItems}
        subtotal={subtotal}
        onClose={() => setIsCartOpen(false)}
        onIncreaseQuantity={increaseQuantity}
        onDecreaseQuantity={decreaseQuantity}
        onRemoveItem={removeItem}
      />

      <CartToast toast={toast} onClose={dismissToast} />

      {children}

      <SiteFooter legalLinks={legalLinks} />
    </div>
  )
}
