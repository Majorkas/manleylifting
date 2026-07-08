import PaginationControls from './PaginationControls'
import { CustomerCardGridSkeleton, CustomerStatsSkeleton } from './PortalLoadingSkeletons'

export default function CustomerListSection({
  isOwner,
  companies,
  lastUpdatedLabel,
  dashboardStats,
  dashboardStatsError,
  dashboardStatsLoading,
  customerStatsFilter,
  onToggleCustomerStatsFilter,
  customerSearchInput,
  onCustomerSearchChange,
  customerCreateError,
  customerEditError,
  onRefreshCustomers,
  onExportCustomers,
  onBulkDeactivateCustomers,
  selectedCustomerIds,
  onToggleCustomerSelection,
  onToggleSelectAllCustomers,
  bulkDeactivatingCustomers,
  refreshingCustomers,
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
  const selectedCount = selectedCustomerIds.length
  const allSelected =
    filteredCustomers.length > 0 && selectedCount === filteredCustomers.length

  return (
    <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold text-[#123A7A]">Customer List</h2>
          <p className="mt-1 text-sm text-slate-600">
            Open a customer to view company details, equipment, reports, and certificates.
          </p>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Last updated {lastUpdatedLabel}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          <button
            type="button"
            onClick={onRefreshCustomers}
            disabled={refreshingCustomers}
            className="rounded-md border border-[#123A7A] bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white disabled:cursor-not-allowed disabled:opacity-70"
          >
            {refreshingCustomers ? 'Refreshing Customers...' : 'Refresh Customers'}
          </button>
          <button
            type="button"
            onClick={onExportCustomers}
            className="rounded-md border border-[#123A7A] bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
          >
            Export Customers CSV
          </button>
          {isOwner && (
            <>
              <button
                type="button"
                onClick={onToggleSelectAllCustomers}
                disabled={filteredCustomers.length === 0 || bulkDeactivatingCustomers}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-700 transition hover:border-[#123A7A] hover:text-[#123A7A] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {allSelected ? 'Clear Selection' : 'Select All'}
              </button>
              <button
                type="button"
                onClick={onBulkDeactivateCustomers}
                disabled={selectedCount === 0 || bulkDeactivatingCustomers}
                className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-red-700 transition hover:bg-red-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-70"
              >
                {bulkDeactivatingCustomers ? 'Deactivating...' : `Deactivate Selected (${selectedCount})`}
              </button>
            </>
          )}
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

          {dashboardStatsLoading ? (
            <CustomerStatsSkeleton />
          ) : (
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
                <p className="mt-2 text-3xl font-extrabold text-red-800">{dashboardStats.overdue_count}</p>
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
                <p className="mt-2 text-3xl font-extrabold text-amber-800">{dashboardStats.due_soon_count}</p>
                <p className="mt-1 text-xs text-amber-700">
                  Upcoming inspections to schedule {customerStatsFilter === 'due_soon' ? '(filtered)' : ''}
                </p>
              </button>

              <article className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Pending Approvals</p>
                <p className="mt-2 text-3xl font-extrabold text-blue-800">{dashboardStats.pending_approvals_count}</p>
                <p className="mt-1 text-xs text-blue-700">Submitted reports waiting review</p>
              </article>
            </div>
          )}
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
      {customerEditError && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {customerEditError}
        </div>
      )}

      {loading ? (
        <CustomerCardGridSkeleton />
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {visibleCustomers.map((item) => (
            <article key={item.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {isOwner && (
                    <label className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                      <input
                        type="checkbox"
                        checked={selectedCustomerIds.includes(String(item.id))}
                        onChange={() => onToggleCustomerSelection(item.id)}
                        className="h-4 w-4 rounded border-slate-300 text-[#123A7A] focus:ring-[#123A7A]"
                      />
                      Select
                    </label>
                  )}
                  <h3 className="min-w-0 break-words text-lg font-bold text-[#123A7A]">{item.name}</h3>
                </div>
                <div className="flex w-full flex-wrap items-center gap-1 sm:w-auto sm:flex-col sm:items-end">
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
