import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAccountBootstrap, hasPortalSession } from '../utils/portalApi'

export default function PortalEntryLink({ children, className }) {
  const navigate = useNavigate()
  const [checkingAccess, setCheckingAccess] = useState(false)

  async function handleClick(event) {
    event.preventDefault()
    if (checkingAccess) return

    if (!hasPortalSession()) {
      navigate('/portal-demo')
      return
    }

    setCheckingAccess(true)
    try {
      const account = await getAccountBootstrap()
      navigate(account?.capabilities?.canAccessPortal ? '/portal' : '/portal-demo')
    } catch {
      navigate('/portal-demo')
    } finally {
      setCheckingAccess(false)
    }
  }

  return (
    <a
      href="/portal-demo"
      onClick={handleClick}
      aria-disabled={checkingAccess}
      className={`${className || ''} ${checkingAccess ? 'pointer-events-none opacity-70' : ''}`.trim()}
    >
      {checkingAccess ? 'Opening portal...' : children}
    </a>
  )
}
