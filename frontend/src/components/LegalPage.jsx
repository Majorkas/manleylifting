import { Link } from 'react-router-dom'

export default function LegalPage({ title }) {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <Link to="/" className="text-sm font-semibold text-[#123A7A] hover:underline">
          Back to Home
        </Link>
        <h1 className="mt-4 text-4xl font-extrabold text-[#123A7A]">{title}</h1>
        <p className="mt-4 text-slate-600">
          This page is a placeholder. Replace with your solicitor-reviewed legal copy.
        </p>
      </div>
    </div>
  )
}
