import { useEffect, useMemo, useState } from 'react'
import { getRegionPolicy } from '../utils/cookieConsent'
import CookieConsentBanner from '../components/CookieConsentBanner'
import SiteHeader from '../components/SiteHeader'
import HeroSection from '../components/HeroSection'
import ServicesSection from '../components/ServicesSection'
import TrustSection from '../components/TrustSection'
import PortalPlatformSection from '../components/PortalPlatformSection'
import ContactCtaSection from '../components/ContactCtaSection'
import SiteFooter from '../components/SiteFooter'
import usePageMeta from '../utils/usePageMeta'

const navbarLogo = '/logo-navbar.png'
const heroLogo = '/logo-hero.png'

export default function HomePage() {
  usePageMeta({
    title: 'Home',
    description:
      'Manley Lifting provides inspections, certification, servicing, and lifting equipment support for businesses across Ireland.',
  })

  const [, setCookieConsent] = useState(null)
  const [isScrolled, setIsScrolled] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const regionPolicy = useMemo(() => getRegionPolicy(), [])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  useEffect(() => {
    function onScroll() {
      setIsScrolled(window.scrollY > 48)
    }

    onScroll()
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const legalLinks = [
    { label: 'Privacy Policy', to: '/privacy-policy' },
    { label: 'Cookie Policy', to: '/cookie-policy' },
    { label: 'Terms and Conditions', to: '/terms-and-conditions' },
    { label: 'Returns and Refunds', to: '/returns-and-refunds' },
    { label: 'Shipping and Delivery', to: '/shipping-and-delivery' },
    { label: 'Accessibility Statement', to: '/accessibility-statement' },
  ]

  const navItems = [
    { label: 'Services', href: '#services' },
    { label: 'Certification', href: '#trust' },
    { label: 'Portal', href: '#portal-platform' },
    { label: 'Contact', href: '#contact' },
    { label: 'Portal Login', to: '/portal/login' },
  ]

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <SiteHeader
        navbarLogo={navbarLogo}
        isScrolled={isScrolled}
        isMobileMenuOpen={isMobileMenuOpen}
        onToggleMobileMenu={() => setIsMobileMenuOpen((prev) => !prev)}
        onCloseMobileMenu={() => setIsMobileMenuOpen(false)}
        navItems={navItems}
      />

      <main>
        <HeroSection heroLogo={heroLogo} />
        <ServicesSection />
        <TrustSection />
        <PortalPlatformSection />
        <ContactCtaSection />
      </main>

      <SiteFooter legalLinks={legalLinks} />

      <CookieConsentBanner
        regionPolicy={regionPolicy}
        onConsentChange={setCookieConsent}
      />
    </div>
  )
}
