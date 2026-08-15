import { NavLink } from 'react-router-dom'

const tabClassName = ({ isActive }) => [
  'inline-flex items-center rounded-full border px-4 py-2 text-sm font-semibold transition',
  isActive
    ? 'border-[#123A7A] bg-[#123A7A] text-white shadow-sm'
    : 'border-slate-200 bg-white text-slate-700 hover:border-[#123A7A] hover:text-[#123A7A]',
].join(' ')

export default function AccountSectionTabs() {
  return (
    <nav aria-label="Account sections" className="mb-6 flex flex-wrap gap-2">
      <NavLink className={tabClassName} to="/account/orders">Orders</NavLink>
      <NavLink className={tabClassName} to="/account/addresses">Addresses</NavLink>
      <NavLink className={tabClassName} to="/account/security">Security</NavLink>
    </nav>
  )
}