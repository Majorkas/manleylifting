import { useEffect, useState } from 'react'
import { ArrowLeft, MapPin, Plus, Trash2 } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import AccountLayout from '../components/AccountLayout'
import PortalToast from '../components/PortalToast'
import { createAccountAddress, deleteAccountAddress, getAccountAddresses, updateAccountAddress } from '../utils/portalApi'
import usePageMeta from '../utils/usePageMeta'

const blankForm = {
  label: '',
  recipientName: '',
  recipientPhone: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  county: '',
  postcode: '',
  countryCode: 'GB',
  isDefaultShipping: true,
  isDefaultBilling: false,
}

function normalizeRecentAddress(rawAddress) {
  if (!rawAddress || typeof rawAddress !== 'object') return null

  return {
    id: Number(rawAddress?.id || 0) || Date.now(),
    label: String(rawAddress?.label || 'Checkout address').trim(),
    recipientName: String(rawAddress?.recipientName || '').trim(),
    recipientPhone: String(rawAddress?.recipientPhone || '').trim(),
    addressLine1: String(rawAddress?.addressLine1 || '').trim(),
    addressLine2: String(rawAddress?.addressLine2 || '').trim(),
    city: String(rawAddress?.city || '').trim(),
    county: String(rawAddress?.county || '').trim(),
    postcode: String(rawAddress?.postcode || '').trim(),
    countryCode: String(rawAddress?.countryCode || '').trim(),
    isDefaultShipping: Boolean(rawAddress?.isDefaultShipping),
    isDefaultBilling: Boolean(rawAddress?.isDefaultBilling),
  }
}

function readRecentAddressFromStorage() {
  if (typeof window === 'undefined') return null

  try {
    const rawRecentAddress = window.localStorage.getItem('manley-recent-account-address')
    if (!rawRecentAddress) return null

    const parsedRecentAddress = JSON.parse(rawRecentAddress)
    const normalizedRecentAddress = normalizeRecentAddress(parsedRecentAddress)
    if (!normalizedRecentAddress) return null

    if (!normalizedRecentAddress.label && !normalizedRecentAddress.addressLine1 && !normalizedRecentAddress.city) {
      return null
    }

    return normalizedRecentAddress
  } catch {
    return null
  }
}

export default function AccountAddressesPage() {
  usePageMeta({ title: 'Saved addresses', description: 'Manage your Manley Lifting saved addresses.', noIndex: true })
  const navigate = useNavigate()
  const [addresses, setAddresses] = useState(() => {
    const recentAddress = readRecentAddressFromStorage()
    return recentAddress ? [recentAddress] : []
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [validationMessage, setValidationMessage] = useState('')
  const [toast, setToast] = useState(null)
  const [form, setForm] = useState(blankForm)
  const [editingAddressId, setEditingAddressId] = useState(null)
  const [addressToRemove, setAddressToRemove] = useState(null)

  useEffect(() => {
    let cancelled = false
    const recentAddress = readRecentAddressFromStorage()

    if (recentAddress) {
      setAddresses((current) => {
        const alreadyPresent = current.some((address) => String(address.id) === String(recentAddress.id))
        if (alreadyPresent) return current
        return [recentAddress, ...current]
      })
    }

    getAccountAddresses()
      .then((result) => {
        if (!cancelled) {
          setAddresses((current) => {
            const merged = Array.isArray(result) ? [...result] : []
            if (recentAddress) {
              const alreadyExists = merged.some((address) => String(address.id) === String(recentAddress.id))
              if (!alreadyExists) {
                merged.unshift(recentAddress)
              }
            }
            return merged
          })

          if (typeof window !== 'undefined') {
            window.localStorage.removeItem('manley-recent-account-address')
          }
        }
      })
      .catch((error) => {
        if (cancelled) return
        if (error?.status === 401) {
          navigate('/account/login?redirect=/account/addresses', { replace: true })
          return
        }
        setErrorMessage(String(error?.message || 'Addresses could not be loaded.'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [navigate])

  useEffect(() => {
    if (!toast) return

    const timer = window.setTimeout(() => {
      setToast(null)
    }, 3500)

    return () => window.clearTimeout(timer)
  }, [toast])

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)
    setErrorMessage('')
    setValidationMessage('')
    setToast(null)

    const requiredFields = [form.label, form.recipientName, form.addressLine1, form.city, form.postcode, form.countryCode]
    if (requiredFields.some((value) => String(value || '').trim() === '')) {
      setValidationMessage('Please complete the required fields before saving your address.')
      setSaving(false)
      return
    }

    try {
      if (editingAddressId) {
        const updated = await updateAccountAddress(editingAddressId, form)
        setAddresses((current) => current.map((address) => (address.id === updated.id ? updated : address)))
      } else {
        const created = await createAccountAddress(form)
        setAddresses((current) => [created, ...current])
      }
      setForm(blankForm)
      setEditingAddressId(null)
      setToast({
        title: editingAddressId ? 'Address updated' : 'Address saved',
        message: editingAddressId ? 'Your address has been updated.' : 'Your new address has been saved.',
      })
    } catch (error) {
      setErrorMessage(String(error?.message || 'Address could not be saved.'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(addressId) {
    setErrorMessage('')
    setToast(null)
    try {
      await deleteAccountAddress(addressId)
      setAddresses((current) => current.filter((address) => address.id !== addressId))
      if (editingAddressId === addressId) {
        setEditingAddressId(null)
        setForm(blankForm)
      }
      setToast({ title: 'Address removed', message: 'Address removed.' })
      setAddressToRemove(null)
    } catch (error) {
      setErrorMessage(String(error?.message || 'Address could not be removed.'))
    }
  }

  function startEditing(address) {
    setEditingAddressId(address.id)
    setForm({
      label: address.label || '',
      recipientName: address.recipientName || '',
      recipientPhone: address.recipientPhone || '',
      addressLine1: address.addressLine1 || '',
      addressLine2: address.addressLine2 || '',
      city: address.city || '',
      county: address.county || '',
      postcode: address.postcode || '',
      countryCode: address.countryCode || 'GB',
      isDefaultShipping: Boolean(address.isDefaultShipping),
      isDefaultBilling: Boolean(address.isDefaultBilling),
    })
  }

  function resetForm() {
    setForm(blankForm)
    setEditingAddressId(null)
    setValidationMessage('')
    setToast(null)
  }

  function updateField(event) {
    const { name, value, type, checked } = event.target
    setForm((current) => ({
      ...current,
      [name]: type === 'checkbox' ? checked : value,
    }))
    if (validationMessage) setValidationMessage('')
  }

  return (
    <AccountLayout
      eyebrow="Addresses"
      title="Saved addresses"
      intro="Keep your delivery details handy for faster checkout."
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 shadow-sm">
          <div>
            <p className="text-sm font-semibold text-slate-900">{addresses.length} address{addresses.length === 1 ? '' : 'es'} saved</p>
            <p className="text-sm text-slate-600">Use these for future orders and delivery updates.</p>
          </div>
          <Link to="/account" className="inline-flex items-center gap-2 text-sm font-semibold text-[#123A7A]">
            <ArrowLeft size={16} aria-hidden="true" /> Back to account
          </Link>
        </div>

        {errorMessage && <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div>}
        {validationMessage && <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">{validationMessage}</div>}

        <PortalToast toast={toast} onClose={() => setToast(null)} />

        <form noValidate onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2 text-sm font-semibold text-slate-900">
            <div className="flex items-center gap-2">
              <Plus size={16} aria-hidden="true" /> {editingAddressId ? 'Edit address' : 'Add a new address'}
            </div>
            {editingAddressId && (
              <button type="button" onClick={resetForm} className="text-sm font-semibold text-[#123A7A]">
                Cancel edit
              </button>
            )}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">
              <span className="mb-1 block">Label</span>
              <input name="label" value={form.label} onChange={updateField} className="w-full rounded-md border border-slate-300 px-3 py-2" placeholder="Home, Work, etc." required />
            </label>
            <label className="text-sm font-medium text-slate-700">
              <span className="mb-1 block">Recipient</span>
              <input name="recipientName" value={form.recipientName} onChange={updateField} className="w-full rounded-md border border-slate-300 px-3 py-2" placeholder="Full name" required />
            </label>
            <label className="text-sm font-medium text-slate-700">
              <span className="mb-1 block">Phone</span>
              <input name="recipientPhone" value={form.recipientPhone} onChange={updateField} className="w-full rounded-md border border-slate-300 px-3 py-2" placeholder="Phone number" />
            </label>
            <label className="text-sm font-medium text-slate-700">
              <span className="mb-1 block">Address line 1</span>
              <input name="addressLine1" value={form.addressLine1} onChange={updateField} className="w-full rounded-md border border-slate-300 px-3 py-2" placeholder="1 Main Street" required />
            </label>
            <label className="text-sm font-medium text-slate-700">
              <span className="mb-1 block">Address line 2</span>
              <input name="addressLine2" value={form.addressLine2} onChange={updateField} className="w-full rounded-md border border-slate-300 px-3 py-2" placeholder="Apartment, unit, etc." />
            </label>
            <label className="text-sm font-medium text-slate-700">
              <span className="mb-1 block">Town or city</span>
              <input name="city" value={form.city} onChange={updateField} className="w-full rounded-md border border-slate-300 px-3 py-2" placeholder="City" required />
            </label>
            <label className="text-sm font-medium text-slate-700">
              <span className="mb-1 block">County</span>
              <input name="county" value={form.county} onChange={updateField} className="w-full rounded-md border border-slate-300 px-3 py-2" placeholder="County" />
            </label>
            <label className="text-sm font-medium text-slate-700">
              <span className="mb-1 block">Postcode</span>
              <input name="postcode" value={form.postcode} onChange={updateField} className="w-full rounded-md border border-slate-300 px-3 py-2" placeholder="Postcode" required />
            </label>
            <label className="text-sm font-medium text-slate-700">
              <span className="mb-1 block">Country code</span>
              <input name="countryCode" value={form.countryCode} onChange={updateField} className="w-full rounded-md border border-slate-300 px-3 py-2" placeholder="GB" required />
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="isDefaultShipping" checked={form.isDefaultShipping} onChange={updateField} />
            Use as default shipping address
          </label>

          <div className="flex justify-end">
            <button type="submit" disabled={saving} className="rounded-md bg-[#123A7A] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70">
              {saving ? 'Saving…' : editingAddressId ? 'Update address' : 'Save address'}
            </button>
          </div>
        </form>

        {loading && !errorMessage && <p className="text-slate-600">Loading your addresses…</p>}

        {!loading && !errorMessage && addresses.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
            You have not saved any addresses yet.
          </div>
        )}

        {addressToRemove && (
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-slate-900">Remove this address?</p>
            <p className="mt-1 text-sm text-slate-600">This will delete {addressToRemove.label || 'this saved address'} from your account.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => setAddressToRemove(null)} className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">
                Cancel
              </button>
              <button type="button" onClick={() => handleDelete(addressToRemove.id)} className="rounded-md bg-[#123A7A] px-3 py-2 text-sm font-semibold text-white">
                Confirm remove
              </button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {addresses.map((address) => (
            <article key={address.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-[#123A7A] hover:shadow-md">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <MapPin size={18} className="text-[#123A7A]" aria-hidden="true" />
                    <p className="font-semibold text-slate-900">{address.label || 'Saved address'}</p>
                    {address.isDefaultShipping && <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">Default shipping</span>}
                  </div>
                  <p className="mt-2 text-sm text-slate-600">{address.recipientName}</p>
                  <p className="text-sm text-slate-600">{address.addressLine1}{address.addressLine2 ? `, ${address.addressLine2}` : ''}</p>
                  <p className="text-sm text-slate-600">{address.city}{address.county ? `, ${address.county}` : ''}</p>
                  <p className="text-sm text-slate-600">{address.postcode} · {address.countryCode}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => startEditing(address)} className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                    Edit
                  </button>
                  <button type="button" onClick={() => setAddressToRemove(address)} className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                    <Trash2 size={16} aria-hidden="true" /> Remove
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </AccountLayout>
  )
}
