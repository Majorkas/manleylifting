import { useState } from 'react'
import SiteFooter from './SiteFooter'
import SiteHeader from './SiteHeader'

const navbarLogo = '/logo-navbar.png'

const legalLinks = [
  { label: 'Privacy Policy', to: '/privacy-policy' },
  { label: 'Cookie Policy', to: '/cookie-policy' },
  { label: 'Terms and Conditions', to: '/terms-and-conditions' },
  { label: 'Returns and Refunds', to: '/returns-and-refunds' },
  { label: 'Shipping and Delivery', to: '/shipping-and-delivery' },
  { label: 'Accessibility Statement', to: '/accessibility-statement' },
]

const portalNavItems = [
  { label: 'Portal', to: '/portal' },
  { label: 'Shop', to: '/shop' },
  { label: 'Contact', to: '/contact' },
]

export default function PortalLayout({ children }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <SiteHeader
        navbarLogo={navbarLogo}
        variant="shop"
        isMobileMenuOpen={isMobileMenuOpen}
        onToggleMobileMenu={() => setIsMobileMenuOpen((prev) => !prev)}
        onCloseMobileMenu={() => setIsMobileMenuOpen(false)}
        navItems={portalNavItems}
      />

      <main className="bg-[#f8fafc] pt-6">{children}</main>

      <SiteFooter legalLinks={legalLinks} />
    </div>
  )
}
