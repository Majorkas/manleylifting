import PaginationControls from './PaginationControls'
import { EmployeeAssignmentsSkeleton } from './PortalLoadingSkeletons'

export default function EmployeeControlsSection({
  sectionRef,
  onAddEmployee,
  employeeSearchInput,
  onEmployeeSearchChange,
  staffAssignmentsError,
  staffAssignmentsSuccess,
  staffAssignmentsLoading,
  employeeControlsTab,
  onSetEmployeeControlsTab,
  activeStaffAssignments,
  inactiveStaffAssignments,
  staffAssignments,
  filteredStaffAssignments,
  visibleStaffAssignments,
  companies,
  onEmployeeRoleChange,
  savingStaffUserId,
  removingStaffUserId,
  reactivatingStaffUserId,
  onOpenCompanyPicker,
  confirmRemoveUserId,
  onConfirmRemoveUser,
  onCancelRemoveUser,
  onRemoveEmployeeAssignment,
  onReactivateEmployeeAssignment,
  employeeStartIndex,
  employeePageSize,
  employeePage,
  employeeTotalPages,
  onEmployeePagePrevious,
  onEmployeePageNext,
}) {
  return (
    <section ref={sectionRef} className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold text-[#123A7A]">Employee Controls</h2>
          <p className="mt-1 text-sm text-slate-600">
            Manage employee portal accounts and company access permissions.
          </p>
        </div>
        <button
          type="button"
          onClick={onAddEmployee}
          className="rounded-md border border-[#123A7A] bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
        >
          Add Employee
        </button>
      </div>

      <div className="mt-4 w-full max-w-md">
        <input
          type="search"
          value={employeeSearchInput}
          onChange={(event) => onEmployeeSearchChange(event.target.value)}
          placeholder="Search employees by username, email, name"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-[#123A7A]"
        />
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
        <div className="flex items-end gap-1 border-b border-slate-300 bg-slate-50 px-3 pt-2">
          <button
            type="button"
            onClick={() => onSetEmployeeControlsTab('active')}
            className={`-mb-px rounded-t-lg border px-4 py-2.5 text-sm font-semibold transition ${
              employeeControlsTab === 'active'
                ? 'border-slate-300 border-b-white bg-white text-[#123A7A] shadow-sm'
                : 'border-transparent bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-800'
            }`}
          >
            Active Employees ({activeStaffAssignments.length})
          </button>
          <button
            type="button"
            onClick={() => onSetEmployeeControlsTab('inactive')}
            className={`-mb-px rounded-t-lg border px-4 py-2.5 text-sm font-semibold transition ${
              employeeControlsTab === 'inactive'
                ? 'border-slate-300 border-b-white bg-white text-[#123A7A] shadow-sm'
                : 'border-transparent bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-800'
            }`}
          >
            Inactive Employees ({inactiveStaffAssignments.length})
          </button>
        </div>
      </div>

      {staffAssignmentsError && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {staffAssignmentsError}
        </div>
      )}
      {staffAssignmentsSuccess && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {staffAssignmentsSuccess}
        </div>
      )}

      {staffAssignmentsLoading ? (
        <EmployeeAssignmentsSkeleton />
      ) : staffAssignments.length === 0 ? (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          {employeeControlsTab === 'active'
            ? 'No active employee accounts found.'
            : 'No inactive employee accounts found.'}
        </div>
      ) : filteredStaffAssignments.length === 0 ? (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          No employees match your search.
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {visibleStaffAssignments.map((assignment) => {
            if (employeeControlsTab === 'inactive') {
              return (
                <article key={assignment.user_id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h3 className="text-base font-bold text-[#123A7A]">{assignment.full_name || '-'}</h3>
                      <p className="text-sm text-slate-600">{assignment.email || '-'}</p>
                      <p className="text-sm text-slate-600">{assignment.username}</p>
                    </div>

                    <button
                      type="button"
                      onClick={() => onReactivateEmployeeAssignment(assignment)}
                      disabled={reactivatingStaffUserId === Number(assignment.user_id)}
                      className="rounded-md border border-emerald-600 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700 transition hover:bg-emerald-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {reactivatingStaffUserId === Number(assignment.user_id) ? 'Reactivating...' : 'Reactivate'}
                    </button>
                  </div>
                </article>
              )
            }

            const assignedCompanyNames = companies
              .filter((item) => (assignment.allowed_company_ids || []).includes(item.id))
              .map((item) => item.name)
            const previewNames = assignedCompanyNames.slice(0, 2).join(', ')
            const remainingCount = Math.max(assignedCompanyNames.length - 2, 0)

            return (
              <article key={assignment.user_id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h3 className="text-base font-bold text-[#123A7A]">{assignment.username}</h3>
                    <p className="text-sm text-slate-600">{assignment.email || '-'}</p>
                    <p className="text-sm text-slate-600">{assignment.full_name || '-'}</p>
                  </div>
                  <div className="flex flex-col gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    <span>Employee Type</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          void onEmployeeRoleChange(assignment, 'engineer')
                        }}
                        aria-pressed={(assignment.role === 'staff' ? 'engineer' : assignment.role) === 'engineer'}
                        disabled={
                          savingStaffUserId === Number(assignment.user_id) ||
                          removingStaffUserId === Number(assignment.user_id)
                        }
                        className={
                          'rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wide transition ' +
                          ((assignment.role === 'staff' ? 'engineer' : assignment.role) === 'engineer'
                            ? 'border-[#123A7A] bg-white text-[#123A7A] shadow-md ring-2 ring-[#123A7A]/25'
                            : 'border-slate-200 bg-slate-100 text-slate-500 hover:bg-white')
                        }
                      >
                        Engineer
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void onEmployeeRoleChange(assignment, 'office_staff')
                        }}
                        aria-pressed={(assignment.role === 'staff' ? 'engineer' : assignment.role) === 'office_staff'}
                        disabled={
                          savingStaffUserId === Number(assignment.user_id) ||
                          removingStaffUserId === Number(assignment.user_id)
                        }
                        className={
                          'rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wide transition ' +
                          ((assignment.role === 'staff' ? 'engineer' : assignment.role) === 'office_staff'
                            ? 'border-[#0f3168] bg-[#123A7A] text-white shadow-md ring-2 ring-[#123A7A]/35'
                            : 'border-blue-200 bg-blue-50 text-blue-500 hover:bg-blue-100')
                        }
                      >
                        Office
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Allowed Companies</p>
                      <p className="text-sm text-slate-700">
                        {assignedCompanyNames.length === 0
                          ? 'No companies assigned.'
                          : `${previewNames}${remainingCount > 0 ? ` +${remainingCount} more` : ''}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenCompanyPicker(assignment.user_id)}
                      className="rounded-md border border-[#123A7A] bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[#123A7A] transition hover:bg-[#123A7A] hover:text-white"
                    >
                      Edit Companies
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  {confirmRemoveUserId === Number(assignment.user_id) ? (
                    <>
                      <button
                        type="button"
                        onClick={() => onRemoveEmployeeAssignment(assignment)}
                        disabled={removingStaffUserId === Number(assignment.user_id)}
                        className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {removingStaffUserId === Number(assignment.user_id) ? 'Deactivating...' : 'Confirm Deactivate'}
                      </button>
                      <button
                        type="button"
                        onClick={onCancelRemoveUser}
                        disabled={removingStaffUserId === Number(assignment.user_id)}
                        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onConfirmRemoveUser(assignment.user_id)}
                      disabled={removingStaffUserId === Number(assignment.user_id)}
                      className="rounded-md border border-rose-300 bg-rose-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Deactivate Employee
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}

      {!staffAssignmentsLoading && filteredStaffAssignments.length > 0 && (
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-sm text-slate-600">
            Showing {employeeStartIndex + 1}-
            {Math.min(employeeStartIndex + employeePageSize, filteredStaffAssignments.length)} of{' '}
            {filteredStaffAssignments.length} employees.
          </p>
          <PaginationControls
            page={employeePage}
            totalPages={employeeTotalPages}
            onPrevious={onEmployeePagePrevious}
            onNext={onEmployeePageNext}
          />
        </div>
      )}
    </section>
  )
}
