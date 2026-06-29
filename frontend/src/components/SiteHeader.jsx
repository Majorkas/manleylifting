import { Link } from 'react-router-dom'

export default function SiteHeader({
  navbarLogo,
  isScrolled,
  isMobileMenuOpen,
  onToggleMobileMenu,
  onCloseMobileMenu,
  navItems = [],
  variant = 'home',
  cartCount = 0,
  onCartClick,
}) {
  const items = navItems.length
    ? navItems
    : [
        { label: 'Services', href: '#services' },
        { label: 'Certification', href: '#trust' },
        { label: 'Contact', to: '/contact' },
      ]

  const isShopHeader = variant === 'shop'
  const headerClassName = isShopHeader
    ? 'site-header site-header--shop'
    : `site-header ${
        isScrolled || isMobileMenuOpen ? 'site-header--solid' : 'site-header--transparent'
      }`

  const logoVisible = isShopHeader || isScrolled || isMobileMenuOpen
  const showCartButton = isShopHeader && typeof onCartClick === 'function'

  return (
    <header className={headerClassName}>
      <div className="mx-auto w-full max-w-7xl px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link to="/" aria-label="Go to homepage">
              <img
                src={navbarLogo}
                alt="Manley Lifting logo"
                className={`h-12 w-auto transition-all duration-200 delay-75 ${
                  logoVisible
                    ? 'opacity-100 scale-100'
                    : 'opacity-0 scale-95 pointer-events-none'
                }`}
              />
            </Link>
          </div>

          <div className="flex items-center gap-3">
            <nav className="hidden items-center gap-8 text-sm font-semibold md:flex">
              {items.map((item) =>
                item.to ? (
                  <Link key={item.label} to={item.to} className="nav-link">
                    {item.label}
                  </Link>
                ) : (
                  <a key={item.label} href={item.href} className="nav-link">
                    {item.label}
                  </a>
                ),
              )}
            </nav>

            {showCartButton && (
              <button
                type="button"
                onClick={onCartClick}
                className="relative inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 text-[#123A7A] transition hover:border-[#123A7A] hover:bg-[#123A7A]/5"
                aria-label={`Open cart with ${cartCount} item${cartCount === 1 ? '' : 's'}`}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <path d="M6 6h15l-2 8H8L6 6Z" />
                  <path d="M6 6 5.2 3.5H3" />
                  <circle cx="9" cy="19" r="1.5" />
                  <circle cx="17" cy="19" r="1.5" />
                </svg>

                {cartCount > 0 && (
                  <span className="absolute -right-2 -top-2 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-[#C61F2A] px-1 text-[10px] font-bold text-white">
                    {cartCount}
                  </span>
                )}
              </button>
            )}

            <button
              type="button"
              className="menu-button md:hidden"
              aria-label="Toggle navigation menu"
              aria-expanded={isMobileMenuOpen}
              onClick={onToggleMobileMenu}
            >
              <span className={`menu-icon ${isMobileMenuOpen ? 'open' : ''}`} />
            </button>
          </div>
        </div>

        <nav className={`mobile-nav md:hidden ${isMobileMenuOpen ? 'open' : ''}`}>
          {items.map((item) =>
            item.to ? (
              <Link key={item.label} to={item.to} onClick={onCloseMobileMenu}>
                {item.label}
              </Link>
            ) : (
              <a key={item.label} href={item.href} onClick={onCloseMobileMenu}>
                {item.label}
              </a>
            ),
          )}
        </nav>
      </div>
    </header>
  )
}
