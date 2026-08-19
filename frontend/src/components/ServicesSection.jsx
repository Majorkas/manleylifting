export default function ServicesSection() {
  return (
    <section id="services" aria-labelledby="services-heading" className="border-b border-slate-200 bg-white">
      <div className="mx-auto w-full max-w-7xl px-6 py-16">
        <div className="mb-10">
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#C61F2A]">Services</p>
          <h2 id="services-heading" className="mt-2 text-balance text-3xl font-extrabold text-[#123A7A] md:text-4xl">
            Keep lifting operations safe, compliant, and ready
          </h2>
          <p className="mt-4 max-w-3xl text-slate-600">
            Choose the support your site needs, from scheduled inspections to equipment supply and installation.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <article className="rounded-xl border border-slate-200 p-6 shadow-sm">
            <h3 className="text-xl font-bold text-[#123A7A]">Inspection, testing, and certification</h3>
            <p className="mt-3 text-slate-600">
              Keep lifting equipment documented, inspected, and ready for use with clear certification records.
            </p>
          </article>

          <article className="rounded-xl border border-slate-200 p-6 shadow-sm">
            <h3 className="text-xl font-bold text-[#123A7A]">Operator and lifting training</h3>
            <p className="mt-3 text-slate-600">
              Practical courses for the safe use of cranes and lifting equipment, delivered by experienced specialists.
            </p>
          </article>

          <article className="rounded-xl border border-slate-200 p-6 shadow-sm">
            <h3 className="text-xl font-bold text-[#123A7A]">Supply and installation</h3>
            <p className="mt-3 text-slate-600">
              Source and install cranes, hoists, monorails, jib cranes, slings, shackles, eyebolts, and load restraint equipment.
            </p>
          </article>
        </div>
      </div>
    </section>
  )
}
