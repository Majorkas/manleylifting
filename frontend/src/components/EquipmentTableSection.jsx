import PaginationControls from './PaginationControls'
import { EquipmentTableSkeleton, InlineListSkeleton } from './PortalLoadingSkeletons'

export default function EquipmentTableSection({
  canEditReports,
  lastUpdatedLabel,
  searchInput,
  onSearchInputChange,
  onSearchSubmit,
  onOpenCreateEquipment,
  equipmentCreateError,
  onRefreshEquipment,
  onExportEquipment,
  onBulkDecommissionEquipment,
  selectedEquipmentIds,
  onToggleEquipmentSelection,
  onToggleSelectAllEquipment,
  bulkDecommissioning,
  refreshingEquipment,
  loading,
  equipment,
  equipmentTableTab,
  onSetEquipmentTableTab,
  equipmentSortKey,
  equipmentSortDirection,
  onToggleEquipmentSort,
  inspectionUrgencyFilter,
  onInspectionUrgencyFilterChange,
  equipmentStatusFilter,
  onEquipmentStatusFilterChange,
  activeEquipment,
  decommissionedEquipment,
  isMobileViewport,
  visibleEquipment,
  getInspectionStatusBadge,
  formatDateDDMMYYYY,
  expandedEquipmentCardId,
  onToggleExpandedEquipmentCard,
  activeSelectedEquipment,
  onSelectEquipmentForView,
  onCloseEquipmentDetails,
  onOpenEquipmentQr,
  isOwner,
  onSetEquipmentActive,
  updatingEquipmentStatus,
  equipmentStatusDraft,
  onEquipmentStatusDraftChange,
  onSubmitEquipmentStatusUpdate,
  equipmentStatusError,
  reportError,
  certificateError,
  equipmentActivityError,
  canViewEquipmentActivity,
  onOpenCreateReport,
  deletingCertificateId,
  reportsLoading,
  reports,
  getReportStatusBadge,
  onViewReport,
  equipmentActivityLoading,
  equipmentActivity,
  nowMs,
  getActivityActionLabel,
  getActivityActionBadge,
  formatActivityDetails,
  formatActivityTimestamp,
  getActivityRecoveryState,
  recoveredAtMsByRecoverableTarget,
  recoveringCertificateId,
  recoveringReportId,
  deletingDraftReport,
  onRecoverActivityFromEntry,
  currentTableEquipment,
  equipmentRangeStart,
  equipmentRangeEnd,
  equipmentPage,
  equipmentTotalPages,
  onEquipmentPagePrevious,
  onEquipmentPageNext,
}) {
  const selectedCount = selectedEquipmentIds.length
  const canBulkDecommission = isOwner && equipmentTableTab === 'active'
  const allSelected =
    canBulkDecommission && activeEquipment.length > 0 && selectedCount === activeEquipment.length

  function getMostRecentReport(items) {
    if (!Array.isArray(items) || items.length === 0) return null

    return items.reduce((latest, candidate) => {
      if (!latest) return candidate

      const latestDateMs = Date.parse(latest.report_date || '')
      const candidateDateMs = Date.parse(candidate.report_date || '')
      const latestIsValid = Number.isFinite(latestDateMs)
      const candidateIsValid = Number.isFinite(candidateDateMs)

      if (candidateIsValid && !latestIsValid) return candidate
      if (candidateIsValid && latestIsValid && candidateDateMs > latestDateMs) return candidate
      if (candidateIsValid && latestIsValid && candidateDateMs === latestDateMs) {
        return Number(candidate.id || 0) > Number(latest.id || 0) ? candidate : latest
      }

      return latest
    }, null)
  }

  function getManagedEquipmentInspectionBadge(item) {
    if (String(item.status || '').toLowerCase() === 'decommissioned') {
      return { label: 'Decommissioned', color: 'bg-slate-100 text-slate-700 border-slate-300' }
    }

    const statusKey = String(item.inspection_status_key || '').trim().toLowerCase()
    if (statusKey === 'attention_required') {
      return { label: 'Attention Required', color: 'bg-red-100 text-red-700 border-red-300' }
    }
    if (statusKey === 'worn_serviceable') {
      return { label: 'Worn', color: 'bg-amber-100 text-amber-700 border-amber-300' }
    }
    if (statusKey === 'not_presented') {
      return { label: 'Not Presented', color: 'bg-red-100 text-red-700 border-red-300' }
    }
    if (statusKey === 'good_order') {
      return { label: 'Good Order', color: 'bg-emerald-100 text-emerald-700 border-emerald-300' }
    }

    return { label: item.inspection_status_label || 'No Approved Report', color: 'bg-slate-100 text-slate-700 border-slate-300' }
  }

  function getSortIndicator(columnKey) {
    if (equipmentSortKey !== columnKey) return ''
    return equipmentSortDirection === 'asc' ? ' ▲' : ' ▼'
  }

  return (
    <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold text-[#123A7A]">Managed Equipment</h2>
          <p className="mt-1 text-sm text-slate-600">
            View inspection-ready assets and reporting status at any time.
          </p>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Last updated {lastUpdatedLabel}
          </p>
        </div>

        <div className="w-full lg:ml-auto lg:max-w-4xl">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={onRefreshEquipment}
              disabled={refreshingEquipment}
              className="rounded-md border border-[#123A7A] bg-white px-3 py-2 text-sm font-semibold text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white disabled:cursor-not-allowed disabled:opacity-70"
            >
              {refreshingEquipment ? 'Refreshing Equipment...' : 'Refresh Equipment'}
            </button>
            <button
              type="button"
              onClick={onExportEquipment}
              className="rounded-md border border-[#123A7A] bg-white px-3 py-2 text-sm font-semibold text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
            >
              Export Equipment CSV
            </button>
            {canBulkDecommission && (
              <>
                <button
                  type="button"
                  onClick={onToggleSelectAllEquipment}
                  disabled={activeEquipment.length === 0 || bulkDecommissioning}
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-[#123A7A] hover:text-[#123A7A] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {allSelected ? 'Clear Selection' : 'Select All'}
                </button>
                <button
                  type="button"
                  onClick={onBulkDecommissionEquipment}
                  disabled={selectedCount === 0 || bulkDecommissioning}
                  className="rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {bulkDecommissioning ? 'Decommissioning...' : `Decommission Selected (${selectedCount})`}
                </button>
              </>
            )}
          </div>

          <form
            className="mt-2 flex w-full gap-2 sm:mt-3"
            onSubmit={(event) => {
              event.preventDefault()
              onSearchSubmit()
            }}
          >
            <input
              type="search"
              value={searchInput}
              onChange={(event) => onSearchInputChange(event.target.value)}
              placeholder="Search by name, asset tag, serial"
              className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-[#123A7A]"
            />
            <button
              type="submit"
              className="shrink-0 rounded-md bg-[#123A7A] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f3168]"
            >
              Search
            </button>
          </form>
        </div>
      </div>

      {canEditReports && (
        <div className="mt-4">
          <button
            type="button"
            onClick={onOpenCreateEquipment}
            className="rounded-md border border-[#123A7A] bg-white px-3 py-2 text-sm font-semibold text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
          >
            + Add Equipment
          </button>
        </div>
      )}

      {equipmentCreateError && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {equipmentCreateError}
        </div>
      )}
      {loading ? (
        <EquipmentTableSkeleton />
      ) : equipment.length === 0 ? (
        <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          No equipment found for this company.
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-xl border border-slate-200">
          <div className="flex flex-wrap items-end gap-1 border-b border-slate-300 bg-slate-50 px-3 pt-2">
            <button
              onClick={() => onSetEquipmentTableTab('active')}
              className={`-mb-px rounded-t-lg border px-3 py-2.5 text-xs font-semibold transition sm:px-4 sm:text-sm ${
                equipmentTableTab === 'active'
                  ? 'border-slate-300 border-b-white bg-white text-[#123A7A] shadow-sm'
                  : 'border-transparent bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-800'
              }`}
            >
              Active Equipment ({activeEquipment.length})
            </button>
            <button
              onClick={() => onSetEquipmentTableTab('decommissioned')}
              className={`-mb-px rounded-t-lg border px-3 py-2.5 text-xs font-semibold transition sm:px-4 sm:text-sm ${
                equipmentTableTab === 'decommissioned'
                  ? 'border-slate-300 border-b-white bg-white text-[#123A7A] shadow-sm'
                  : 'border-transparent bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-800'
              }`}
            >
              Decommissioned Equipment ({decommissionedEquipment.length})
            </button>
            <div className="w-full pb-2 sm:ml-auto sm:w-auto">
              <label className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600 sm:justify-end">
                Urgency
                <select
                  value={inspectionUrgencyFilter}
                  onChange={(event) => onInspectionUrgencyFilterChange(event.target.value)}
                  className="min-w-[140px] rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                >
                  <option value="all">All</option>
                  <option value="overdue">Overdue</option>
                  <option value="due_soon">Due Soon</option>
                  <option value="on_schedule">On Schedule</option>
                </select>
              </label>
              {equipmentTableTab === 'active' && (
                <label className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600 sm:justify-end">
                  Status
                  <select
                    value={equipmentStatusFilter}
                    onChange={(event) => onEquipmentStatusFilterChange(event.target.value)}
                    className="min-w-[180px] rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                  >
                    <option value="all">All</option>
                    <option value="good_order">Good Order</option>
                    <option value="worn_serviceable">Worn</option>
                    <option value="attention_required">Attention Required</option>
                    <option value="not_presented">Not Presented</option>
                    <option value="no_approved_report">No Approved Report</option>
                  </select>
                </label>
              )}
            </div>
          </div>

          {isMobileViewport && (
            <div className="space-y-3 p-3">
              {visibleEquipment.map((item) => {
                const inspectionStatus = getInspectionStatusBadge(item.next_inspection_due)
                const managedStatusBadge = getManagedEquipmentInspectionBadge(item)
                const isExpandedEquipmentCard = String(expandedEquipmentCardId) === String(item.id)
                const isInlineSelectedEquipment =
                  equipmentTableTab === 'active' &&
                  activeSelectedEquipment &&
                  String(activeSelectedEquipment.id) === String(item.id)
                return (
                  <article id={`equipment-card-${item.id}`} key={item.id} className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        {canBulkDecommission && (
                          <label className="mb-2 inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                            <input
                              type="checkbox"
                              checked={selectedEquipmentIds.includes(String(item.id))}
                              onChange={() => onToggleEquipmentSelection(item.id)}
                              className="h-4 w-4 rounded border-slate-300 text-[#123A7A] focus:ring-[#123A7A]"
                            />
                            Select
                          </label>
                        )}
                        <h3 className="text-sm font-bold text-slate-800">{item.name}</h3>
                      </div>
                        <span className={`inline-flex max-w-full items-center justify-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${managedStatusBadge.color}`}>
                          {managedStatusBadge.label}
                      </span>
                    </div>
                    <div className="mt-2 grid gap-1 text-xs text-slate-600">
                      <p><span className="font-semibold text-slate-700">Asset Tag:</span> {item.asset_tag || '-'}</p>
                      <p><span className="font-semibold text-slate-700">Safe Working Load:</span> {item.safe_working_load || '-'}</p>
                      {equipmentTableTab === 'active' && (
                        <>
                          <p>
                            <span className="font-semibold text-slate-700">Inspection:</span>{' '}
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${inspectionStatus.color}`}>
                              {inspectionStatus.label}
                            </span>
                          </p>
                          <p><span className="font-semibold text-slate-700">Next Due:</span> {formatDateDDMMYYYY(item.next_inspection_due)}</p>
                        </>
                      )}
                      {equipmentTableTab === 'decommissioned' && !isExpandedEquipmentCard && (
                        <p><span className="font-semibold text-slate-700">Decommissioned:</span> {item.decommissioned_at || '-'}</p>
                      )}
                      <div
                        className={`overflow-hidden transition-all duration-300 ease-out ${
                          isExpandedEquipmentCard ? 'max-h-32 opacity-100' : 'max-h-0 opacity-0'
                        }`}
                        aria-hidden={!isExpandedEquipmentCard}
                      >
                        <div className="grid gap-1 pt-1">
                          <p><span className="font-semibold text-slate-700">Serial:</span> {item.serial_number || '-'}</p>
                          {equipmentTableTab === 'active' && (
                            <p><span className="font-semibold text-slate-700">Location:</span> {item.location || '-'}</p>
                          )}
                          {equipmentTableTab === 'decommissioned' && (
                            <p><span className="font-semibold text-slate-700">Decommissioned:</span> {item.decommissioned_at || '-'}</p>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => onToggleExpandedEquipmentCard(item.id)}
                        className="inline-flex items-center gap-1 rounded border border-slate-300 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700 transition hover:border-slate-400"
                      >
                        <span
                          className={`transition-transform duration-300 ease-out ${
                            isExpandedEquipmentCard ? 'rotate-180' : 'rotate-0'
                          }`}
                          aria-hidden="true"
                        >
                          ▾
                        </span>
                        {isExpandedEquipmentCard ? 'Less details' : 'More details'}
                      </button>
                      <div className="flex gap-2">
                        {equipmentTableTab === 'decommissioned' && isOwner && (
                          <button
                            type="button"
                            onClick={() => onSetEquipmentActive(item.id)}
                            disabled={updatingEquipmentStatus}
                            className="rounded border border-emerald-600 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-700 transition hover:bg-emerald-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Set Active
                          </button>
                        )}
                        {equipmentTableTab === 'active' && (
                          <button
                            type="button"
                            onClick={() => {
                              if (isInlineSelectedEquipment) {
                                onCloseEquipmentDetails()
                                return
                              }
                              onSelectEquipmentForView(item)
                            }}
                            className="rounded border border-[#123A7A] px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
                          >
                            {isInlineSelectedEquipment ? 'Hide' : 'View'}
                          </button>
                        )}
                      </div>
                    </div>

                    {isInlineSelectedEquipment && (
                      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-bold text-[#123A7A]">Equipment Details</p>
                          <button
                            type="button"
                            onClick={onCloseEquipmentDetails}
                            className="rounded border border-slate-300 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-700"
                          >
                            Close
                          </button>
                        </div>

                        <div className="mt-2 grid gap-1 text-xs text-slate-700">
                          {canEditReports && (
                            <div>
                              <p><span className="font-semibold">Status:</span></p>
                              <div className="mt-1 flex flex-wrap items-center gap-2">
                                <select
                                  value={equipmentStatusDraft}
                                  onChange={(event) => onEquipmentStatusDraftChange(event.target.value)}
                                  disabled={updatingEquipmentStatus}
                                  className="rounded-md border border-slate-300 px-2 py-1 text-[11px]"
                                >
                                  <option value="active">Active</option>
                                  <option value="decommissioned">Decommissioned</option>
                                </select>
                                <button
                                  type="button"
                                  onClick={onSubmitEquipmentStatusUpdate}
                                  disabled={
                                    updatingEquipmentStatus ||
                                    equipmentStatusDraft === (activeSelectedEquipment.status || 'active')
                                  }
                                  className="rounded border border-[#123A7A] bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Update Status
                                </button>
                                {updatingEquipmentStatus && <span className="text-[11px] text-slate-500">Updating...</span>}
                              </div>
                            </div>
                          )}
                          <p><span className="font-semibold">Asset Tag:</span> {activeSelectedEquipment.asset_tag || '-'}</p>
                          <p><span className="font-semibold">Serial:</span> {activeSelectedEquipment.serial_number || '-'}</p>
                          <p><span className="font-semibold">Safe Working Load:</span> {activeSelectedEquipment.safe_working_load || '-'}</p>
                          <p><span className="font-semibold">Location:</span> {activeSelectedEquipment.location || '-'}</p>
                          <p><span className="font-semibold">Interval:</span> {activeSelectedEquipment.inspection_interval_days || '-'} days</p>
                          <p><span className="font-semibold">Last Inspected:</span> {activeSelectedEquipment.last_inspected_at || '-'}</p>
                          <p><span className="font-semibold">Next Due:</span> {formatDateDDMMYYYY(activeSelectedEquipment.next_inspection_due)}</p>
                        </div>

                        <div className="mt-3">
                          <button
                            type="button"
                            onClick={onOpenEquipmentQr}
                            className="rounded-md border border-[#123A7A] bg-white px-3 py-2 text-xs font-semibold text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
                          >
                            Show Equipment QR
                          </button>
                        </div>

                        {equipmentStatusError && (
                          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                            {equipmentStatusError}
                          </div>
                        )}

                        {reportError && (
                          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                            {reportError}
                          </div>
                        )}

                        {certificateError && (
                          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                            {certificateError}
                          </div>
                        )}

                        {canViewEquipmentActivity && equipmentActivityError && (
                          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                            {equipmentActivityError}
                          </div>
                        )}

                        {canEditReports && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={onOpenCreateReport}
                              className="rounded-md border border-[#123A7A] bg-white px-3 py-2 text-xs font-semibold text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
                            >
                              Create New Report
                            </button>
                          </div>
                        )}

                        {canViewEquipmentActivity && (
                          <details className="mt-3 rounded border border-slate-200 bg-white">
                            <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700">
                              Equipment Activity
                            </summary>
                            <div className="space-y-2 border-t border-slate-200 p-3">
                              {equipmentActivityLoading ? (
                                <InlineListSkeleton />
                              ) : equipmentActivity.length === 0 ? (
                                <p className="text-xs text-slate-500">No activity has been recorded for this equipment yet.</p>
                              ) : (
                                equipmentActivity.map((entry) => {
                                  const activityLabel = getActivityActionLabel(entry.action)
                                  const activityBadge = getActivityActionBadge(entry.action)
                                  const recoveryState = getActivityRecoveryState(entry, nowMs, recoveredAtMsByRecoverableTarget)
                                  const isRecovering = recoveryState.targetType === 'certificate'
                                    ? recoveringCertificateId === recoveryState.targetId
                                    : recoveryState.targetType === 'report'
                                      ? recoveringReportId === recoveryState.targetId
                                      : false

                                  return (
                                    <article key={entry.id} className="rounded border border-slate-200 bg-white p-2.5">
                                      <div className="flex items-start justify-between gap-2">
                                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${activityBadge.color}`}>
                                          {activityLabel}
                                        </span>
                                        <span className="text-[11px] font-semibold text-slate-700">{entry.actor_name || 'System'}</span>
                                      </div>
                                      <p className="mt-1 text-[11px] text-slate-600">{formatActivityTimestamp(entry.created_at)}</p>
                                      <p className="mt-1 text-[11px] leading-relaxed text-slate-600">{formatActivityDetails(entry.details)}</p>

                                      {recoveryState.targetId && (
                                        <div className="mt-2 flex items-center justify-between gap-2">
                                          <span className="text-[11px] text-slate-600">{recoveryState.label}</span>
                                          {isOwner && recoveryState.canRecover && (
                                            <button
                                              type="button"
                                              onClick={() => onRecoverActivityFromEntry(entry)}
                                              disabled={isRecovering || deletingCertificateId > 0 || deletingDraftReport}
                                              className="rounded border border-emerald-600 px-2 py-1 text-[10px] font-semibold text-emerald-700 transition hover:bg-emerald-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                              {isRecovering
                                                ? 'Recovering...'
                                                : recoveryState.targetType === 'report'
                                                  ? 'Recover Report'
                                                  : 'Recover'}
                                            </button>
                                          )}
                                          {recoveryState.status === 'recovered' && (
                                            <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">
                                              Recovered
                                            </span>
                                          )}
                                        </div>
                                      )}
                                    </article>
                                  )
                                })
                              )}
                            </div>
                          </details>
                        )}

                        <details className="mt-3 rounded border border-slate-200 bg-white" open>
                          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700">
                            Reports
                          </summary>
                          <div className="space-y-2 border-t border-slate-200 p-3">
                            {reportsLoading ? (
                              <InlineListSkeleton />
                            ) : reports.length === 0 ? (
                              <p className="text-xs text-slate-500">No reports have been submitted for this equipment.</p>
                            ) : (
                              (() => {
                                const latestReport = getMostRecentReport(reports)
                                const latestStatusBadge = getReportStatusBadge(latestReport?.status)

                                return (
                                  <>
                                    {latestReport && (
                                      <article className="rounded border border-slate-200 bg-slate-50 p-2.5">
                                        <div className="flex items-start justify-between gap-2">
                                          <p className="text-xs font-semibold text-slate-800">{latestReport.title || 'Untitled report'}</p>
                                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${latestStatusBadge.color}`}>
                                            {latestStatusBadge.label}
                                          </span>
                                        </div>
                                        <p className="mt-1 text-[11px] text-slate-600">
                                          <span className="font-semibold text-slate-700">Most Recent:</span> {latestReport.report_date || '-'}
                                        </p>
                                        <p className="mt-1 text-[11px] text-slate-600">
                                          <span className="font-semibold text-slate-700">Summary:</span> {latestReport.summary || '-'}
                                        </p>
                                        {Array.isArray(latestReport.images) && latestReport.images.length > 0 && (
                                          <div className="mt-2">
                                            <p className="text-[11px] font-semibold text-slate-700">Images</p>
                                            <div className="mt-1 flex flex-wrap gap-2">
                                              {latestReport.images.map((image) => (
                                                <a
                                                  key={`latest-inline-image-${image.id}`}
                                                  href={image.image_url}
                                                  target="_blank"
                                                  rel="noreferrer"
                                                  className="overflow-hidden rounded border border-slate-200 bg-white"
                                                >
                                                  <img
                                                    src={image.image_url}
                                                    alt="Report attachment"
                                                    className="h-12 w-12 object-cover"
                                                    loading="lazy"
                                                  />
                                                </a>
                                              ))}
                                            </div>
                                          </div>
                                        )}
                                        <div className="mt-2 flex justify-end">
                                          <button
                                            type="button"
                                            onClick={() => onViewReport(latestReport)}
                                            className="rounded border border-[#123A7A] px-2 py-1 text-[10px] font-semibold text-[#123A7A]"
                                          >
                                            View
                                          </button>
                                        </div>
                                      </article>
                                    )}

                                    <details className="rounded border border-slate-200 bg-white">
                                      <summary className="flex cursor-pointer justify-end px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-[#123A7A]">
                                        View history
                                      </summary>
                                      <div className="space-y-2 border-t border-slate-200 p-2.5">
                                        {reports.map((report) => {
                                          const statusBadge = getReportStatusBadge(report.status)
                                          return (
                                            <article key={report.id} className="rounded border border-slate-200 bg-white p-2.5">
                                              <div className="flex items-start justify-between gap-2">
                                                <p className="text-xs font-semibold text-slate-800">{report.title || 'Untitled report'}</p>
                                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusBadge.color}`}>
                                                  {statusBadge.label}
                                                </span>
                                              </div>
                                              <p className="mt-1 text-[11px] text-slate-600">
                                                <span className="font-semibold text-slate-700">Date:</span> {report.report_date || '-'}
                                              </p>
                                              <div className="mt-2 flex justify-end">
                                                <button
                                                  type="button"
                                                  onClick={() => onViewReport(report)}
                                                  className="rounded border border-[#123A7A] px-2 py-1 text-[10px] font-semibold text-[#123A7A]"
                                                >
                                                  View
                                                </button>
                                              </div>
                                            </article>
                                          )
                                        })}
                                      </div>
                                    </details>
                                  </>
                                )
                              })()
                            )}
                          </div>
                        </details>
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          )}

          {!isMobileViewport && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] border-collapse text-left text-sm">
                <thead className="bg-[#123A7A] text-white">
                  <tr>
                      {canBulkDecommission && <th className="px-4 py-3 font-semibold">Select</th>}
                    <th className="px-4 py-3 font-semibold">
                      <button
                        type="button"
                        onClick={() => onToggleEquipmentSort('name')}
                        className="font-semibold"
                      >
                        Name{getSortIndicator('name')}
                      </button>
                    </th>
                    <th className="px-4 py-3 font-semibold">
                      <button
                        type="button"
                        onClick={() => onToggleEquipmentSort('asset_tag')}
                        className="font-semibold"
                      >
                        Asset Tag{getSortIndicator('asset_tag')}
                      </button>
                    </th>
                    <th className="px-4 py-3 font-semibold">Serial</th>
                    <th className="px-4 py-3 font-semibold">SWL</th>
                    {equipmentTableTab === 'active' && <th className="px-4 py-3 font-semibold">Location</th>}
                    <th className="px-4 py-3 font-semibold whitespace-nowrap">Status</th>
                    {equipmentTableTab === 'active' && (
                      <>
                        <th className="px-4 py-3 font-semibold whitespace-nowrap">Inspection Status</th>
                        <th className="px-4 py-3 font-semibold">
                          <button
                            type="button"
                            onClick={() => onToggleEquipmentSort('next_due')}
                            className="font-semibold"
                          >
                            Next Due{getSortIndicator('next_due')}
                          </button>
                        </th>
                      </>
                    )}
                    {equipmentTableTab === 'decommissioned' && (
                      <th className="px-4 py-3 font-semibold">Decommissioned Date</th>
                    )}
                    {equipmentTableTab === 'active' && <th className="px-4 py-3 font-semibold">Reports</th>}
                    {equipmentTableTab === 'decommissioned' && isOwner && <th className="px-4 py-3 font-semibold">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {visibleEquipment.map((item) => {
                    const inspectionStatus = getInspectionStatusBadge(item.next_inspection_due)
                    const managedStatusBadge = getManagedEquipmentInspectionBadge(item)
                    return (
                      <tr key={item.id} className="border-t border-slate-200 odd:bg-white even:bg-slate-50/60">
                        {canBulkDecommission && (
                          <td className="px-4 py-3 text-slate-700">
                            <input
                              type="checkbox"
                              checked={selectedEquipmentIds.includes(String(item.id))}
                              onChange={() => onToggleEquipmentSelection(item.id)}
                              className="h-4 w-4 rounded border-slate-300 text-[#123A7A] focus:ring-[#123A7A]"
                            />
                          </td>
                        )}
                        <td className="px-4 py-3 font-semibold text-slate-800">{item.name}</td>
                        <td className="px-4 py-3 text-slate-700">{item.asset_tag || '-'}</td>
                        <td className="px-4 py-3 text-slate-700">{item.serial_number || '-'}</td>
                        <td className="px-4 py-3 text-slate-700">{item.safe_working_load || '-'}</td>
                        {equipmentTableTab === 'active' && <td className="px-4 py-3 text-slate-700">{item.location || '-'}</td>}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`inline-flex max-w-full items-center justify-center whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${managedStatusBadge.color}`}>
                            {managedStatusBadge.label}
                          </span>
                        </td>
                        {equipmentTableTab === 'active' && (
                          <>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className={`inline-flex max-w-full items-center justify-center whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${inspectionStatus.color}`}>
                                {inspectionStatus.label}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-slate-700">{formatDateDDMMYYYY(item.next_inspection_due)}</td>
                          </>
                        )}
                        {equipmentTableTab === 'decommissioned' && (
                          <td className="px-4 py-3 text-slate-700">{item.decommissioned_at || '-'}</td>
                        )}
                        {equipmentTableTab === 'decommissioned' && isOwner && (
                          <td className="px-4 py-3 text-slate-700">
                            <button
                              type="button"
                              onClick={() => onSetEquipmentActive(item.id)}
                              disabled={updatingEquipmentStatus}
                              className="rounded border border-emerald-600 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-700 transition hover:bg-emerald-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Set Active
                            </button>
                          </td>
                        )}
                        {equipmentTableTab === 'active' && (
                          <td className="px-4 py-3 text-slate-700">
                            <button
                              type="button"
                              onClick={() => onSelectEquipmentForView(item)}
                              className="rounded border border-[#123A7A] px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
                            >
                              View
                            </button>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {currentTableEquipment.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <p>
                Showing {equipmentRangeStart}-{equipmentRangeEnd} of {currentTableEquipment.length} equipment items.
              </p>
              <PaginationControls
                page={equipmentPage}
                totalPages={equipmentTotalPages}
                onPrevious={onEquipmentPagePrevious}
                onNext={onEquipmentPageNext}
                buttonClassName="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-semibold text-slate-700 transition hover:border-[#123A7A] hover:text-[#123A7A] disabled:cursor-not-allowed disabled:opacity-50"
                labelClassName="min-w-24 text-center font-semibold text-slate-700"
              />
            </div>
          )}
        </div>
      )}
    </section>
  )
}
