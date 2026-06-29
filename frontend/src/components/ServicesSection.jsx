export default function ServicesSection() {
  return (
    <section id="services" className="border-b border-slate-200 bg-white">
      <div className="mx-auto w-full max-w-7xl px-6 py-16">
        <div className="mb-10">
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#C61F2A]">Services</p>
          <h2 className="mt-2 text-3xl font-extrabold text-[#123A7A] md:text-4xl">
            Trusted Lifting Support from Oulart, Co. Wexford
          </h2>
          <p className="mt-4 max-w-3xl text-slate-600">
            As a local family business, we combine practical expertise with personal service across inspection, training, supply, and installation.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <article className="rounded-xl border border-slate-200 p-6 shadow-sm">
            <h3 className="text-xl font-bold text-[#123A7A]">Inspection, Testing and Certification</h3>
            <p className="mt-3 text-slate-600">
              We arrange complete inspection, testing, and certification for lifting equipment to keep your operations compliant and safe.
            </p>
          </article>

          <article className="rounded-xl border border-slate-200 p-6 shadow-sm">
            <h3 className="text-xl font-bold text-[#123A7A]">Training Courses</h3>
            <p className="mt-3 text-slate-600">
              Practical training for the safe use of cranes and lifting equipment, delivered by experienced specialists.
            </p>
          </article>

          <article className="rounded-xl border border-slate-200 p-6 shadow-sm">
            <h3 className="text-xl font-bold text-[#123A7A]">Supply and Installation</h3>
            <p className="mt-3 text-slate-600">
              We supply and fit cranes, hoists, monorails, and jib cranes, plus chain and web slings, shackles, eyebolts, and load restraining equipment.
            </p>
          </article>
        </div>
      </div>
    </section>
  )
}
