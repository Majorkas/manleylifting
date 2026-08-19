export default function TrustSection() {
  return (
    <section id="trust" aria-labelledby="trust-heading" className="bg-[#f8fafc]">
      <div className="mx-auto grid w-full max-w-7xl gap-10 px-6 py-16 md:grid-cols-2 md:items-start">
        <div className="fade-up">
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#C61F2A]">Trust and Compliance</p>
          <h2 id="trust-heading" className="mt-2 text-balance text-3xl font-extrabold text-[#123A7A] md:text-4xl">
            Clear records. Practical expertise. Reliable follow-through.
          </h2>
          <p className="mt-4 text-slate-600">
            We help industrial teams keep decisions, inspections, and next steps visible from planning through completion.
          </p>
        </div>

        <div className="fade-up delay-1 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <ul className="space-y-4 text-slate-700">
            <li className="flex gap-3">
              <span aria-hidden="true" className="mt-2 h-2 w-2 rounded-full bg-[#C61F2A]" />
              Experienced inspection and compliance specialists
            </li>
            <li className="flex gap-3">
              <span aria-hidden="true" className="mt-2 h-2 w-2 rounded-full bg-[#123A7A]" />
              Documented inspection and testing workflows
            </li>
            <li className="flex gap-3">
              <span aria-hidden="true" className="mt-2 h-2 w-2 rounded-full bg-[#C61F2A]" />
              Specialist support for cranes, hoists, monorails, and jib cranes
            </li>
            <li className="flex gap-3">
              <span aria-hidden="true" className="mt-2 h-2 w-2 rounded-full bg-[#123A7A]" />
              Clear records, traceability, and service follow-through
            </li>
          </ul>
        </div>
      </div>
    </section>
  )
}
