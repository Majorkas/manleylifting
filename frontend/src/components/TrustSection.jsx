export default function TrustSection() {
  return (
    <section id="trust" className="bg-[#f8fafc]">
      <div className="mx-auto grid w-full max-w-7xl gap-10 px-6 py-16 md:grid-cols-2 md:items-start">
        <div className="fade-up">
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#C61F2A]">Trust and Compliance</p>
          <h2 className="mt-2 text-3xl font-extrabold text-[#123A7A] md:text-4xl">
            Family Values. Professional Standards.
          </h2>
          <p className="mt-4 text-slate-600">
            At Manley Lifting, Michael and Jackie Manley have built the business on reliability, honest advice, and safety-first delivery. From our base in Oulart, Co. Wexford, we support industrial clients with certified processes and practical, site-ready knowledge.
          </p>
        </div>

        <div className="fade-up delay-1 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <ul className="space-y-4 text-slate-700">
            <li className="flex gap-3">
              <span className="mt-2 h-2 w-2 rounded-full bg-[#C61F2A]" />
              Owner-led service from Michael and Jackie Manley
            </li>
            <li className="flex gap-3">
              <span className="mt-2 h-2 w-2 rounded-full bg-[#123A7A]" />
              Certified inspection and testing workflows
            </li>
            <li className="flex gap-3">
              <span className="mt-2 h-2 w-2 rounded-full bg-[#C61F2A]" />
              Specialist support for cranes, hoists, monorails, and jib cranes
            </li>
            <li className="flex gap-3">
              <span className="mt-2 h-2 w-2 rounded-full bg-[#123A7A]" />
              Supply of slings, shackles, eyebolts, and load restraint equipment
            </li>
          </ul>
        </div>
      </div>
    </section>
  )
}
