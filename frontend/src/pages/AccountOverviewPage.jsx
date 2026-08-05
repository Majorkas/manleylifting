import { useEffect, useState } from 'react'
import { Building2, LogOut, MapPin, Package2, ShieldCheck, ShoppingBag } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import AccountLayout from '../components/AccountLayout'
import { changeAccountPassword, deleteAccount, disableAccount, getAccountBootstrap, getAccountSecurityEvents, getAccountSessions, logoutAllAccountSessions, portalLogout, requestAccountEmailChange, revokeAccountSession, setupAccountMfa, verifyAccountMfa } from '../utils/portalApi'
import usePageMeta from '../utils/usePageMeta'

export default function AccountOverviewPage() {
  usePageMeta({ title: 'My Account', description: 'Manage your Manley Lifting account.', noIndex: true })
  const navigate = useNavigate()
  const [account, setAccount] = useState(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [passwordStatus, setPasswordStatus] = useState({ type: '', message: '' })
  const [emailForm, setEmailForm] = useState({ currentPassword: '', newEmail: '' })
  const [emailStatus, setEmailStatus] = useState({ type: '', message: '' })
  const [sessions, setSessions] = useState([])
  const [securityEvents, setSecurityEvents] = useState([])
  const [mfaForm, setMfaForm] = useState({ currentPassword: '', code: '' })
  const [mfaStatus, setMfaStatus] = useState({ type: '', message: '' })
  const [mfaSetup, setMfaSetup] = useState({ inProgress: false, secret: '', recoveryCodes: [] })
  const [sessionStatus, setSessionStatus] = useState({ type: '', message: '' })
  const [accountAction, setAccountAction] = useState({ type: '', currentPassword: '', confirmDelete: false })
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
          navigate('/account/login?redirect=/account', { replace: true })
          return
        }
        setErrorMessage(String(error?.message || 'Account details could not be loaded.'))
      }

      try {
        const nextSessions = await getAccountSessions()
        if (!cancelled) setSessions(nextSessions)
      } catch (error) {
        if (cancelled) return
        if (error?.status === 401) {
          navigate('/account/login?redirect=/account', { replace: true })
        }
      }

      try {
        const nextEvents = await getAccountSecurityEvents()
        if (!cancelled) setSecurityEvents(nextEvents)
      } catch (error) {
        if (cancelled) return
        if (error?.status === 401) {
          navigate('/account/login?redirect=/account', { replace: true })
        }
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

  async function handleEmailChange(event) {
    event.preventDefault()
    setEmailStatus({ type: '', message: '' })

    if (!emailForm.currentPassword || !emailForm.newEmail) {
      setEmailStatus({ type: 'error', message: 'Enter your current password and the new email address.' })
      return
    }

    try {
      await requestAccountEmailChange({ currentPassword: emailForm.currentPassword, newEmail: emailForm.newEmail })
      setEmailStatus({ type: 'success', message: 'We sent a confirmation email to the new address. Open it to complete the change.' })
      setEmailForm({ currentPassword: '', newEmail: '' })
    } catch (error) {
      setEmailStatus({ type: 'error', message: String(error?.message || 'Unable to start the email change right now.') })
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
      setMfaSetup({ inProgress: Boolean(result?.setupInProgress), secret: String(result?.secret || ''), recoveryCodes: Array.isArray(result?.recoveryCodes) ? result.recoveryCodes : [] })
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
      setMfaSetup({ inProgress: false, secret: '', recoveryCodes: Array.isArray(result?.recoveryCodes) ? result.recoveryCodes : [] })
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

  async function handleDisableAccount(event) {
    event.preventDefault()
    setAccountActionStatus({ type: '', message: '' })
    try {
      await disableAccount({ currentPassword: accountAction.currentPassword, reason: 'User disabled from account overview' })
      setAccountActionStatus({ type: 'success', message: 'Your account has been disabled. You can sign in again only after an administrator re-enables it.' })
      setAccountAction((current) => ({ ...current, currentPassword: '' }))
    } catch (error) {
      setAccountActionStatus({ type: 'error', message: String(error?.message || 'Unable to disable your account right now.') })
    }
  }

  async function handleDeleteAccount(event) {
    event.preventDefault()
    setAccountActionStatus({ type: '', message: '' })
    if (!accountAction.confirmDelete) {
      setAccountActionStatus({ type: 'error', message: 'Please confirm that you want to permanently delete your account.' })
      return
    }
    try {
      await deleteAccount({ currentPassword: accountAction.currentPassword, confirm: true })
      setAccountActionStatus({ type: 'success', message: 'Your account has been permanently deleted.' })
      await portalLogout()
      navigate('/account/login', { replace: true })
    } catch (error) {
      setAccountActionStatus({ type: 'error', message: String(error?.message || 'Unable to delete your account right now.') })
    }
  }

  return (
    <AccountLayout
      eyebrow="My Account"
      title={account?.fullName || 'Account overview'}
      intro={account ? account.email : 'Loading your account securely...'}
    >
      {errorMessage && <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div>}
      {!account && !errorMessage && <p className="text-slate-600">Loading...</p>}
      {account && (
        <>
          <div className="flex items-center gap-3 border-b border-slate-200 pb-5">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><ShieldCheck size={22} aria-hidden="true" /></div>
            <div>
              <p className="font-bold text-slate-900">{account.emailVerified ? 'Email verified' : 'Email verification required'}</p>
              <p className="text-sm text-slate-500">Secure browser session active</p>
            </div>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-2">
            {account.capabilities.canShop && (
              <>
                <Link className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-4 text-[#123A7A] shadow-sm transition hover:border-[#123A7A] hover:shadow-md" to="/account/orders">
                  <span className="flex items-center gap-3 font-bold"><Package2 size={20} aria-hidden="true" />Orders</span>
                  <span aria-hidden="true">&rarr;</span>
                </Link>
                <Link className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-4 text-[#123A7A] shadow-sm transition hover:border-[#123A7A] hover:shadow-md" to="/account/addresses">
                  <span className="flex items-center gap-3 font-bold"><MapPin size={20} aria-hidden="true" />Saved addresses</span>
                  <span aria-hidden="true">&rarr;</span>
                </Link>
                <Link className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-4 text-[#123A7A] shadow-sm transition hover:border-[#123A7A] hover:shadow-md" to="/shop">
                  <span className="flex items-center gap-3 font-bold"><ShoppingBag size={20} aria-hidden="true" />Shop</span>
                  <span aria-hidden="true">&rarr;</span>
                </Link>
              </>
            )}
            {account.capabilities.canAccessPortal && (
              <Link className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-4 text-[#123A7A] shadow-sm transition hover:border-[#123A7A] hover:shadow-md" to="/portal">
                <span className="flex items-center gap-3 font-bold"><Building2 size={20} aria-hidden="true" />Equipment portal</span>
                <span aria-hidden="true">&rarr;</span>
              </Link>
            )}
          </div>

          <div className="mt-8 rounded-lg border border-slate-200 bg-slate-50 p-5">
            <h3 className="text-lg font-bold text-slate-900">Security controls</h3>
            <p className="mt-2 text-sm text-slate-600">Update your password or sign out from every active browser session tied to this account.</p>

            <form className="mt-4 space-y-3" onSubmit={handlePasswordChange}>
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

            <form className="mt-5 space-y-3 rounded-md border border-slate-200 bg-white p-4" onSubmit={handleEmailChange}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-900">Change email address</p>
                  <p className="text-sm text-slate-600">We’ll send a confirmation link to the new address before the change is applied.</p>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block text-sm font-semibold text-slate-700">
                  <span className="mb-1 block">Current password</span>
                  <input className="w-full rounded-md border border-slate-300 px-3 py-2.5 outline-none focus:border-[#123A7A]" type="password" value={emailForm.currentPassword} onChange={(event) => setEmailForm((current) => ({ ...current, currentPassword: event.target.value }))} autoComplete="current-password" />
                </label>
                <label className="block text-sm font-semibold text-slate-700">
                  <span className="mb-1 block">New email</span>
                  <input className="w-full rounded-md border border-slate-300 px-3 py-2.5 outline-none focus:border-[#123A7A]" type="email" value={emailForm.newEmail} onChange={(event) => setEmailForm((current) => ({ ...current, newEmail: event.target.value }))} autoComplete="email" />
                </label>
              </div>
              {emailStatus.message && (
                <p className={emailStatus.type === 'error' ? 'text-sm text-red-700' : 'text-sm text-emerald-700'}>{emailStatus.message}</p>
              )}
              <button className="rounded-md bg-[#123A7A] px-4 py-2.5 font-semibold text-white" type="submit">Send confirmation</button>
            </form>

            <form className="mt-5 space-y-3 rounded-md border border-slate-200 bg-white p-4" onSubmit={handleMfaSetup}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-900">Multi-factor authentication</p>
                  <p className="text-sm text-slate-600">Protect this account with a time-based verification code.</p>
                </div>
                <button className="rounded-md bg-[#123A7A] px-4 py-2.5 font-semibold text-white" type="submit">{account?.mfaEnabled ? 'Refresh MFA' : 'Enable MFA'}</button>
              </div>
              {account?.mfaEnabled && (
                <p className="text-sm text-emerald-700">MFA is currently enabled for this account.</p>
              )}
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
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <input className="w-full max-w-[220px] rounded-md border border-slate-300 px-3 py-2.5 outline-none focus:border-[#123A7A]" type="text" value={mfaForm.code} onChange={(event) => setMfaForm((current) => ({ ...current, code: event.target.value }))} inputMode="numeric" maxLength="6" placeholder="123456" />
                    <button className="rounded-md border border-slate-300 px-3 py-2.5 font-semibold text-slate-700 hover:bg-slate-50" type="button" onClick={handleMfaVerify}>Verify code</button>
                  </div>
                  {mfaSetup.secret && <p className="mt-3 font-mono text-sm text-slate-700">Secret: {mfaSetup.secret}</p>}
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
            </form>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-4 py-3">
              <div>
                <p className="font-semibold text-slate-900">Sign out everywhere</p>
                <p className="text-sm text-slate-600">Revokes every active session on this account.</p>
              </div>
              <button className="rounded-md border border-slate-300 px-4 py-2.5 font-semibold text-slate-700 hover:bg-slate-50" type="button" onClick={handleLogoutAllSessions}>Sign out all devices</button>
            </div>
            {sessionStatus.message && (
              <p className={sessionStatus.type === 'error' ? 'mt-3 text-sm text-red-700' : 'mt-3 text-sm text-emerald-700'}>{sessionStatus.message}</p>
            )}

            <div className="mt-5 rounded-md border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-900">Active sessions</p>
                  <p className="text-sm text-slate-600">Revoke any browser session you no longer recognise.</p>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {sessions.length === 0 && <p className="text-sm text-slate-500">No other sessions were found.</p>}
                {sessions.map((session) => (
                  <div key={session.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-3">
                    <div>
                      <p className="font-semibold text-slate-900">{session.isCurrentSession ? 'This browser' : 'Other session'}</p>
                      <p className="text-sm text-slate-600">
                        {session.isRevoked ? 'Revoked' : session.isActive ? 'Active now' : 'Expired or already revoked'}
                        {session.createdAt ? ` • started ${new Date(session.createdAt).toLocaleString()}` : ''}
                      </p>
                    </div>
                    {!session.isRevoked && (
                      <button className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50" type="button" onClick={() => handleRevokeSession(session.id)}>Revoke</button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5 rounded-md border border-slate-200 bg-white p-4">
              <p className="font-semibold text-slate-900">Recent security activity</p>
              <p className="mt-1 text-sm text-slate-600">Recent password, logout, and account-management events tied to this account.</p>
              <div className="mt-4 space-y-3">
                {securityEvents.length === 0 && <p className="text-sm text-slate-500">No recent security activity yet.</p>}
                {securityEvents.map((event) => (
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

            <div className="mt-5 rounded-md border border-red-200 bg-red-50 p-4">
              <h4 className="font-semibold text-red-900">Account management</h4>
              <p className="mt-1 text-sm text-red-700">Disable your account temporarily or permanently delete it. These actions require your current password.</p>
              <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                <label className="block text-sm font-semibold text-slate-700">
                  <span className="mb-1 block">Current password</span>
                  <input className="w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 outline-none focus:border-[#123A7A]" type="password" value={accountAction.currentPassword} onChange={(event) => setAccountAction((current) => ({ ...current, currentPassword: event.target.value }))} autoComplete="current-password" />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button className="rounded-md border border-red-300 bg-white px-3 py-2.5 font-semibold text-red-700" type="button" onClick={handleDisableAccount}>Disable account</button>
                  <button className="rounded-md bg-red-700 px-3 py-2.5 font-semibold text-white" type="button" onClick={handleDeleteAccount}>Delete account</button>
                </div>
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm text-red-700">
                <input type="checkbox" checked={accountAction.confirmDelete} onChange={(event) => setAccountAction((current) => ({ ...current, confirmDelete: event.target.checked }))} />
                I understand that deleting my account is permanent.
              </label>
              {accountActionStatus.message && (
                <p className={accountActionStatus.type === 'error' ? 'mt-3 text-sm text-red-700' : 'mt-3 text-sm text-emerald-700'}>{accountActionStatus.message}</p>
              )}
            </div>
          </div>

          <button className="mt-7 flex items-center gap-2 rounded-md border border-slate-300 px-4 py-2.5 font-semibold text-slate-700 hover:bg-slate-50" type="button" onClick={signOut}>
            <LogOut size={18} aria-hidden="true" /> Sign out
          </button>
        </>
      )}
    </AccountLayout>
  )
}
