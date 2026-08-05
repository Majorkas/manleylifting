import ShopPageLayout from './ShopPageLayout'

export default function AccountLayout({ eyebrow, title, intro, children, aside }) {
  return (
    <ShopPageLayout>
      <main className="border-y border-slate-200 bg-[#f4f7fb]">
        <section className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-12 lg:grid-cols-[minmax(0,0.82fr),minmax(360px,0.58fr)] lg:items-start lg:py-16">
          <div className="pt-2">
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#C61F2A]">{eyebrow}</p>
            <h1 className="mt-3 max-w-2xl text-4xl font-extrabold text-[#123A7A] md:text-5xl">
              {title}
            </h1>
            {intro && <p className="mt-5 max-w-xl text-lg leading-7 text-slate-600">{intro}</p>}
            {aside && <div className="mt-8 max-w-xl border-l-4 border-[#C61F2A] pl-5 text-sm leading-6 text-slate-600">{aside}</div>}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            {children}
          </div>
        </section>
      </main>
    </ShopPageLayout>
  )
}
