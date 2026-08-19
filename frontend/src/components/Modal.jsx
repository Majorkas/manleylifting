import { useEffect, useRef } from 'react'

const defaultOverlayClassName =
  'fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 pb-6 pt-24 sm:items-center sm:pt-6'

const defaultPanelClassName =
  'max-h-[calc(100vh-7rem)] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:max-h-[calc(100vh-3rem)]'

function lockDocumentScroll() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  const body = document.body
  const docEl = document.documentElement
  const currentCount = Number(body.dataset.modalLockCount || '0')

  if (currentCount === 0) {
    const scrollY = window.scrollY || window.pageYOffset || 0
    const scrollbarGap = Math.max(0, window.innerWidth - docEl.clientWidth)

    body.dataset.modalScrollY = String(scrollY)
    body.dataset.modalOriginalPaddingRight = body.style.paddingRight || ''
    body.style.paddingRight = scrollbarGap > 0 ? `${scrollbarGap}px` : body.style.paddingRight
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.left = '0'
    body.style.right = '0'
    body.style.width = '100%'
    body.style.overflow = 'hidden'
  }

  body.dataset.modalLockCount = String(currentCount + 1)
}

function unlockDocumentScroll() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  const body = document.body
  const currentCount = Number(body.dataset.modalLockCount || '0')
  if (currentCount <= 0) return

  const nextCount = currentCount - 1
  if (nextCount > 0) {
    body.dataset.modalLockCount = String(nextCount)
    return
  }

  const scrollY = Number(body.dataset.modalScrollY || '0')
  const originalPaddingRight = body.dataset.modalOriginalPaddingRight || ''

  body.style.position = ''
  body.style.top = ''
  body.style.left = ''
  body.style.right = ''
  body.style.width = ''
  body.style.overflow = ''
  body.style.paddingRight = originalPaddingRight

  delete body.dataset.modalLockCount
  delete body.dataset.modalScrollY
  delete body.dataset.modalOriginalPaddingRight

  window.scrollTo(0, Number.isFinite(scrollY) ? scrollY : 0)
}

export default function Modal({
  open,
  onClose,
  children,
  overlayClassName = defaultOverlayClassName,
  panelClassName = defaultPanelClassName,
  closeOnBackdrop = true,
  closeOnEscape = true,
  ariaLabel,
}) {
  const panelRef = useRef(null)
  const returnFocusRef = useRef(null)

  useEffect(() => {
    if (!open || !closeOnEscape) return undefined

    function handleEscape(event) {
      if (event.key === 'Escape') {
        onClose?.()
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [open, closeOnEscape, onClose])

  useEffect(() => {
    if (!open) return undefined

    returnFocusRef.current = document.activeElement
    lockDocumentScroll()
    const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const focusFrame = window.requestAnimationFrame(() => {
      panelRef.current?.querySelector(focusableSelector)?.focus()
    })
    function handleTab(event) {
      if (event.key !== 'Tab' || !panelRef.current) return
      const focusable = Array.from(panelRef.current.querySelectorAll(focusableSelector))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleTab)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleTab)
      unlockDocumentScroll()
      returnFocusRef.current?.focus?.()
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className={overlayClassName}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onClick={(event) => {
        if (!closeOnBackdrop) return
        if (event.target === event.currentTarget) {
          onClose?.()
        }
      }}
    >
      <div ref={panelRef} className={panelClassName}>{children}</div>
    </div>
  )
}
