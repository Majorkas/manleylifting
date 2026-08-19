import { useEffect, useState } from 'react'
import { ArrowLeft, LogOut, Mail } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import AccountLayout from '../components/AccountLayout'
import AccountSectionTabs from '../components/AccountSectionTabs'
import {
  changeAccountPassword,
  deleteAccount,
  getAccountBootstrap,
  getAccountSecurityEvents,
  getAccountSessions,
  logoutAllAccountSessions,
  portalLogout,
  revokeAccountSession,
  setupAccountMfa,
  verifyAccountMfa,
} from '../utils/portalApi'
import usePageMeta from '../utils/usePageMeta'

export default function AccountSecurityPage() {
  const SECURITY_EVENTS_PAGE_SIZE = 3
  usePageMeta({ title: 'Security', description: 'Manage your Manley Lifting security settings.', noIndex: true })
  const navigate = useNavigate()
  const [account, setAccount] = useState(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [passwordStatus, setPasswordStatus] = useState({ type: '', message: '' })
  const [sessions, setSessions] = useState([])
  const [securityEvents, setSecurityEvents] = useState([])
  const [securityEventsPage, setSecurityEventsPage] = useState(1)
  const [mfaForm, setMfaForm] = useState({ currentPassword: '', code: '' })
  const [mfaStatus, setMfaStatus] = useState({ type: '', message: '' })
  const [mfaSetup, setMfaSetup] = useState({ inProgress: false, secret: '', qrCodeUrl: '', otpauthUri: '', recoveryCodes: [] })
  const [sessionStatus, setSessionStatus] = useState({ type: '', message: '' })
  const [deleteAction, setDeleteAction] = useState({ open: false, currentPassword: '', confirmDelete: false })
  const [accountActionStatus, setAccountActionStatus] = useState({ type: '', message: '' })

  useEffect(() => {
    let cancelled = false

    async function loadAccountData() {
      try {
        const bootstrap = await getAccountBootstrap()
        if (!cancelled) {
          setAccount(bootstrap)
          setMfaSetup((current) => ({
            ...current,
            inProgress: Boolean(bootstrap?.mfaSetupInProgress),
            recoveryCodes: Array.isArray(bootstrap?.mfaRecoveryCodes) ? bootstrap.mfaRecoveryCodes : [],
          }))
        }
      } catch (error) {
        if (cancelled) return
        if (error?.status === 401) {
          navigate('/account/login?redirect=/account/security', { replace: true })
          return
        }
        setErrorMessage(String(error?.message || 'Security settings could not be loaded.'))
      }

      try {
        const nextSessions = await getAccountSessions()
        if (!cancelled) setSessions(nextSessions)
      } catch (error) {
        if (cancelled) return
        if (error?.status === 401) {
          navigate('/account/login?redirect=/account/security', { replace: true })
          return
        }
        setErrorMessage(String(error?.message || 'Security settings could not be loaded.'))
      }

      try {
        const nextEvents = await getAccountSecurityEvents()
        if (!cancelled) {
          setSecurityEvents(nextEvents)
          setSecurityEventsPage(1)
        }
      } catch (error) {
        if (cancelled) return
        if (error?.status === 401) {
          navigate('/account/login?redirect=/account/security', { replace: true })
          return
        }
        setErrorMessage(String(error?.message || 'Security settings could not be loaded.'))
      }
    }

    loadAccountData()
    return () => {
      cancelled = true
    }
  }, [navigate])

  async function signOut() {
    await portalLogout()
    navigate('/account/login', { replace: true })
  }

  async function handlePasswordChange(event) {
    event.preventDefault()
    setPasswordStatus({ type: '', message: '' })

    if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      setPasswordStatus({ type: 'error', message: 'Complete every password field before continuing.' })
      return
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordStatus({ type: 'error', message: 'The new passwords do not match.' })
      return
    }

    try {
      await changeAccountPassword({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      })
      setPasswordStatus({ type: 'success', message: 'Your password was updated. Please sign in again with the new password if you are using this browser elsewhere.' })
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
    } catch (error) {
      setPasswordStatus({ type: 'error', message: String(error?.message || 'Unable to update your password right now.') })
    }
  }

  async function handleMfaSetup(event) {
    event.preventDefault()
    setMfaStatus({ type: '', message: '' })

    if (!mfaForm.currentPassword) {
      setMfaStatus({ type: 'error', message: 'Enter your current password to begin MFA setup.' })
      return
    }

    try {
      const result = await setupAccountMfa({ currentPassword: mfaForm.currentPassword })
      setMfaSetup({
        inProgress: Boolean(result?.setupInProgress),
        secret: String(result?.secret || ''),
        qrCodeUrl: String(result?.qrCodeUrl || ''),
        otpauthUri: String(result?.otpauthUri || ''),
        recoveryCodes: Array.isArray(result?.recoveryCodes) ? result.recoveryCodes : [],
      })
      setMfaForm((current) => ({ ...current, currentPassword: '' }))
      setMfaStatus({ type: 'success', message: 'MFA setup has started. Enter the verification code from your authenticator app.' })
    } catch (error) {
      setMfaStatus({ type: 'error', message: String(error?.message || 'Unable to start MFA setup right now.') })
    }
  }

  async function handleMfaVerify(event) {
    event.preventDefault()
    setMfaStatus({ type: '', message: '' })

    if (!mfaForm.code) {
      setMfaStatus({ type: 'error', message: 'Enter the verification code from your authenticator app.' })
      return
    }

    try {
      const result = await verifyAccountMfa(mfaForm.code)
      setMfaSetup({ inProgress: false, secret: '', qrCodeUrl: '', otpauthUri: '', recoveryCodes: Array.isArray(result?.recoveryCodes) ? result.recoveryCodes : [] })
      setMfaForm((current) => ({ ...current, code: '' }))
      setMfaStatus({ type: 'success', message: 'MFA is now enabled for your account.' })
    } catch (error) {
      setMfaStatus({ type: 'error', message: String(error?.message || 'Unable to verify the MFA code right now.') })
    }
  }

  async function handleLogoutAllSessions() {
    try {
      await logoutAllAccountSessions()
      setSessions((current) => current.map((session) => ({ ...session, isRevoked: true, isActive: false })))
      setSessionStatus({ type: 'success', message: 'You have been signed out of every active session.' })
    } catch (error) {
      setSessionStatus({ type: 'error', message: String(error?.message || 'Unable to sign out of all sessions right now.') })
    }
  }

  async function handleRevokeSession(sessionId) {
    try {
      await revokeAccountSession(sessionId)
      setSessions((current) => current.map((session) => (
        session.id === sessionId ? { ...session, isRevoked: true, isActive: false } : session
      )))
      setSessionStatus({ type: 'success', message: 'The selected session was revoked.' })
    } catch (error) {
      setSessionStatus({ type: 'error', message: String(error?.message || 'Unable to revoke that session right now.') })
    }
  }

  async function handleDeleteAccount(event) {
    event.preventDefault()
    setAccountActionStatus({ type: '', message: '' })
    if (!deleteAction.confirmDelete) {
      setAccountActionStatus({ type: 'error', message: 'Please confirm that you want to permanently delete your account.' })
      return
    }
    try {
      await deleteAccount({ currentPassword: deleteAction.currentPassword, confirm: true })
      setAccountActionStatus({ type: 'success', message: 'Your account has been permanently deleted.' })
      await portalLogout()
      navigate('/account/login', { replace: true })
    } catch (error) {
      setAccountActionStatus({ type: 'error', message: String(error?.message || 'Unable to delete your account right now.') })
    }
  }

  const currentSessions = sessions.filter((session) => session.isCurrentSession || (session.isActive && !session.isRevoked))
  const totalSecurityEventPages = Math.max(1, Math.ceil(securityEvents.length / SECURITY_EVENTS_PAGE_SIZE))
  const activeSecurityEventsPage = Math.min(securityEventsPage, totalSecurityEventPages)
  const securityEventsStartIndex = (activeSecurityEventsPage - 1) * SECURITY_EVENTS_PAGE_SIZE
  const paginatedSecurityEvents = securityEvents.slice(
    securityEventsStartIndex,
    securityEventsStartIndex + SECURITY_EVENTS_PAGE_SIZE,
  )

  return (
    <AccountLayout
      eyebrow="Security"
      title="Account security"
      intro={account ? 'Manage passwords, MFA, sessions, and account state from one place.' : 'Loading your security settings securely...'}
      headerAction={(
        <Link to="/account" className="inline-flex items-center gap-2 text-sm font-semibold text-[#123A7A]">
          <ArrowLeft size={16} aria-hidden="true" /> Back to account
        </Link>
      )}
    >
      <AccountSectionTabs hideShoppingTabs={Boolean(account && !account.capabilities?.canShop)} />
      {errorMessage && <div role="alert" className="mt-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div>}
      {!account && !errorMessage && <p className="mt-5 text-slate-600">Loading...</p>}
      {account && (
        <div className="mt-6 space-y-5">
          <div className="grid gap-3 md:grid-cols-1 xl:grid-cols-1">
            <Link className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-4 text-[#123A7A] shadow-sm transition hover:border-[#123A7A] hover:shadow-md" to="/account/change-email">
              <span className="flex items-center gap-3 font-bold"><Mail size={20} aria-hidden="true" />Change email</span>
              <span aria-hidden="true">&rarr;</span>
            </Link>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <form className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-5 shadow-sm" onSubmit={handlePasswordChange}>
              <h3 className="text-lg font-bold text-slate-900">Update password</h3>
              <p className="text-sm text-slate-600">Use your current password before changing to a new one.</p>
              <div className="grid gap-3 md:grid-cols-3">
                <label className="block text-sm font-semibold text-slate-700">
                  <span className="mb-1 block">Current password</span>
                  <input className="w-full rounded-md border border-slate-300 px-3 py-2.5 outline-none focus:border-[#123A7A]" type="password" value={passwordForm.currentPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))} autoComplete="current-password" />
                </label>
                <label className="block text-sm font-semibold text-slate-700">
                  <span className="mb-1 block">New password</span>
                  <input className="w-full rounded-md border border-slate-300 px-3 py-2.5 outline-none focus:border-[#123A7A]" type="password" value={passwordForm.newPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))} autoComplete="new-password" />
                </label>
                <label className="block text-sm font-semibold text-slate-700">
                  <span className="mb-1 block">Confirm password</span>
                  <input className="w-full rounded-md border border-slate-300 px-3 py-2.5 outline-none focus:border-[#123A7A]" type="password" value={passwordForm.confirmPassword} onChange={(event) => setPasswordForm((current) => ({ ...current, confirmPassword: event.target.value }))} autoComplete="new-password" />
                </label>
              </div>
              {passwordStatus.message && (
                <p className={passwordStatus.type === 'error' ? 'text-sm text-red-700' : 'text-sm text-emerald-700'}>{passwordStatus.message}</p>
              )}
              <button className="rounded-md bg-[#123A7A] px-4 py-2.5 font-semibold text-white" type="submit">Update password</button>
            </form>

            <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Multi-factor authentication</h3>
                  <p className="text-sm text-slate-600">Protect this account with a time-based verification code.</p>
                </div>
                <button className="rounded-md bg-[#123A7A] px-4 py-2.5 font-semibold text-white" type="button" onClick={handleMfaSetup}>{account?.mfaEnabled ? 'Refresh MFA' : 'Enable MFA'}</button>
              </div>
              {account?.mfaEnabled && <p className="text-sm text-emerald-700">MFA is currently enabled for this account.</p>}
              <label className="block text-sm font-semibold text-slate-700">
                <span className="mb-1 block">Current password</span>
                <input className="w-full rounded-md border border-slate-300 px-3 py-2.5 outline-none focus:border-[#123A7A]" type="password" value={mfaForm.currentPassword} onChange={(event) => setMfaForm((current) => ({ ...current, currentPassword: event.target.value }))} autoComplete="current-password" aria-label="Current password for MFA" />
              </label>
              {mfaStatus.message && (
                <p className={mfaStatus.type === 'error' ? 'text-sm text-red-700' : 'text-sm text-emerald-700'}>{mfaStatus.message}</p>
              )}
              {mfaSetup.inProgress && (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-semibold text-slate-900">Setup step 2</p>
                  <p className="mt-1 text-sm text-slate-600">Enter the six-digit code from your authenticator app.</p>
                  {mfaSetup.qrCodeUrl && (
                    <div className="mt-3">
                      <p className="text-sm font-semibold text-slate-900">Scan this QR code</p>
                      <img
                        src={mfaSetup.qrCodeUrl}
                        alt="MFA setup QR code"
                        className="mt-2 h-40 w-40 rounded-md border border-slate-200 bg-white p-2"
                      />
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <input className="w-full max-w-[220px] rounded-md border border-slate-300 px-3 py-2.5 outline-none focus:border-[#123A7A]" type="text" value={mfaForm.code} onChange={(event) => setMfaForm((current) => ({ ...current, code: event.target.value }))} inputMode="numeric" maxLength="6" placeholder="123456" />
                    <button className="rounded-md border border-slate-300 px-3 py-2.5 font-semibold text-slate-700 hover:bg-slate-50" type="button" onClick={handleMfaVerify}>Verify code</button>
                  </div>
                  {mfaSetup.secret && <p className="mt-3 font-mono text-sm text-slate-700">Secret: {mfaSetup.secret}</p>}
                  {mfaSetup.otpauthUri && (
                    <p className="mt-2 break-all text-xs text-slate-500">Setup URI: {mfaSetup.otpauthUri}</p>
                  )}
                  {(mfaSetup.recoveryCodes.length > 0 || account?.mfaEnabled) && (
                    <div className="mt-3">
                      <p className="text-sm font-semibold text-slate-900">Recovery codes</p>
                      <ul className="mt-2 list-disc pl-5 text-sm text-slate-600">
                        {mfaSetup.recoveryCodes.length > 0 ? mfaSetup.recoveryCodes.map((code) => <li key={code}>{code}</li>) : <li>Recovery codes are already active for this account.</li>}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Sessions</h3>
                  <p className="text-sm text-slate-600">Revoke any browser session you no longer recognise.</p>
                </div>
                <button className="rounded-md border border-slate-300 px-4 py-2.5 font-semibold text-slate-700 hover:bg-slate-50" type="button" onClick={handleLogoutAllSessions}>Sign out all devices</button>
              </div>
              {sessionStatus.message && (
                <p className={sessionStatus.type === 'error' ? 'mt-3 text-sm text-red-700' : 'mt-3 text-sm text-emerald-700'}>{sessionStatus.message}</p>
              )}
              <div className="mt-4 space-y-3">
                {currentSessions.length === 0 && <p className="text-sm text-slate-500">No active sessions were found.</p>}
                {currentSessions.map((session) => (
                  <div key={session.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-3">
                    <div>
                      <p className="font-semibold text-slate-900">{session.isCurrentSession ? 'This browser' : 'Other session'}</p>
                      <p className="text-sm text-slate-600">
                        {session.isActive ? 'Active now' : 'Session status unavailable'}
                        {session.createdAt ? ` • started ${new Date(session.createdAt).toLocaleString()}` : ''}
                        {session.ipAddress ? ` • IP ${session.ipAddress}` : ''}
                        {session.device ? ` • ${session.device}` : ''}
                        {session.location ? ` • ${session.location}` : ''}
                      </p>
                    </div>
                    {!session.isRevoked && (
                      <button className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50" type="button" onClick={() => handleRevokeSession(session.id)}>Revoke</button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <p className="font-semibold text-slate-900">Recent security activity</p>
              <p className="mt-1 text-sm text-slate-600">Recent password, logout, and account-management events tied to this account.</p>
              <div className="mt-4 space-y-3">
                {securityEvents.length === 0 && <p className="text-sm text-slate-500">No recent security activity yet.</p>}
                {paginatedSecurityEvents.map((event) => (
                  <div key={`${event.action}-${event.createdAt}`} className="rounded-md border border-slate-200 px-3 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-slate-900">{event.action.replace('account.', '').replace(/_/g, ' ')}</p>
                      <p className="text-sm text-slate-500">{event.createdAt ? new Date(event.createdAt).toLocaleString() : 'Recently recorded'}</p>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{event.details?.changed ? 'Security setting updated.' : event.details?.revoked ? 'Session access was revoked.' : event.details?.disabled ? 'Account state changed.' : 'Recorded for this account.'}</p>
                  </div>
                ))}
              </div>
            </div>
                {securityEvents.length > SECURITY_EVENTS_PAGE_SIZE && (
                  <div className="flex items-center justify-between pt-1">
                    <button
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      type="button"
                      onClick={() => setSecurityEventsPage((current) => Math.max(1, current - 1))}
                      disabled={activeSecurityEventsPage <= 1}
                    >
                      Previous
                    </button>
                    <p className="text-sm text-slate-600">
                      Page {activeSecurityEventsPage} of {totalSecurityEventPages}
                    </p>
                    <button
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      type="button"
                      onClick={() => setSecurityEventsPage((current) => Math.min(totalSecurityEventPages, current + 1))}
                      disabled={activeSecurityEventsPage >= totalSecurityEventPages}
                    >
                      Next
                    </button>
                  </div>
                )}

            <div className="rounded-lg border border-red-200 bg-red-50 p-5 shadow-sm">
              <h4 className="font-semibold text-red-900">Delete account</h4>
              <p className="mt-1 text-sm text-red-700">Permanently remove your account and sign out everywhere.</p>
              {!deleteAction.open ? (
                <div className="mt-4">
                  <button
                    className="rounded-md bg-red-700 px-3 py-2.5 font-semibold text-white"
                    type="button"
                    onClick={() => {
                      setDeleteAction({ open: true, currentPassword: '', confirmDelete: false })
                      setAccountActionStatus({ type: '', message: '' })
                    }}
                  >
                    Delete account
                  </button>
                </div>
              ) : (
                <form className="mt-4 space-y-3" onSubmit={handleDeleteAccount}>
                  <label className="block text-sm font-semibold text-slate-700">
                    <span className="mb-1 block">Current password</span>
                    <input
                      className="w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 outline-none focus:border-[#123A7A]"
                      type="password"
                      value={deleteAction.currentPassword}
                      onChange={(event) => setDeleteAction((current) => ({ ...current, currentPassword: event.target.value }))}
                      autoComplete="current-password"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm text-red-700">
                    <input
                      type="checkbox"
                      checked={deleteAction.confirmDelete}
                      onChange={(event) => setDeleteAction((current) => ({ ...current, confirmDelete: event.target.checked }))}
                    />
                    I understand that deleting my account is permanent.
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button className="rounded-md bg-red-700 px-3 py-2.5 font-semibold text-white" type="submit">Confirm delete</button>
                    <button
                      className="rounded-md border border-slate-300 bg-white px-3 py-2.5 font-semibold text-slate-700"
                      type="button"
                      onClick={() => {
                        setDeleteAction({ open: false, currentPassword: '', confirmDelete: false })
                        setAccountActionStatus({ type: '', message: '' })
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
              {accountActionStatus.message && (
                <p className={accountActionStatus.type === 'error' ? 'mt-3 text-sm text-red-700' : 'mt-3 text-sm text-emerald-700'}>{accountActionStatus.message}</p>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-900">Email change</p>
                  <p className="text-sm text-slate-600">Open the dedicated confirmation flow for changing your sign-in address.</p>
                </div>
                <Link className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-4 py-2.5 font-semibold text-[#123A7A] hover:bg-white" to="/account/change-email">Open email change</Link>
              </div>
            </div>
          </div>

          <button className="flex items-center gap-2 rounded-md border border-slate-300 px-4 py-2.5 font-semibold text-slate-700 hover:bg-slate-50" type="button" onClick={signOut}>
            <LogOut size={18} aria-hidden="true" /> Sign out
          </button>
        </div>
      )}
    </AccountLayout>
  )
}