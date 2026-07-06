import PaginationControls from './PaginationControls'

export default function CustomerListSection({
  isOwner,
  companies,
  dashboardStats,
  dashboardStatsError,
  dashboardStatsLoading,
  customerStatsFilter,
  onToggleCustomerStatsFilter,
  customerSearchInput,
  onCustomerSearchChange,
  customerCreateError,
  customerCreateSuccess,
  customerEditError,
  customerEditSuccess,
  loading,
  visibleCustomers,
  filteredCustomers,
  customerStartIndex,
  customerPageSize,
  customerPage,
  customerTotalPages,
  onCustomerPagePrevious,
  onCustomerPageNext,
  onAddCustomer,
  onOpenCustomer,
  onEditCustomer,
}) {
  return (
    <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold text-[#123A7A]">Customer List</h2>
          <p className="mt-1 text-sm text-slate-600">
            Open a customer to view company details, equipment, reports, and certificates.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isOwner && (
            <button
              type="button"
              onClick={onAddCustomer}
              className="rounded-md border border-[#123A7A] bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
            >
              Add Customer
            </button>
          )}
          <span className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
            {companies.length} customer{companies.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {isOwner && (
        <>
          {dashboardStatsError && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {dashboardStatsError}
            </div>
          )}

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <button
              type="button"
              onClick={() => onToggleCustomerStatsFilter('overdue')}
              aria-pressed={customerStatsFilter === 'overdue'}
              className={
                'rounded-xl p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-red-300 ' +
                (customerStatsFilter === 'overdue'
                  ? 'border-2 border-red-400 bg-red-100 shadow-sm'
                  : 'border border-red-200 bg-red-50 hover:bg-red-100')
              }
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Overdue Inspections</p>
              <p className="mt-2 text-3xl font-extrabold text-red-800">
                {dashboardStatsLoading ? '-' : dashboardStats.overdue_count}
              </p>
              <p className="mt-1 text-xs text-red-700">
                Equipment already past due date {customerStatsFilter === 'overdue' ? '(filtered)' : ''}
              </p>
            </button>

            <button
              type="button"
              onClick={() => onToggleCustomerStatsFilter('due_soon')}
              aria-pressed={customerStatsFilter === 'due_soon'}
              className={
                'rounded-xl p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-amber-300 ' +
                (customerStatsFilter === 'due_soon'
                  ? 'border-2 border-amber-400 bg-amber-100 shadow-sm'
                  : 'border border-amber-200 bg-amber-50 hover:bg-amber-100')
              }
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Due In 14 Days</p>
              <p className="mt-2 text-3xl font-extrabold text-amber-800">
                {dashboardStatsLoading ? '-' : dashboardStats.due_soon_count}
              </p>
              <p className="mt-1 text-xs text-amber-700">
                Upcoming inspections to schedule {customerStatsFilter === 'due_soon' ? '(filtered)' : ''}
              </p>
            </button>

            <article className="rounded-xl border border-blue-200 bg-blue-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Pending Approvals</p>
              <p className="mt-2 text-3xl font-extrabold text-blue-800">
                {dashboardStatsLoading ? '-' : dashboardStats.pending_approvals_count}
              </p>
              <p className="mt-1 text-xs text-blue-700">Submitted reports waiting review</p>
            </article>
          </div>
        </>
      )}

      <div className="mt-4 w-full max-w-md">
        <input
          type="search"
          value={customerSearchInput}
          onChange={(event) => onCustomerSearchChange(event.target.value)}
          placeholder="Search customers by name, email, phone"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-[#123A7A]"
        />
      </div>

      {customerCreateError && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {customerCreateError}
        </div>
      )}
      {customerCreateSuccess && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {customerCreateSuccess}
        </div>
      )}
      {customerEditError && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {customerEditError}
        </div>
      )}
      {customerEditSuccess && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {customerEditSuccess}
        </div>
      )}

      {loading ? (
        <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          Loading customers...
        </div>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {visibleCustomers.map((item) => (
            <article key={item.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-lg font-bold text-[#123A7A]">{item.name}</h3>
                <div className="flex flex-col items-end gap-1">
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                    Due (14d): {Number(item.inspections_due_count || 0)}
                  </span>
                  <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-red-700">
                    Overdue: {Number(item.inspections_overdue_count || 0)}
                  </span>
                </div>
              </div>
              <p className="mt-1 text-sm text-slate-600">{item.contact_email || 'No email provided'}</p>
              <p className="mt-1 text-sm text-slate-600">{item.contact_phone || 'No phone provided'}</p>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => onOpenCustomer(item.id)}
                  className="rounded-md bg-[#123A7A] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f3168]"
                >
                  Open Customer Profile
                </button>
                {isOwner && (
                  <button
                    type="button"
                    onClick={() => onEditCustomer(item)}
                    className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-[#123A7A] hover:text-[#123A7A]"
                  >
                    Edit Customer
                  </button>
                )}
              </div>
            </article>
          ))}
          {!isOwner && companies.length === 0 && (
            <div className="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              No customer companies are assigned to this account.
            </div>
          )}
          {companies.length > 0 && filteredCustomers.length === 0 && (
            <div className="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              No customers match your search.
            </div>
          )}
        </div>
      )}

      {!loading && filteredCustomers.length > 0 && (
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-sm text-slate-600">
            Showing {customerStartIndex + 1}-
            {Math.min(customerStartIndex + customerPageSize, filteredCustomers.length)} of {filteredCustomers.length}{' '}
            customers.
          </p>
          <PaginationControls
            page={customerPage}
            totalPages={customerTotalPages}
            onPrevious={onCustomerPagePrevious}
            onNext={onCustomerPageNext}
          />
        </div>
      )}
    </section>
  )
}
