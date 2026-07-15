import { PendingApprovalsSkeleton } from './PortalLoadingSkeletons'
import PaginationControls from './PaginationControls'

export default function PendingApprovalsSection({
  pendingReportApprovals,
  pendingApprovalsLoading,
  pendingApprovalsError,
  lastUpdatedLabel,
  onRefresh,
  onBulkApprove,
  selectedReportIds,
  onToggleReportSelection,
  onToggleSelectAllReports,
  bulkApproving,
  onReviewReport,
  getReportStatusBadge,
  currentPage = 1,
  totalPages = 1,
  onPageChange = () => {},
  totalCount = 0,
  rangeStart = 0,
  rangeEnd = 0,
}) {
  const selectedCount = selectedReportIds.length
  const allSelected =
    pendingReportApprovals.length > 0 && selectedCount === pendingReportApprovals.length

  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold text-[#123A7A]">Pending Report Approvals</h2>
          <p className="mt-1 text-sm text-slate-600">
            Submitted reports waiting for owner approval across all visible customers.
          </p>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Last updated {lastUpdatedLabel}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
            {pendingReportApprovals.length} pending
          </span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={pendingApprovalsLoading}
            className="rounded-md border border-[#123A7A] bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white disabled:cursor-not-allowed disabled:opacity-70"
          >
            {pendingApprovalsLoading ? 'Refreshing...' : 'Refresh'}
          </button>
          <button
            type="button"
            onClick={onToggleSelectAllReports}
            disabled={pendingReportApprovals.length === 0 || pendingApprovalsLoading || bulkApproving}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-700 transition hover:border-[#123A7A] hover:text-[#123A7A] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {allSelected ? 'Clear Selection' : 'Select All'}
          </button>
          <button
            type="button"
            onClick={onBulkApprove}
            disabled={selectedCount === 0 || pendingApprovalsLoading || bulkApproving}
            className="rounded-md border border-emerald-600 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700 transition hover:bg-emerald-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-70"
          >
            {bulkApproving ? 'Approving...' : `Approve Selected (${selectedCount})`}
          </button>
        </div>
      </div>

      {pendingApprovalsError && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {pendingApprovalsError}
        </div>
      )}

      {pendingApprovalsLoading ? (
        <PendingApprovalsSkeleton />
      ) : pendingReportApprovals.length === 0 ? (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          No submitted reports are waiting for approval.
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {pendingReportApprovals.map((report) => {
              const statusBadge = getReportStatusBadge(report.status)

              return (
                <article key={report.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <label className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                        <input
                          type="checkbox"
                          checked={selectedReportIds.includes(String(report.id))}
                          onChange={() => onToggleReportSelection(report.id)}
                          className="h-4 w-4 rounded border-slate-300 text-[#123A7A] focus:ring-[#123A7A]"
                        />
                        Select
                      </label>
                      <h3 className="text-lg font-bold text-[#123A7A]">{report.title || 'Untitled Report'}</h3>
                      <p className="mt-1 text-sm text-slate-600">
                        {report.company_name || 'Unknown Company'} · {report.equipment_name || 'Unknown Equipment'}
                      </p>
                    </div>
                    <span
                      className={
                        'rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ' +
                        statusBadge.color
                      }
                    >
                      {statusBadge.label}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-1 text-sm text-slate-600">
                    <p>
                      <span className="font-semibold text-slate-700">Date:</span> {report.report_date || '-'}
                    </p>
                    <p>
                      <span className="font-semibold text-slate-700">Inspector:</span> {report.submitted_by_name || '-'}
                    </p>
                    <p className="max-h-10 overflow-hidden text-ellipsis">
                      <span className="font-semibold text-slate-700">Summary:</span> {report.summary || '-'}
                    </p>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onReviewReport(report)}
                      className="rounded-md bg-[#123A7A] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white transition hover:bg-[#0f3168]"
                    >
                      Review Report
                    </button>
                  </div>
                </article>
              )
            })}
          </div>

          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-between gap-4">
              <p className="text-sm text-slate-600">
                Showing <span className="font-semibold">{rangeStart}</span> to{' '}
                <span className="font-semibold">{rangeEnd}</span> of{' '}
                <span className="font-semibold">{totalCount}</span> approvals
              </p>
              <PaginationControls
                page={currentPage}
                totalPages={totalPages}
                onPrevious={() => currentPage > 1 && onPageChange(currentPage - 1)}
                onNext={() => currentPage < totalPages && onPageChange(currentPage + 1)}
              />
            </div>
          )}
        </>
      )}
    </section>
  )
}
