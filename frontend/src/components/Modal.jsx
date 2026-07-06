import { useEffect } from 'react'

const defaultOverlayClassName =
  'fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 pb-6 pt-24 sm:items-center sm:pt-6'

const defaultPanelClassName =
  'max-h-[calc(100vh-7rem)] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl sm:max-h-[calc(100vh-3rem)]'

export default function Modal({
  open,
  onClose,
  children,
  overlayClassName = defaultOverlayClassName,
  panelClassName = defaultPanelClassName,
  closeOnBackdrop = true,
  closeOnEscape = true,
}) {
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

  if (!open) return null

  return (
    <div
      className={overlayClassName}
      onClick={(event) => {
        if (!closeOnBackdrop) return
        if (event.target === event.currentTarget) {
          onClose?.()
        }
      }}
    >
      <div className={panelClassName}>{children}</div>
    </div>
  )
}
