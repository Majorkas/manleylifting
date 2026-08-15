import { Link } from 'react-router-dom'
import { useState } from 'react'
import SiteHeader from '../components/SiteHeader'
import usePageMeta from '../utils/usePageMeta'

const equipment = [
  { name: 'North Bay Hoist', tag: 'NB-104', location: 'Dublin Depot', due: '12 Sep 2026', report: 'Good Order' },
  { name: 'Loading Gantry', tag: 'LG-220', location: 'Cork Yard', due: '28 Aug 2026', report: 'Due Soon' },
  { name: 'Workshop Crane', tag: 'WC-018', location: 'Galway Site', due: '04 Aug 2026', report: 'Overdue' },
]

const certificates = [
  ['North Bay Hoist certificate', 'Generated 08 Aug 2026'],
  ['Loading Gantry certificate', 'Generated 02 Aug 2026'],
]

function inspectionTone(report) {
  if (report === 'Good Order') return 'bg-emerald-50 text-emerald-700'
  if (report === 'Due Soon') return 'bg-amber-50 text-amber-700'
  return 'bg-red-50 text-red-700'
}

export default function PortalDemoPage() {
  usePageMeta({
    title: 'Customer Portal Demo',
    description: 'Explore a fictional preview of the Manley Lifting customer portal.',
    noIndex: true,
  })
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [selectedEquipment, setSelectedEquipment] = useState(null)

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <SiteHeader
        navbarLogo="/logo-navbar.png"
        variant="shop"
        isScrolled
        isMobileMenuOpen={isMobileMenuOpen}
        onToggleMobileMenu={() => setIsMobileMenuOpen((current) => !current)}
        onCloseMobileMenu={() => setIsMobileMenuOpen(false)}
        navItems={[
          { label: 'Home', to: '/' },
          { label: 'Shop', to: '/shop' },
          { label: 'Contact', to: '/contact' },
        ]}
      />

      <section className="border-b border-slate-200 bg-[#f4f7fb]">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-6 py-10 md:flex-row md:items-end md:justify-between md:py-14">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#C61F2A]">How the portal works</p>
            <h1 className="mt-2 text-3xl font-extrabold leading-tight text-[#123A7A] md:text-5xl">A clearer way to manage your lifting equipment records.</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600 md:text-lg">
              The preview below shows the customer-facing portal layout: company information, site details, store orders, certificates, equipment, and approved inspection reports in one secure workspace. Every record on this page is fictional and exists only to demonstrate the experience.
            </p>
          </div>
          <Link to="/contact" className="inline-flex shrink-0 rounded-md bg-[#123A7A] px-5 py-3 text-center text-sm font-bold uppercase tracking-wide text-white transition hover:bg-[#0f3168]">Contact Manley Lifting</Link>
        </div>
      </section>

      <section className="bg-[#f8fafc]">
        <div className="mx-auto w-full max-w-7xl px-6 py-10 md:py-12">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#C61F2A]">Portal</p>
              <h1 className="mt-1 text-3xl font-extrabold text-[#123A7A] md:text-4xl">Equipment &amp; Certification Hub</h1>
            </div>
            <div className="flex items-center gap-3">
              <span className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">demo_customer</span>
              <span className="rounded-md border-2 border-[#123A7A] px-4 py-2 text-sm font-bold uppercase tracking-wide text-[#123A7A]">Sign Out</span>
            </div>
          </div>

          <article className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start gap-5">
              <div className="grid h-20 w-20 place-items-center rounded-xl border border-slate-200 bg-slate-50 text-xl font-extrabold text-[#123A7A]">A</div>
              <div className="min-w-[240px] flex-1">
                <h2 className="text-2xl font-extrabold text-[#123A7A]">Acme Lifting Services</h2>
                <p className="mt-1 text-sm text-slate-500">Company profile</p>
                <div className="mt-3 grid gap-2 text-sm text-slate-600 md:grid-cols-2">
                  <p><span className="font-semibold text-slate-700">Email:</span> operations@acme.example</p>
                  <p><span className="font-semibold text-slate-700">Phone:</span> 01 555 0142</p>
                  <p className="md:col-span-2"><span className="font-semibold text-slate-700">Address:</span> 14 Harbour Road, Dublin</p>
                </div>
              </div>
            </div>
            <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <p><span className="font-semibold text-slate-700">Viewing site:</span> Dublin Depot</p>
              <p className="mt-1"><span className="font-semibold text-slate-700">Site address:</span> North Industrial Estate, Dublin</p>
            </div>
          </article>

          <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h2 className="text-2xl font-extrabold text-[#123A7A]">Store orders</h2><p className="mt-1 text-sm text-slate-600">Read-only order history from the shared account session.</p></div>
              <span className="rounded-md border border-[#123A7A] px-3 py-2 text-sm font-semibold text-[#123A7A]">Open account orders</span>
            </div>
            <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                <thead className="bg-[#123A7A] text-white"><tr><th className="px-4 py-3 font-semibold">Order</th><th className="px-4 py-3 font-semibold">Placed</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3 font-semibold">Total</th></tr></thead>
                <tbody><tr className="border-t border-slate-200"><td className="px-4 py-3 font-semibold text-slate-800">MNL-260815-EXAMPLE<p className="mt-1 text-xs font-normal text-slate-500">2 items</p></td><td className="px-4 py-3 text-slate-700">15 Aug 2026</td><td className="px-4 py-3 text-slate-700">Paid</td><td className="px-4 py-3 text-slate-700">EUR 129.00</td></tr></tbody>
              </table>
            </div>
          </section>

          <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-extrabold text-[#123A7A]">Certificates</h2><p className="mt-1 text-sm text-slate-600">Open the latest full site certificate register for this site.</p></div><span className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600">Customer view</span></div>
            <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
              <div className="bg-slate-50 px-4 py-3"><h3 className="text-sm font-semibold text-slate-700">Generated Certificates</h3><p className="mt-1 text-xs text-slate-500">Certificates generated for the selected site.</p></div>
              <div className="divide-y divide-slate-200">{certificates.map(([title, date]) => <div key={title} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><div><p className="font-semibold text-slate-800">{title}</p><p className="mt-1 text-xs text-slate-500">{date}</p></div><span className="rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">Current</span></div>)}</div>
            </div>
          </section>

          <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-extrabold text-[#123A7A]">Equipment</h2><p className="mt-1 text-sm text-slate-600">Search equipment and open approved inspection reports.</p></div><span className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600">3 assets</span></div>
            <div className="mt-4 flex flex-wrap gap-2"><span className="rounded-md bg-[#123A7A] px-3 py-2 text-xs font-bold uppercase tracking-wide text-white">Active</span><span className="rounded-md border border-slate-300 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-600">Decommissioned</span></div>
            <div className="mt-4 space-y-3 md:hidden">
              {equipment.map((item) => (
                <article key={item.tag} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><h3 className="break-words font-semibold text-slate-800">{item.name}</h3><p className="mt-1 text-xs text-slate-500">{item.tag} · {item.location}</p></div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${inspectionTone(item.report)}`}>{item.report}</span>
                  </div>
                  <p className="mt-3 text-sm text-slate-600">Next inspection: <span className="font-semibold text-slate-800">{item.due}</span></p>
                  <button type="button" onClick={() => setSelectedEquipment(item)} className="mt-4 min-h-11 w-full rounded-md border border-[#123A7A] bg-white px-3 py-2 text-sm font-semibold text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white">View equipment</button>
                </article>
              ))}
            </div>
            <div className="mt-4 hidden overflow-x-auto rounded-xl border border-slate-200 md:block">
              <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                <thead className="bg-[#123A7A] text-white"><tr><th className="px-4 py-3 font-semibold">Equipment</th><th className="px-4 py-3 font-semibold">Location</th><th className="px-4 py-3 font-semibold">Next inspection</th><th className="px-4 py-3 font-semibold">Inspection status</th><th className="px-4 py-3 font-semibold">Action</th></tr></thead>
                <tbody>{equipment.map((item) => <tr key={item.tag} className="border-t border-slate-200"><td className="px-4 py-3 font-semibold text-slate-800">{item.name}<p className="mt-1 text-xs font-normal text-slate-500">{item.tag}</p></td><td className="px-4 py-3 text-slate-700">{item.location}</td><td className="px-4 py-3 text-slate-700">{item.due}</td><td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${inspectionTone(item.report)}`}>{item.report}</span></td><td className="px-4 py-3"><button type="button" onClick={() => setSelectedEquipment(item)} className="min-h-10 rounded-md border border-[#123A7A] bg-white px-3 py-1.5 text-xs font-semibold text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white">View</button></td></tr>)}</tbody>
              </table>
            </div>
            {selectedEquipment && (
              <div className="mt-4 rounded-lg border border-[#123A7A]/20 bg-blue-50/50 p-4 md:hidden" role="status">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><p className="text-xs font-bold uppercase tracking-wide text-[#C61F2A]">Fictional equipment detail</p><h3 className="mt-1 text-lg font-bold text-[#123A7A]">{selectedEquipment.name}</h3><p className="mt-1 text-sm text-slate-600">Asset tag {selectedEquipment.tag} · {selectedEquipment.location}</p></div>
                  <button type="button" onClick={() => setSelectedEquipment(null)} className="min-h-10 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700">Close</button>
                </div>
                <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3"><div><p className="text-xs uppercase tracking-wide text-slate-500">Status</p><p className="mt-1 font-semibold text-slate-800">{selectedEquipment.status}</p></div><div><p className="text-xs uppercase tracking-wide text-slate-500">Next inspection</p><p className="mt-1 font-semibold text-slate-800">{selectedEquipment.due}</p></div><div><p className="text-xs uppercase tracking-wide text-slate-500">Approved report</p><p className="mt-1 font-semibold text-slate-800">Available in demo</p></div></div>
              </div>
            )}
          </section>

          <div className="mt-8 hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:block">
            <h2 className="text-2xl font-extrabold text-[#123A7A]">Inspection reports</h2>
            <p className="mt-1 text-sm text-slate-600">Approved reports appear here when you open an equipment record.</p>
            {selectedEquipment ? (
              <div className="mt-4 rounded-lg border border-[#123A7A]/20 bg-blue-50/50 p-4" role="status">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><p className="text-xs font-bold uppercase tracking-wide text-[#C61F2A]">Selected equipment</p><h3 className="mt-1 text-lg font-bold text-[#123A7A]">{selectedEquipment.name}</h3><p className="mt-1 text-sm text-slate-600">Asset tag {selectedEquipment.tag} · {selectedEquipment.location}</p></div>
                  <button type="button" onClick={() => setSelectedEquipment(null)} className="min-h-10 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700">Close</button>
                </div>
                <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold text-slate-800">Approved inspection report</p><p className="mt-1 text-sm text-slate-600">Annual thorough examination · 08 Aug 2026</p></div><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">Approved</span></div><button type="button" className="mt-4 min-h-10 rounded-md border border-[#123A7A] px-3 py-2 text-xs font-semibold text-[#123A7A]">View report</button></div>
              </div>
            ) : <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">Select an equipment item to view its fictional approved reports.</div>}
          </div>

          <p className="mt-4 text-center text-sm text-slate-500">This is a visual preview using fictional customer data. The live portal is secured to each customer account.</p>

          <div className="mt-8 border-t border-slate-200 py-8 text-center">
            <h2 className="mt-4 text-2xl font-extrabold text-[#123A7A]">Bring this level of clarity to your own operation.</h2>
            <p className="mx-auto mt-3 max-w-2xl text-base leading-7 text-slate-600">
              Join Manley Lifting and give your company a dedicated customer portal supported by certified engineers who can inspect your equipment, manage reports, and keep your certification records up to date.
            </p>
            <Link to="/contact" className="mt-5 inline-flex rounded-md bg-[#123A7A] px-5 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-[#0f3168]">Contact Manley Lifting</Link>
          </div>
        </div>
      </section>
    </main>
  )
}
