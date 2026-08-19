import { useEffect, useRef } from 'react'

/**
 * Hook to handle focus management for accessibility
 * Useful for error boundaries, modals, and keyboard navigation
 */
export function useAccessibility(focusElementRef = null) {
  const defaultErrorRef = useRef(null)
  const errorRef = focusElementRef || defaultErrorRef

  // Announce errors to screen readers
  const announceError = (message) => {
    if (errorRef.current) {
      errorRef.current.textContent = message
      errorRef.current.setAttribute('role', 'alert')
    }
  }

  // Manage focus to error message
  const focusError = () => {
    if (errorRef.current) {
      errorRef.current.focus()
    }
  }

  return {
    errorRef,
    announceError,
    focusError,
  }
}

/**
 * Hook to handle keyboard navigation (Tab, Escape, etc.)
 */
export function useKeyboardNavigation(onEscape) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && onEscape) {
        onEscape()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onEscape])
}

/**
 * Hook to announce status changes to screen readers
 */
export function useAriaLive(message, politeness = 'polite') {
  const ref = useRef(null)

  useEffect(() => {
    if (ref.current && message) {
      ref.current.textContent = message
      ref.current.setAttribute('aria-live', politeness)
      ref.current.setAttribute('aria-atomic', 'true')
    }
  }, [message, politeness])

  return ref
}
