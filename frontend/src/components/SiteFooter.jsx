import { Link } from 'react-router-dom'

export default function SiteFooter({ legalLinks }) {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto w-full max-w-7xl px-6 py-12">
        <div className="grid gap-10 md:grid-cols-3">
          <div>
            <h3 className="text-lg font-extrabold text-[#123A7A]">Manley Lifting</h3>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              Family-run and based in Oulart, Co. Wexford, Manley Lifting provides trusted inspection, certification, training, and equipment support to the crane and lifting industry.
            </p>

            <div className="mt-4">
              <Link
                to="/shop"
                className="inline-flex items-center text-sm font-bold uppercase tracking-wide text-[#C61F2A] transition hover:text-[#9f1720]"
              >
                Visit the shop
              </Link>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-bold uppercase tracking-[0.12em] text-[#C61F2A]">Legal</h4>
            <ul className="mt-3 space-y-2 text-sm text-slate-700">
              {legalLinks.map((link) => (
                <li key={link.label}>
                  <Link to={link.to} className="footer-link">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-bold uppercase tracking-[0.12em] text-[#C61F2A]">Company Details</h4>
            <ul className="mt-3 space-y-2 text-sm text-slate-700">
              <li>Family Business: Michael Manley and Jackie Manley</li>
              <li>Location: Oulart, Co. Wexford, Ireland</li>
              <li>Email: info@manleylifting.ie</li>
            </ul>
          </div>
        </div>

        <div className="mt-10 border-t border-slate-200 pt-6 text-xs text-slate-500">
          <p>Copyright {new Date().getFullYear()} Manley Lifting. All rights reserved.</p>
        </div>
      </div>
    </footer>
  )
}
