import { useEffect } from 'react'

const BRAND_NAME = 'Manley Lifting'
const DEFAULT_TITLE = BRAND_NAME
const DEFAULT_DESCRIPTION =
  'Manley Lifting provides lifting equipment inspections, testing, servicing, and certified products across Ireland.'
const DEFAULT_OG_IMAGE = '/logo-hero.png'
const DEFAULT_KEYWORDS =
  'lifting equipment, lifting inspections, LOLER, hoist service, lifting products, Manley Lifting'

function ensureMetaByName(name) {
  let element = document.querySelector(`meta[name="${name}"]`)
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute('name', name)
    document.head.appendChild(element)
  }
  return element
}

function ensureMetaByProperty(property) {
  let element = document.querySelector(`meta[property="${property}"]`)
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute('property', property)
    document.head.appendChild(element)
  }
  return element
}

function ensureCanonicalLink() {
  let element = document.querySelector('link[rel="canonical"]')
  if (!element) {
    element = document.createElement('link')
    element.setAttribute('rel', 'canonical')
    document.head.appendChild(element)
  }
  return element
}

function toSingleLineText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function buildTitle(title) {
  const safeTitle = toSingleLineText(title)
  if (!safeTitle) return DEFAULT_TITLE
  return safeTitle.toLowerCase() === BRAND_NAME.toLowerCase() ? BRAND_NAME : `${safeTitle} | ${BRAND_NAME}`
}

export default function usePageMeta({
  title,
  description,
  keywords = DEFAULT_KEYWORDS,
  noIndex = false,
  ogType = 'website',
  ogImage = DEFAULT_OG_IMAGE,
} = {}) {
  useEffect(() => {
    if (typeof document === 'undefined') return

    const resolvedTitle = buildTitle(title)
    const resolvedDescription = toSingleLineText(description) || DEFAULT_DESCRIPTION
    const resolvedKeywords = toSingleLineText(keywords) || DEFAULT_KEYWORDS
    const resolvedRobots = noIndex ? 'noindex,nofollow' : 'index,follow'
    const resolvedCanonicalHref =
      typeof window !== 'undefined'
        ? `${window.location.origin}${window.location.pathname}`
        : ''

    document.title = resolvedTitle

    ensureMetaByName('description').setAttribute('content', resolvedDescription)
    ensureMetaByName('keywords').setAttribute('content', resolvedKeywords)
    ensureMetaByName('robots').setAttribute('content', resolvedRobots)

    ensureMetaByProperty('og:title').setAttribute('content', resolvedTitle)
    ensureMetaByProperty('og:description').setAttribute('content', resolvedDescription)
    ensureMetaByProperty('og:type').setAttribute('content', ogType)
    ensureMetaByProperty('og:image').setAttribute('content', ogImage)

    ensureMetaByName('twitter:card').setAttribute('content', 'summary_large_image')
    ensureMetaByName('twitter:title').setAttribute('content', resolvedTitle)
    ensureMetaByName('twitter:description').setAttribute('content', resolvedDescription)
    ensureMetaByName('twitter:image').setAttribute('content', ogImage)

    if (resolvedCanonicalHref) {
      ensureCanonicalLink().setAttribute('href', resolvedCanonicalHref)
    }
  }, [description, keywords, noIndex, ogImage, ogType, title])
}
