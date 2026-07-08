import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PortalDashboardPage from './PortalDashboardPage'

vi.mock('../components/PortalLayout', () => ({
  default: ({ children }) => <div>{children}</div>,
}))

vi.mock('../utils/portalApi', () => ({
  clearPortalSession: vi.fn(),
  createEquipmentReport: vi.fn(),
  changePortalPassword: vi.fn(),
  deleteReport: vi.fn(),
  deleteStaffAssignment: vi.fn(),
  getAccessToken: vi.fn(),
  getEquipmentActivity: vi.fn(),
  getEquipmentReports: vi.fn(),
  getPortalDashboardStats: vi.fn(),
  getPortalCompanies: vi.fn(),
  getPortalCompanyHeader: vi.fn(),
  getPortalEquipment: vi.fn(),
  getPortalMe: vi.fn(),
  getPendingReportApprovals: vi.fn(),
  reactivateStaffAssignment: vi.fn(),
  getReportRevisions: vi.fn(),
  getStaffAssignments: vi.fn(),
  hasPortalSession: vi.fn(),
  portalLogout: vi.fn(),
  refreshPortalSession: vi.fn(),
  updatePortalCustomer: vi.fn(),
  updatePortalEquipment: vi.fn(),
  updateReport: vi.fn(),
}))

import {
  createEquipmentReport,
  changePortalPassword,
  deleteReport,
  deleteStaffAssignment,
  getAccessToken,
  getEquipmentActivity,
  getEquipmentReports,
  getPortalDashboardStats,
  getPortalCompanies,
  getPortalCompanyHeader,
  getPortalEquipment,
  getPortalMe,
  getPendingReportApprovals,
  getReportRevisions,
  reactivateStaffAssignment,
  getStaffAssignments,
  hasPortalSession,
  refreshPortalSession,
  updatePortalCustomer,
  updatePortalEquipment,
  updateReport,
} from '../utils/portalApi'

function renderDashboardPage(initialEntry = '/portal') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/portal" element={<PortalDashboardPage />} />
        <Route path="/portal/login" element={<div>Login Page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

function buildAccessTokenWithExpiry(expirationSeconds) {
  const toBase64Url = (value) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')

  return `${toBase64Url({ alg: 'HS256', typ: 'JWT' })}.${toBase64Url({ exp: expirationSeconds })}.signature`
}

function mockCustomerData() {
  getPortalMe.mockResolvedValue({
    id: 11,
    username: 'demo_customer',
    email: 'customer@example.com',
    fullName: 'Demo Customer',
    role: 'customer',
    allowedCompanyIds: [1],
  })
  getPortalCompanyHeader.mockResolvedValue({
    id: 1,
    name: 'Acme Lifts',
    contact_email: 'hello@acme.test',
    contact_phone: '555-0100',
    address: 'Dublin',
    logo: '',
  })
  getPortalEquipment.mockResolvedValue([
    {
      id: 101,
      name: 'Warehouse Hoist',
      asset_tag: 'WH-1',
      serial_number: 'SN-101',
      location: 'Bay 1',
      status: 'active',
      next_inspection_due: '2026-09-01',
    },
  ])
}

describe('PortalDashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.scrollTo = vi.fn()
    hasPortalSession.mockReturnValue(true)
    getPortalCompanies.mockResolvedValue([])
    getPortalDashboardStats.mockResolvedValue({ overdue_count: 0, due_soon_count: 0, pending_approvals_count: 0 })
    getEquipmentActivity.mockResolvedValue([])
    getEquipmentReports.mockResolvedValue([])
    getPortalCompanyHeader.mockResolvedValue({})
    getPortalEquipment.mockResolvedValue([])
    getPendingReportApprovals.mockResolvedValue([])
    getReportRevisions.mockResolvedValue([])
    getStaffAssignments.mockResolvedValue([])
    getAccessToken.mockReturnValue('')
    reactivateStaffAssignment.mockResolvedValue({})
    deleteStaffAssignment.mockResolvedValue({ ok: true })
    refreshPortalSession.mockResolvedValue('')
    updatePortalCustomer.mockResolvedValue({ id: 1, name: 'Acme Lifts' })
    updatePortalEquipment.mockResolvedValue({})
    updateReport.mockResolvedValue({})
    deleteReport.mockResolvedValue({ ok: true })
  })

  it('redirects to login when portal session expired event is fired', async () => {
    mockCustomerData()

    renderDashboardPage('/portal')
    expect(await screen.findByText('Acme Lifts')).toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new CustomEvent('portalSessionExpired'))
    })

    expect(await screen.findByText('Login Page')).toBeInTheDocument()
  })

  it('filters visible reports by selected report year', async () => {
    const user = userEvent.setup()

    getPortalMe.mockResolvedValue({
      id: 11,
      username: 'demo_customer',
      email: 'customer@example.com',
      fullName: 'Demo Customer',
      role: 'customer',
      allowedCompanyIds: [1],
    })
    getPortalCompanyHeader.mockResolvedValue({
      id: 1,
      name: 'Acme Lifts',
      contact_email: 'hello@acme.test',
      contact_phone: '555-0100',
      address: 'Dublin',
      logo: '',
    })
    getPortalEquipment.mockResolvedValue([
      {
        id: 101,
        name: 'Warehouse Hoist',
        asset_tag: 'WH-1',
        serial_number: 'SN-101',
        location: 'Bay 1',
        status: 'active',
        next_inspection_due: '2026-09-01',
      },
    ])
    getEquipmentReports.mockResolvedValue([
      {
        id: 1,
        title: 'Inspection 2026',
        report_date: '2026-07-01',
        status: 'approved',
        submitted_by_name: 'Inspector A',
        summary: 'Year 2026',
      },
      {
        id: 2,
        title: 'Inspection 2025',
        report_date: '2025-07-01',
        status: 'approved',
        submitted_by_name: 'Inspector B',
        summary: 'Year 2025',
      },
    ])

    renderDashboardPage('/portal')

    await user.click(await screen.findByRole('button', { name: 'View' }))
    expect(await screen.findByText('Inspection 2026')).toBeInTheDocument()
    expect(screen.getByText('Inspection 2025')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Filter by Year:'), '2025')

    expect(await screen.findByText('Inspection 2025')).toBeInTheDocument()
    expect(screen.queryByText('Inspection 2026')).not.toBeInTheDocument()
  })

  it('uses two-step confirm before removing an employee assignment', async () => {
    const user = userEvent.setup()

    getPortalMe.mockResolvedValue({
      id: 31,
      username: 'demo_owner',
      email: 'owner@example.com',
      fullName: 'Demo Owner',
      role: 'owner',
      allowedCompanyIds: [1],
    })
    getPortalCompanies.mockResolvedValue([
      { id: 1, name: 'Acme Lifts', contact_email: 'hello@acme.test', contact_phone: '555-0100' },
    ])
    getStaffAssignments.mockResolvedValue([
      {
        user_id: 99,
        username: 'ops_staff',
        email: 'ops_staff@example.com',
        full_name: 'Ops Staff',
        role: 'engineer',
        allowed_company_ids: [1],
      },
    ])

    renderDashboardPage('/portal')

    expect(await screen.findByRole('heading', { name: 'Employee Controls' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Deactivate Employee' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Deactivate Employee' }))
    expect(screen.getByRole('button', { name: 'Confirm Deactivate' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Confirm Deactivate' }))

    await waitFor(() => {
      expect(deleteStaffAssignment).toHaveBeenCalledWith(99)
    })
  })

  it('requires a second submit to confirm customer deactivation', async () => {
    const user = userEvent.setup()

    getPortalMe.mockResolvedValue({
      id: 31,
      username: 'demo_owner',
      email: 'owner@example.com',
      fullName: 'Demo Owner',
      role: 'owner',
      allowedCompanyIds: [1],
    })
    getPortalCompanies.mockResolvedValue([
      {
        id: 1,
        name: 'Acme Lifts',
        contact_email: 'hello@acme.test',
        contact_phone: '555-0100',
        address: 'Dublin',
      },
    ])

    renderDashboardPage('/portal')

    expect(await screen.findByRole('heading', { name: 'Customer List' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit Customer' }))
    expect(await screen.findByRole('heading', { name: 'Edit Customer' })).toBeInTheDocument()

    await user.click(screen.getByLabelText('Deactivate customer company (removes it from active portal lists)'))
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    expect(updatePortalCustomer).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Confirm Deactivate Customer' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Confirm Deactivate Customer' }))

    await waitFor(() => {
      expect(updatePortalCustomer).toHaveBeenCalledWith({
        company_id: 1,
        company_name: 'Acme Lifts',
        company_contact_email: 'hello@acme.test',
        company_contact_phone: '555-0100',
        company_address: 'Dublin',
        is_active: false,
      })
    })
  })

  it('requires a second click to confirm removing a report image', async () => {
    const user = userEvent.setup()

    getPortalMe.mockResolvedValue({
      id: 31,
      username: 'demo_owner',
      email: 'owner@example.com',
      fullName: 'Demo Owner',
      role: 'owner',
      allowedCompanyIds: [1],
    })
    getPortalCompanies.mockResolvedValue([
      { id: 1, name: 'Acme Lifts', contact_email: 'hello@acme.test', contact_phone: '555-0100' },
    ])
    getPortalCompanyHeader.mockResolvedValue({
      id: 1,
      name: 'Acme Lifts',
      contact_email: 'hello@acme.test',
      contact_phone: '555-0100',
      address: 'Dublin',
      logo: '',
    })
    getPortalEquipment.mockResolvedValue([
      {
        id: 101,
        name: 'Warehouse Hoist',
        asset_tag: 'WH-1',
        serial_number: 'SN-101',
        location: 'Bay 1',
        status: 'active',
        next_inspection_due: '2026-09-01',
      },
    ])
    getEquipmentReports.mockResolvedValue([
      {
        id: 2,
        title: 'Submitted Hoist Inspection',
        report_date: '2026-07-02',
        status: 'submitted',
        submitted_by: 21,
        submitted_by_name: 'Demo Staff',
        summary: 'Submitted summary',
        findings: 'Findings',
        recommendations: 'Recommendations',
        images: [{ id: 77, image_url: 'https://example.com/report-image.jpg' }],
      },
    ])

    renderDashboardPage('/portal?companyId=1')

    await user.click(await screen.findByRole('button', { name: 'View' }))

    const tables = screen.getAllByRole('table')
    const reportsTable = tables[tables.length - 1]
    await user.click(within(reportsTable).getByRole('button', { name: 'View' }))

    expect(await screen.findByRole('heading', { name: 'Submitted Hoist Inspection' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit Report' }))
    expect(await screen.findByRole('heading', { name: 'Edit Report' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(screen.getByRole('button', { name: 'Confirm Remove' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save Report' }))

    expect(updateReport).toHaveBeenCalledWith('2', expect.objectContaining({ removed_image_ids: [] }))

    updateReport.mockClear()
    await user.click(screen.getByRole('button', { name: 'Edit Report' }))
    expect(await screen.findByRole('heading', { name: 'Edit Report' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await user.click(screen.getByRole('button', { name: 'Confirm Remove' }))
    await user.click(screen.getByRole('button', { name: 'Save Report' }))

    expect(updateReport).toHaveBeenCalledWith('2', expect.objectContaining({ removed_image_ids: [77] }))
  })

  it('redirects signed-out users to the portal login route', () => {
    hasPortalSession.mockReturnValue(false)

    renderDashboardPage()

    expect(screen.getByText('Login Page')).toBeInTheDocument()
  })

  it('shows a pre-expiry warning modal and refreshes the session when requested', async () => {
    const user = userEvent.setup()

    mockCustomerData()

    let accessToken = buildAccessTokenWithExpiry(Math.floor((Date.now() + 90 * 1000) / 1000))
    getAccessToken.mockImplementation(() => accessToken)
    refreshPortalSession.mockImplementation(async () => {
      accessToken = buildAccessTokenWithExpiry(Math.floor((Date.now() + 30 * 60 * 1000) / 1000))
      return accessToken
    })

    renderDashboardPage('/portal')

    expect(await screen.findByText('Acme Lifts')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Session Expiring Soon' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Stay Logged In' }))

    await waitFor(() => {
      expect(refreshPortalSession).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Session Expiring Soon' })).not.toBeInTheDocument()
    })
  })

  it('shows an auto-dismissing toast after a password update', async () => {
    const user = userEvent.setup()

    mockCustomerData()
    changePortalPassword.mockResolvedValue({})

    renderDashboardPage('/portal')

    expect(await screen.findByText('Acme Lifts')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Change Password' }))
    await user.type(screen.getByLabelText('Current Password'), 'old-password')
    await user.type(screen.getByLabelText('New Password'), 'new-password-123')
    await user.type(screen.getByLabelText('Confirm New Password'), 'new-password-123')
    await user.click(screen.getByRole('button', { name: 'Update Password' }))

    expect(await screen.findByText('Password updated successfully.')).toBeInTheDocument()

    await waitFor(
      () => {
        expect(screen.queryByText('Password updated successfully.')).not.toBeInTheDocument()
      },
      { timeout: 6000 },
    )
  }, 10000)

  it('lets owners jump from a report modal to the matching equipment', async () => {
    const user = userEvent.setup()
    mockCustomerData()
    getEquipmentReports.mockResolvedValue([
      {
        id: 55,
        equipment_id: 101,
        equipment_name: 'Hoist A',
        title: 'Inspection 55',
        report_date: '2027-06-30',
        status: 'submitted',
        summary: 'Summary',
        findings: 'Findings',
        recommendations: 'Recommendations',
        submitted_by_name: 'Inspector',
        images: [],
      },
    ])

    renderDashboardPage('/portal')

    expect(await screen.findByRole('heading', { name: 'Managed Equipment' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'View' }))
    const equipmentDetailsHeading = await screen.findByRole('heading', {
      name: 'Equipment Details: Warehouse Hoist',
    })
    const equipmentDetailsSection = equipmentDetailsHeading.closest('section')
    expect(equipmentDetailsSection).not.toBeNull()

    expect(equipmentDetailsSection).toHaveTextContent('Inspection 55')
    await user.click(within(equipmentDetailsSection).getByRole('button', { name: 'View' }))

    expect(await screen.findByRole('button', { name: 'Go to equipment' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Go to equipment' }))

    expect(screen.getByRole('heading', { name: 'Equipment Details: Warehouse Hoist' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Go to equipment' })).not.toBeInTheDocument()
  })

  it('shows the customer picker for staff users before a company is selected', async () => {
    getPortalMe.mockResolvedValue({
      id: 21,
      username: 'demo_staff',
      email: 'staff@example.com',
      fullName: 'Demo Staff',
      role: 'staff',
      allowedCompanyIds: [1],
    })
    getPortalCompanies.mockResolvedValue([
      { id: 1, name: 'Acme Lifts', contact_email: 'hello@acme.test', contact_phone: '555-0100' },
    ])

    renderDashboardPage()

    expect(await screen.findByRole('heading', { name: 'Customer List' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Customer Profile' })).toBeInTheDocument()
    expect(screen.queryByText('Equipment & Certification Hub')).not.toBeInTheDocument()
  })

  it('refreshes the customer list from the customer picker header', async () => {
    const user = userEvent.setup()

    getPortalMe.mockResolvedValue({
      id: 21,
      username: 'demo_staff',
      email: 'staff@example.com',
      fullName: 'Demo Staff',
      role: 'staff',
      allowedCompanyIds: [1],
    })
    getPortalCompanies.mockResolvedValue([
      { id: 1, name: 'Acme Lifts', contact_email: 'hello@acme.test', contact_phone: '555-0100' },
    ])

    renderDashboardPage('/portal')

    expect(await screen.findByRole('heading', { name: 'Customer List' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Refresh Customers' }))

    expect(getPortalCompanies).toHaveBeenCalledTimes(2)
  })

  it('shows company details and equipment directly for customer users', async () => {
    mockCustomerData()

    renderDashboardPage()

    expect(await screen.findByText('Acme Lifts')).toBeInTheDocument()
    expect(screen.getByText('Equipment & Certification Hub')).toBeInTheDocument()
    expect(screen.getByText('Warehouse Hoist')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Customer List' })).not.toBeInTheDocument()
  })

  it('refreshes the equipment table from the equipment section header', async () => {
    const user = userEvent.setup()

    mockCustomerData()

    renderDashboardPage()

    expect(await screen.findByText('Acme Lifts')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Refresh Equipment' }))

    expect(getPortalEquipment).toHaveBeenCalledTimes(2)
  })

  it('sorts equipment by the nearest due date and paginates the table', async () => {
    const user = userEvent.setup()

    getPortalMe.mockResolvedValue({
      id: 11,
      username: 'demo_customer',
      email: 'customer@example.com',
      fullName: 'Demo Customer',
      role: 'customer',
      allowedCompanyIds: [1],
    })
    getPortalCompanyHeader.mockResolvedValue({
      id: 1,
      name: 'Acme Lifts',
      contact_email: 'hello@acme.test',
      contact_phone: '555-0100',
      address: 'Dublin',
      logo: '',
    })
    getPortalEquipment.mockResolvedValue(
      Array.from({ length: 11 }, (_, index) => ({
        id: index + 1,
        name: `Equipment ${String(index + 1).padStart(2, '0')}`,
        asset_tag: `EQ-${String(index + 1).padStart(2, '0')}`,
        serial_number: `SN-${String(index + 1).padStart(2, '0')}`,
        location: 'Bay 1',
        status: 'active',
        next_inspection_due: `2026-01-${String(11 - index).padStart(2, '0')}`,
      })),
    )

    renderDashboardPage()

    expect(await screen.findByText('Equipment 11')).toBeInTheDocument()
    expect(screen.getByText('Equipment 02')).toBeInTheDocument()
    expect(screen.queryByText('Equipment 01')).not.toBeInTheDocument()
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText('Equipment 01')).toBeInTheDocument()
    expect(screen.queryByText('Equipment 11')).not.toBeInTheDocument()
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
  })

  it('hydrates company selection and equipment filters from URL params', async () => {
    getPortalMe.mockResolvedValue({
      id: 11,
      username: 'demo_customer',
      email: 'customer@example.com',
      fullName: 'Demo Customer',
      role: 'customer',
      allowedCompanyIds: [1],
    })
    getPortalCompanyHeader.mockResolvedValue({
      id: 1,
      name: 'Acme Lifts',
      contact_email: 'hello@acme.test',
      contact_phone: '555-0100',
      address: 'Dublin',
      logo: '',
    })
    getPortalEquipment.mockResolvedValue([
      {
        id: 1,
        name: 'Active Lift',
        asset_tag: 'AC-001',
        serial_number: 'SN-ACTIVE',
        location: 'Bay 1',
        status: 'active',
        next_inspection_due: '2026-10-01',
      },
      ...Array.from({ length: 11 }, (_, index) => ({
        id: index + 100,
        name: `Decom ${String(index + 1).padStart(2, '0')}`,
        asset_tag: `DC-${String(index + 1).padStart(2, '0')}`,
        serial_number: `SN-DC-${String(index + 1).padStart(2, '0')}`,
        location: 'Retired Yard',
        status: 'decommissioned',
        next_inspection_due: '2026-10-01',
      })),
    ])

    renderDashboardPage('/portal?companyId=1&q=Decom&eqTab=decommissioned&eqPage=2')

    expect(await screen.findByText('Acme Lifts')).toBeInTheDocument()
    expect(getPortalEquipment).toHaveBeenCalledWith({ companyId: 1, search: 'Decom' })
    expect(screen.getByRole('searchbox')).toHaveValue('Decom')
    expect(screen.getByText('Decommissioned Equipment (11)')).toBeInTheDocument()
  })

  it('supports sorting equipment by table columns', async () => {
    const user = userEvent.setup()

    getPortalMe.mockResolvedValue({
      id: 11,
      username: 'demo_customer',
      email: 'customer@example.com',
      fullName: 'Demo Customer',
      role: 'customer',
      allowedCompanyIds: [1],
    })
    getPortalCompanyHeader.mockResolvedValue({
      id: 1,
      name: 'Acme Lifts',
      contact_email: 'hello@acme.test',
      contact_phone: '555-0100',
      address: 'Dublin',
      logo: '',
    })
    getPortalEquipment.mockResolvedValue([
      {
        id: 1,
        name: 'Zeta Lift',
        asset_tag: 'ZZ-100',
        serial_number: 'SN-1',
        location: 'Bay 1',
        status: 'active',
        next_inspection_due: '2026-01-01',
      },
      {
        id: 2,
        name: 'Alpha Lift',
        asset_tag: 'AA-200',
        serial_number: 'SN-2',
        location: 'Bay 2',
        status: 'active',
        next_inspection_due: '2026-01-03',
      },
      {
        id: 3,
        name: 'Beta Lift',
        asset_tag: 'BB-300',
        serial_number: 'SN-3',
        location: 'Bay 3',
        status: 'active',
        next_inspection_due: '2026-01-02',
      },
    ])

    renderDashboardPage('/portal')

    expect(await screen.findByText('Zeta Lift')).toBeInTheDocument()
    const equipmentTable = await screen.findByRole('table')
    const equipmentRows = within(equipmentTable).getAllByRole('row').slice(1)
    expect(within(equipmentRows[0]).getByText('Zeta Lift')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Name/ }))

    const rowsAfterNameSort = within(equipmentTable).getAllByRole('row').slice(1)
    expect(within(rowsAfterNameSort[0]).getByText('Alpha Lift')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Asset Tag/ }))
    await user.click(screen.getByRole('button', { name: /Asset Tag/ }))

    const rowsAfterAssetSortDesc = within(equipmentTable).getAllByRole('row').slice(1)
    expect(within(rowsAfterAssetSortDesc[0]).getByText('Zeta Lift')).toBeInTheDocument()
  })

  it('filters equipment by inspection urgency', async () => {
    const user = userEvent.setup()

    const today = new Date()
    const pastDate = new Date(today)
    pastDate.setDate(today.getDate() - 3)
    const dueSoonDate = new Date(today)
    dueSoonDate.setDate(today.getDate() + 7)
    const onScheduleDate = new Date(today)
    onScheduleDate.setDate(today.getDate() + 45)

    getPortalMe.mockResolvedValue({
      id: 11,
      username: 'demo_customer',
      email: 'customer@example.com',
      fullName: 'Demo Customer',
      role: 'customer',
      allowedCompanyIds: [1],
    })
    getPortalCompanyHeader.mockResolvedValue({
      id: 1,
      name: 'Acme Lifts',
      contact_email: 'hello@acme.test',
      contact_phone: '555-0100',
      address: 'Dublin',
      logo: '',
    })
    getPortalEquipment.mockResolvedValue([
      {
        id: 1,
        name: 'Overdue Lift',
        asset_tag: 'OD-100',
        serial_number: 'SN-1',
        location: 'Bay 1',
        status: 'active',
        next_inspection_due: pastDate.toISOString().slice(0, 10),
      },
      {
        id: 2,
        name: 'Due Soon Lift',
        asset_tag: 'DS-200',
        serial_number: 'SN-2',
        location: 'Bay 2',
        status: 'active',
        next_inspection_due: dueSoonDate.toISOString().slice(0, 10),
      },
      {
        id: 3,
        name: 'On Schedule Lift',
        asset_tag: 'OS-300',
        serial_number: 'SN-3',
        location: 'Bay 3',
        status: 'active',
        next_inspection_due: onScheduleDate.toISOString().slice(0, 10),
      },
    ])

    renderDashboardPage('/portal')

    expect(await screen.findByText('Overdue Lift')).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Urgency' }), 'overdue')

    expect(await screen.findByText('Overdue Lift')).toBeInTheDocument()
    expect(screen.queryByText('Due Soon Lift')).not.toBeInTheDocument()
    expect(screen.queryByText('On Schedule Lift')).not.toBeInTheDocument()
  })

  it('warns before closing a dirty report form modal', async () => {
    const user = userEvent.setup()

    getPortalMe.mockResolvedValue({
      id: 21,
      username: 'demo_staff',
      email: 'staff@example.com',
      fullName: 'Demo Staff',
      role: 'staff',
      allowedCompanyIds: [1],
    })
    getPortalCompanies.mockResolvedValue([
      { id: 1, name: 'Acme Lifts', contact_email: 'hello@acme.test', contact_phone: '555-0100' },
    ])
    getPortalCompanyHeader.mockResolvedValue({
      id: 1,
      name: 'Acme Lifts',
      contact_email: 'hello@acme.test',
      contact_phone: '555-0100',
      address: 'Dublin',
      logo: '',
    })
    getPortalEquipment.mockResolvedValue([
      {
        id: 101,
        name: 'Warehouse Hoist',
        asset_tag: 'WH-1',
        serial_number: 'SN-101',
        location: 'Bay 1',
        status: 'active',
        next_inspection_due: '2026-09-01',
      },
    ])
    getEquipmentReports.mockResolvedValue([])

    renderDashboardPage('/portal?companyId=1')

    await user.click(await screen.findByRole('button', { name: 'View' }))
    await user.click(screen.getByRole('button', { name: 'Create New Report' }))
    expect(await screen.findByRole('heading', { name: 'Create New Report' })).toBeInTheDocument()

    await user.type(screen.getByLabelText('Report Title'), 'Unsaved Draft')
    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.getByRole('heading', { name: 'Save Changes?' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear Changes' }))
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Create New Report' })).not.toBeInTheDocument()
    })
  })

  it('prompts to save or revert when closing edit report with unsaved changes', async () => {
    const user = userEvent.setup()

    getPortalMe.mockResolvedValue({
      id: 21,
      username: 'demo_staff',
      email: 'staff@example.com',
      fullName: 'Demo Staff',
      role: 'staff',
      allowedCompanyIds: [1],
    })
    getPortalCompanies.mockResolvedValue([
      { id: 1, name: 'Acme Lifts', contact_email: 'hello@acme.test', contact_phone: '555-0100' },
    ])
    getPortalCompanyHeader.mockResolvedValue({
      id: 1,
      name: 'Acme Lifts',
      contact_email: 'hello@acme.test',
      contact_phone: '555-0100',
      address: 'Dublin',
      logo: '',
    })
    getPortalEquipment.mockResolvedValue([
      {
        id: 101,
        name: 'Warehouse Hoist',
        asset_tag: 'WH-1',
        serial_number: 'SN-101',
        location: 'Bay 1',
        status: 'active',
        next_inspection_due: '2026-09-01',
      },
    ])
    getEquipmentReports.mockResolvedValue([
      {
        id: 1,
        title: 'Draft Hoist Inspection',
        report_date: '2026-07-01',
        status: 'draft',
        submitted_by: 21,
        submitted_by_name: 'Demo Staff',
        summary: 'Draft summary',
        findings: 'Findings',
        recommendations: 'Recommendations',
        checklist_items: [],
        images: [],
      },
    ])

    renderDashboardPage('/portal?companyId=1')

    await user.click(await screen.findByRole('button', { name: 'View' }))
    const reportsTable = screen.getAllByRole('table').slice(-1)[0]
    await user.click(within(reportsTable).getByRole('button', { name: 'View' }))
    await user.click(await screen.findByRole('button', { name: 'Edit Report' }))

    const firstSummaryInput = screen.getByLabelText('Summary')
    await user.clear(firstSummaryInput)
    await user.type(firstSummaryInput, 'Changed summary once')
    expect(firstSummaryInput).toHaveValue('Changed summary once')
    const firstEditHeader = screen.getByRole('heading', { name: 'Edit Report' }).parentElement
    expect(firstEditHeader).not.toBeNull()
    await user.click(within(firstEditHeader).getByRole('button', { name: 'Close' }))

    expect(await screen.findByRole('heading', { name: 'Save Changes?' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Revert Changes' }))
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Edit Report' })).not.toBeInTheDocument()
    })

    await user.click(within(reportsTable).getByRole('button', { name: 'View' }))
    await user.click(await screen.findByRole('button', { name: 'Edit Report' }))
    const secondSummaryInput = screen.getByLabelText('Summary')
    await user.clear(secondSummaryInput)
    await user.type(secondSummaryInput, 'Changed summary twice')
    expect(secondSummaryInput).toHaveValue('Changed summary twice')
    const secondEditHeader = screen.getByRole('heading', { name: 'Edit Report' }).parentElement
    expect(secondEditHeader).not.toBeNull()
    await user.click(within(secondEditHeader).getByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => {
      expect(updateReport).toHaveBeenCalledWith('1', expect.objectContaining({ summary: 'Changed summary twice' }))
    })
  })

  it('requires a checklist note when a report item is marked non-good', async () => {
    const user = userEvent.setup()

    getPortalMe.mockResolvedValue({
      id: 21,
      username: 'demo_staff',
      email: 'staff@example.com',
      fullName: 'Demo Staff',
      role: 'staff',
      allowedCompanyIds: [1],
    })
    getPortalCompanies.mockResolvedValue([
      { id: 1, name: 'Acme Lifts', contact_email: 'hello@acme.test', contact_phone: '555-0100' },
    ])
    getPortalCompanyHeader.mockResolvedValue({
      id: 1,
      name: 'Acme Lifts',
      contact_email: 'hello@acme.test',
      contact_phone: '555-0100',
      address: 'Dublin',
      logo: '',
    })
    getPortalEquipment.mockResolvedValue([
      {
        id: 101,
        name: 'Warehouse Hoist',
        asset_tag: 'WH-1',
        serial_number: 'SN-101',
        location: 'Bay 1',
        status: 'active',
        next_inspection_due: '2026-09-01',
      },
    ])
    getEquipmentReports.mockResolvedValue([])

    renderDashboardPage('/portal?companyId=1')

    await user.click(await screen.findByRole('button', { name: 'View' }))
    await user.click(screen.getByRole('button', { name: 'Create New Report' }))

    await user.type(screen.getByLabelText('Report Title'), 'Checklist Draft')

    const checklistRow = screen.getByText('Initial Test Run').closest('div')
    expect(checklistRow).not.toBeNull()
    await user.selectOptions(within(checklistRow).getByRole('combobox'), 'attention_required')

    await user.click(screen.getByRole('button', { name: 'Submit Report' }))

    expect(createEquipmentReport).not.toHaveBeenCalled()
    expect(screen.getByText("Add a note for 'Initial Test Run' before saving this report.")).toBeInTheDocument()
  })

  it('saves an incomplete report as a draft from the close prompt', async () => {
    const user = userEvent.setup()

    getPortalMe.mockResolvedValue({
      id: 21,
      username: 'demo_staff',
      email: 'staff@example.com',
      fullName: 'Demo Staff',
      role: 'staff',
      allowedCompanyIds: [1],
    })
    getPortalCompanies.mockResolvedValue([
      { id: 1, name: 'Acme Lifts', contact_email: 'hello@acme.test', contact_phone: '555-0100' },
    ])
    getPortalCompanyHeader.mockResolvedValue({
      id: 1,
      name: 'Acme Lifts',
      contact_email: 'hello@acme.test',
      contact_phone: '555-0100',
      address: 'Dublin',
      logo: '',
    })
    getPortalEquipment.mockResolvedValue([
      {
        id: 101,
        name: 'Warehouse Hoist',
        asset_tag: 'WH-1',
        serial_number: 'SN-101',
        location: 'Bay 1',
        status: 'active',
        next_inspection_due: '2026-09-01',
      },
    ])
    getEquipmentReports.mockResolvedValue([])
    createEquipmentReport.mockResolvedValue({ id: 77, status: 'draft' })

    renderDashboardPage('/portal?companyId=1')

    await user.click(await screen.findByRole('button', { name: 'View' }))
    await user.click(screen.getByRole('button', { name: 'Create New Report' }))

    await user.type(screen.getByLabelText('Report Title'), 'Draft with missing checklist note')
    const checklistRow = screen.getByText('Initial Test Run').closest('div')
    expect(checklistRow).not.toBeNull()
    await user.selectOptions(within(checklistRow).getByRole('combobox'), 'attention_required')

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(await screen.findByRole('heading', { name: 'Save Changes?' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save as Draft' }))

    await waitFor(() => {
      expect(createEquipmentReport).toHaveBeenCalledWith(
        101,
        expect.objectContaining({
          title: 'Draft with missing checklist note',
          status: 'draft',
        }),
      )
    })
  })

  it('restores a saved create-report draft from localStorage', async () => {
    const user = userEvent.setup()

    getPortalMe.mockResolvedValue({
      id: 21,
      username: 'demo_staff',
      email: 'staff@example.com',
      fullName: 'Demo Staff',
      role: 'staff',
      allowedCompanyIds: [1],
    })
    getPortalCompanies.mockResolvedValue([
      { id: 1, name: 'Acme Lifts', contact_email: 'hello@acme.test', contact_phone: '555-0100' },
    ])
    getPortalCompanyHeader.mockResolvedValue({
      id: 1,
      name: 'Acme Lifts',
      contact_email: 'hello@acme.test',
      contact_phone: '555-0100',
      address: 'Dublin',
      logo: '',
    })
    getPortalEquipment.mockResolvedValue([
      {
        id: 101,
        name: 'Warehouse Hoist',
        asset_tag: 'WH-1',
        serial_number: 'SN-101',
        location: 'Bay 1',
        status: 'active',
        next_inspection_due: '2026-09-01',
      },
    ])
    getEquipmentReports.mockResolvedValue([])

    const originalLocalStorage = window.localStorage
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: vi.fn(() =>
          JSON.stringify({
            mode: 'create',
            equipmentId: '101',
            form: {
              title: 'Restored Draft Title',
              summary: 'Draft summary',
              findings: '',
              recommendations: '',
              report_date: '2026-07-10',
              status: 'draft',
            },
          }),
        ),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
    })

    renderDashboardPage('/portal?companyId=1')

    await user.click(await screen.findByRole('button', { name: 'View' }))
    await user.click(screen.getByRole('button', { name: 'Create New Report' }))

    expect(await screen.findByRole('heading', { name: 'Create New Report' })).toBeInTheDocument()
    expect(screen.getByLabelText('Report Title')).toHaveValue('Restored Draft Title')
    expect(screen.getByLabelText('Summary')).toHaveValue('Draft summary')

    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: originalLocalStorage,
    })
  })

  it('refreshes the equipment table after a report is submitted', async () => {
    const user = userEvent.setup()

    getPortalMe.mockResolvedValue({
      id: 21,
      username: 'demo_staff',
      email: 'staff@example.com',
      fullName: 'Demo Staff',
      role: 'staff',
      allowedCompanyIds: [1],
    })
    getPortalCompanies.mockResolvedValue([
      { id: 1, name: 'Acme Lifts', contact_email: 'hello@acme.test', contact_phone: '555-0100' },
    ])
    getPortalCompanyHeader.mockResolvedValue({
      id: 1,
      name: 'Acme Lifts',
      contact_email: 'hello@acme.test',
      contact_phone: '555-0100',
      address: 'Dublin',
      logo: '',
    })
    getPortalEquipment
      .mockResolvedValueOnce([
        {
          id: 101,
          company_id: 1,
          name: 'Warehouse Hoist',
          asset_tag: 'WH-1',
          serial_number: 'SN-101',
          location: 'Bay 1',
          status: 'active',
          inspection_interval_days: 365,
          next_inspection_due: '2026-09-01',
          last_inspected_at: '2025-09-01',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 101,
          company_id: 1,
          name: 'Warehouse Hoist',
          asset_tag: 'WH-1',
          serial_number: 'SN-101',
          location: 'Bay 1',
          status: 'active',
          inspection_interval_days: 365,
          next_inspection_due: '2027-06-30',
          last_inspected_at: '2026-06-30',
        },
      ])
    createEquipmentReport.mockResolvedValue({ id: 77 })
    getEquipmentReports.mockResolvedValue([])

    renderDashboardPage('/portal?companyId=1')

    await user.click(await screen.findByRole('button', { name: 'View' }))
    await user.click(screen.getByRole('button', { name: 'Create New Report' }))

    await user.type(screen.getByLabelText('Report Title'), 'Submitted Inspection')
    await user.click(screen.getByRole('button', { name: 'Submit Report' }))

    expect(await screen.findAllByText('30-06-2027')).toHaveLength(2)
  })

  it('only shows draft report editing for staff on their own drafts', async () => {
    const user = userEvent.setup()

    getPortalMe.mockResolvedValue({
      id: 21,
      username: 'demo_staff',
      email: 'staff@example.com',
      fullName: 'Demo Staff',
      role: 'staff',
      allowedCompanyIds: [1],
    })
    getPortalCompanies.mockResolvedValue([
      { id: 1, name: 'Acme Lifts', contact_email: 'hello@acme.test', contact_phone: '555-0100' },
    ])
    getPortalCompanyHeader.mockResolvedValue({
      id: 1,
      name: 'Acme Lifts',
      contact_email: 'hello@acme.test',
      contact_phone: '555-0100',
      address: 'Dublin',
      logo: '',
    })
    getPortalEquipment.mockResolvedValue([
      {
        id: 101,
        name: 'Warehouse Hoist',
        asset_tag: 'WH-1',
        serial_number: 'SN-101',
        location: 'Bay 1',
        status: 'active',
        next_inspection_due: '2026-09-01',
      },
    ])
    getEquipmentReports.mockResolvedValue([
      {
        id: 1,
        title: 'Draft Hoist Inspection',
        report_date: '2026-07-01',
        status: 'draft',
        submitted_by: 21,
        submitted_by_name: 'Demo Staff',
        summary: 'Draft summary',
      },
      {
        id: 2,
        title: 'Submitted Hoist Inspection',
        report_date: '2026-07-02',
        status: 'submitted',
        submitted_by: 21,
        submitted_by_name: 'Demo Staff',
        summary: 'Submitted summary',
      },
    ])

    renderDashboardPage('/portal?companyId=1')

    await user.click(await screen.findByRole('button', { name: 'View' }))

    expect(await screen.findByText('Draft Hoist Inspection')).toBeInTheDocument()

    const tables = screen.getAllByRole('table')
    const reportsTable = tables[tables.length - 1]
    const reportViewButtons = within(reportsTable).getAllByRole('button', { name: 'View' })

    await user.click(reportViewButtons[0])
    expect(await screen.findByRole('heading', { name: 'Draft Hoist Inspection' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Report' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revisions' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close' }))

    const refreshedReportsTable = screen.getAllByRole('table').slice(-1)[0]
    const refreshedViewButtons = within(refreshedReportsTable).getAllByRole('button', { name: 'View' })
    await user.click(refreshedViewButtons[1])
    expect(await screen.findByRole('heading', { name: 'Submitted Hoist Inspection' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Report' })).not.toBeInTheDocument()
  })

  it('allows draft deletion only for the draft creator', async () => {
    const user = userEvent.setup()

    getPortalMe.mockResolvedValue({
      id: 21,
      username: 'demo_staff',
      email: 'staff@example.com',
      fullName: 'Demo Staff',
      role: 'staff',
      allowedCompanyIds: [1],
    })
    getPortalCompanies.mockResolvedValue([
      { id: 1, name: 'Acme Lifts', contact_email: 'hello@acme.test', contact_phone: '555-0100' },
    ])
    getPortalCompanyHeader.mockResolvedValue({
      id: 1,
      name: 'Acme Lifts',
      contact_email: 'hello@acme.test',
      contact_phone: '555-0100',
      address: 'Dublin',
      logo: '',
    })
    getPortalEquipment.mockResolvedValue([
      {
        id: 101,
        name: 'Warehouse Hoist',
        asset_tag: 'WH-1',
        serial_number: 'SN-101',
        location: 'Bay 1',
        status: 'active',
        next_inspection_due: '2026-09-01',
      },
    ])
    getEquipmentReports.mockResolvedValue([
      {
        id: 1,
        title: 'Own Draft',
        report_date: '2026-07-01',
        status: 'draft',
        submitted_by: 21,
        submitted_by_name: 'Demo Staff',
        summary: 'Own draft summary',
      },
      {
        id: 2,
        title: 'Other Draft',
        report_date: '2026-07-02',
        status: 'draft',
        submitted_by: 55,
        submitted_by_name: 'Another Staff',
        summary: 'Other draft summary',
      },
    ])

    renderDashboardPage('/portal?companyId=1')

    await user.click(await screen.findByRole('button', { name: 'View' }))

    const tables = screen.getAllByRole('table')
    const reportsTable = tables[tables.length - 1]
    const reportViewButtons = within(reportsTable).getAllByRole('button', { name: 'View' })

    await user.click(reportViewButtons[0])
    expect(await screen.findByRole('heading', { name: 'Own Draft' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Draft' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete Draft' }))
    await user.click(screen.getByRole('button', { name: 'Confirm Delete Draft' }))
    await waitFor(() => {
      expect(deleteReport).toHaveBeenCalledWith(1)
    })

    await user.click(reportViewButtons[1])
    expect(await screen.findByRole('heading', { name: 'Other Draft' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete Draft' })).not.toBeInTheDocument()
  })

  it('saves edits to an existing draft without submitting it', async () => {
    const user = userEvent.setup()

    getPortalMe.mockResolvedValue({
      id: 21,
      username: 'demo_staff',
      email: 'staff@example.com',
      fullName: 'Demo Staff',
      role: 'staff',
      allowedCompanyIds: [1],
    })
    getPortalCompanies.mockResolvedValue([
      { id: 1, name: 'Acme Lifts', contact_email: 'hello@acme.test', contact_phone: '555-0100' },
    ])
    getPortalCompanyHeader.mockResolvedValue({
      id: 1,
      name: 'Acme Lifts',
      contact_email: 'hello@acme.test',
      contact_phone: '555-0100',
      address: 'Dublin',
      logo: '',
    })
    getPortalEquipment.mockResolvedValue([
      {
        id: 101,
        name: 'Warehouse Hoist',
        asset_tag: 'WH-1',
        serial_number: 'SN-101',
        location: 'Bay 1',
        status: 'active',
        next_inspection_due: '2026-09-01',
      },
    ])
    getEquipmentReports.mockResolvedValue([
      {
        id: 1,
        title: 'Draft Hoist Inspection',
        report_date: '2026-07-01',
        status: 'draft',
        submitted_by: 21,
        submitted_by_name: 'Demo Staff',
        summary: 'Draft summary',
        findings: 'Draft findings',
        recommendations: 'Draft recommendations',
        checklist_items: [],
        images: [],
      },
    ])
    updateReport.mockResolvedValue({ id: 1, status: 'draft' })

    renderDashboardPage('/portal?companyId=1')

    await user.click(await screen.findByRole('button', { name: 'View' }))
    const reportsTable = screen.getAllByRole('table').slice(-1)[0]
    await user.click(within(reportsTable).getByRole('button', { name: 'View' }))
    await user.click(await screen.findByRole('button', { name: 'Edit Report' }))

    const summaryInput = screen.getByLabelText('Summary')
    await user.clear(summaryInput)
    await user.type(summaryInput, 'Updated draft summary')
    await user.click(screen.getByRole('button', { name: 'Save Report' }))

    await waitFor(() => {
      expect(updateReport).toHaveBeenCalledWith(
        '1',
        expect.objectContaining({
          summary: 'Updated draft summary',
          status: 'draft',
        }),
      )
    })
  })

  it('lets owners edit submitted reports without a status selector', async () => {
    const user = userEvent.setup()

    getPortalMe.mockResolvedValue({
      id: 31,
      username: 'demo_owner',
      email: 'owner@example.com',
      fullName: 'Demo Owner',
      role: 'owner',
      allowedCompanyIds: [1],
    })
    getPortalCompanies.mockResolvedValue([
      { id: 1, name: 'Acme Lifts', contact_email: 'hello@acme.test', contact_phone: '555-0100' },
    ])
    getPortalCompanyHeader.mockResolvedValue({
      id: 1,
      name: 'Acme Lifts',
      contact_email: 'hello@acme.test',
      contact_phone: '555-0100',
      address: 'Dublin',
      logo: '',
    })
    getPortalEquipment.mockResolvedValue([
      {
        id: 101,
        name: 'Warehouse Hoist',
        asset_tag: 'WH-1',
        serial_number: 'SN-101',
        location: 'Bay 1',
        status: 'active',
        next_inspection_due: '2026-09-01',
      },
    ])
    getEquipmentReports.mockResolvedValue([
      {
        id: 2,
        title: 'Submitted Hoist Inspection',
        report_date: '2026-07-02',
        status: 'submitted',
        submitted_by: 21,
        submitted_by_name: 'Demo Staff',
        summary: 'Submitted summary',
        findings: 'Findings',
        recommendations: 'Recommendations',
      },
    ])

    renderDashboardPage('/portal?companyId=1')

    await user.click(await screen.findByRole('button', { name: 'View' }))

    const tables = screen.getAllByRole('table')
    const reportsTable = tables[tables.length - 1]
    await user.click(within(reportsTable).getByRole('button', { name: 'View' }))

    expect(await screen.findByRole('heading', { name: 'Submitted Hoist Inspection' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Revisions' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit Report' }))

    expect(await screen.findByRole('heading', { name: 'Edit Report' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Status' })).not.toBeInTheDocument()
  })

  it('shows full revision details with exact before and after changes', async () => {
    const user = userEvent.setup()

    getPortalMe.mockResolvedValue({
      id: 31,
      username: 'demo_owner',
      email: 'owner@example.com',
      fullName: 'Demo Owner',
      role: 'owner',
      allowedCompanyIds: [1],
    })
    getPortalCompanies.mockResolvedValue([
      { id: 1, name: 'Acme Lifts', contact_email: 'hello@acme.test', contact_phone: '555-0100' },
    ])
    getPortalCompanyHeader.mockResolvedValue({
      id: 1,
      name: 'Acme Lifts',
      contact_email: 'hello@acme.test',
      contact_phone: '555-0100',
      address: 'Dublin',
      logo: '',
    })
    getPortalEquipment.mockResolvedValue([
      {
        id: 101,
        name: 'Warehouse Hoist',
        asset_tag: 'WH-1',
        serial_number: 'SN-101',
        location: 'Bay 1',
        status: 'active',
        next_inspection_due: '2026-09-01',
      },
    ])
    getEquipmentReports.mockResolvedValue([
      {
        id: 2,
        title: 'Updated Hoist Inspection',
        report_date: '2026-07-02',
        status: 'approved',
        submitted_by: 21,
        submitted_by_name: 'Demo Staff',
        summary: 'Updated summary',
        findings: 'Updated findings',
        recommendations: 'Updated recommendations',
        checklist_items: [
          {
            label: 'Hoist Brake',
            status: 'attention_required',
            note: 'Brake chatter under load',
          },
        ],
      },
    ])
    getReportRevisions.mockResolvedValue([
      {
        id: 9,
        edited_by_name: 'Demo Owner',
        changed_at: '2026-07-02T10:30:00Z',
        previous_data: {
          title: 'Submitted Hoist Inspection',
          summary: 'Submitted summary',
          findings: 'Submitted findings',
          recommendations: 'Submitted recommendations',
          report_date: '2026-07-01',
          status: 'submitted',
          checklist_items: [
            {
              label: 'Hoist Brake',
              status: 'worn_serviceable',
              note: 'Slight wear observed',
            },
          ],
        },
      },
    ])

    renderDashboardPage('/portal?companyId=1')

    await user.click(await screen.findByRole('button', { name: 'View' }))

    const tables = screen.getAllByRole('table')
    const reportsTable = tables[tables.length - 1]
    await user.click(within(reportsTable).getByRole('button', { name: 'View' }))

    await user.click(screen.getByRole('button', { name: 'Revisions' }))
    expect(await screen.findByRole('heading', { name: 'Revision History' })).toBeInTheDocument()

    const revisionRowSummary = await screen.findByText(/Previous title:/)
    const revisionRow = revisionRowSummary.closest('li')
    expect(revisionRow).not.toBeNull()
    await user.click(within(revisionRow).getByRole('button', { name: 'View' }))

    expect(await screen.findByRole('heading', { name: 'Revision Details' })).toBeInTheDocument()
    expect(screen.getByText('Exactly What Changed')).toBeInTheDocument()

    const checklistChangesHeading = screen.getByText('Checklist Changes')
    const checklistChangesCard = checklistChangesHeading.closest('div')
    expect(checklistChangesCard).not.toBeNull()
    expect(within(checklistChangesCard).getByText('Hoist Brake')).toBeInTheDocument()
    expect(within(checklistChangesCard).getByText('Note Before:')).toBeInTheDocument()
    expect(within(checklistChangesCard).getByText('Slight wear observed')).toBeInTheDocument()
    expect(within(checklistChangesCard).getByText('Note After:')).toBeInTheDocument()
    expect(within(checklistChangesCard).getByText('Brake chatter under load')).toBeInTheDocument()
    expect(screen.getByText('Full Report After This Revision')).toBeInTheDocument()
    expect(screen.getAllByText('Attention Required').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Brake chatter under load').length).toBeGreaterThan(0)
  })

  it('lets owners approve submitted reports directly from the review modal', async () => {
    const user = userEvent.setup()

    getPortalMe.mockResolvedValue({
      id: 31,
      username: 'demo_owner',
      email: 'owner@example.com',
      fullName: 'Demo Owner',
      role: 'owner',
      allowedCompanyIds: [1],
    })
    getPortalCompanies.mockResolvedValue([
      { id: 1, name: 'Acme Lifts', contact_email: 'hello@acme.test', contact_phone: '555-0100' },
    ])
    getPortalCompanyHeader.mockResolvedValue({
      id: 1,
      name: 'Acme Lifts',
      contact_email: 'hello@acme.test',
      contact_phone: '555-0100',
      address: 'Dublin',
      logo: '',
    })
    getPortalEquipment.mockResolvedValue([
      {
        id: 101,
        name: 'Warehouse Hoist',
        asset_tag: 'WH-1',
        serial_number: 'SN-101',
        location: 'Bay 1',
        status: 'active',
        next_inspection_due: '2026-09-01',
      },
    ])
    getEquipmentReports.mockResolvedValue([
      {
        id: 2,
        title: 'Submitted Hoist Inspection',
        report_date: '2026-07-02',
        status: 'submitted',
        submitted_by: 21,
        submitted_by_name: 'Demo Staff',
        summary: 'Submitted summary',
        findings: 'Findings',
        recommendations: 'Recommendations',
      },
    ])
    updateReport.mockResolvedValue({
      id: 2,
      title: 'Submitted Hoist Inspection',
      report_date: '2026-07-02',
      status: 'approved',
      submitted_by: 21,
      submitted_by_name: 'Demo Staff',
      summary: 'Submitted summary',
      findings: 'Findings',
      recommendations: 'Recommendations',
    })

    renderDashboardPage('/portal?companyId=1')

    await user.click(await screen.findByRole('button', { name: 'View' }))

    const tables = screen.getAllByRole('table')
    const reportsTable = tables[tables.length - 1]
    await user.click(within(reportsTable).getByRole('button', { name: 'View' }))

    expect(await screen.findByRole('heading', { name: 'Submitted Hoist Inspection' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve Report' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Approve Report' }))

    expect(updateReport).toHaveBeenCalledWith(2, { status: 'approved' })
  })

  it('updates approval UI optimistically and rolls back if approval fails', async () => {
    const user = userEvent.setup()

    getPortalMe.mockResolvedValue({
      id: 31,
      username: 'demo_owner',
      email: 'owner@example.com',
      fullName: 'Demo Owner',
      role: 'owner',
      allowedCompanyIds: [1],
    })
    getPortalCompanies.mockResolvedValue([
      { id: 1, name: 'Acme Lifts', contact_email: 'hello@acme.test', contact_phone: '555-0100' },
    ])
    getPortalCompanyHeader.mockResolvedValue({
      id: 1,
      name: 'Acme Lifts',
      contact_email: 'hello@acme.test',
      contact_phone: '555-0100',
      address: 'Dublin',
      logo: '',
    })
    getPortalEquipment.mockResolvedValue([
      {
        id: 101,
        name: 'Warehouse Hoist',
        asset_tag: 'WH-1',
        serial_number: 'SN-101',
        location: 'Bay 1',
        status: 'active',
        next_inspection_due: '2026-09-01',
      },
    ])
    getEquipmentReports.mockResolvedValue([
      {
        id: 2,
        title: 'Submitted Hoist Inspection',
        report_date: '2026-07-02',
        status: 'submitted',
        submitted_by: 21,
        submitted_by_name: 'Demo Staff',
        summary: 'Submitted summary',
        findings: 'Findings',
        recommendations: 'Recommendations',
      },
    ])

    let rejectApproval
    const approvalPromise = new Promise((_, reject) => {
      rejectApproval = reject
    })
    updateReport.mockReturnValue(approvalPromise)

    renderDashboardPage('/portal?companyId=1')

    await user.click(await screen.findByRole('button', { name: 'View' }))
    const tables = screen.getAllByRole('table')
    const reportsTable = tables[tables.length - 1]
    await user.click(within(reportsTable).getByRole('button', { name: 'View' }))

    expect(await screen.findByRole('button', { name: 'Approve Report' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Approve Report' }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Approve Report' })).not.toBeInTheDocument()
    })

    rejectApproval(new Error('Approval failed'))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Approve Report' })).toBeInTheDocument()
      expect(screen.getByText('Approval failed')).toBeInTheDocument()
    })
  })

  it('updates equipment counts optimistically when decommissioning from details', async () => {
    const user = userEvent.setup()

    getPortalMe.mockResolvedValue({
      id: 21,
      username: 'demo_staff',
      email: 'staff@example.com',
      fullName: 'Demo Staff',
      role: 'staff',
      allowedCompanyIds: [1],
    })
    getPortalCompanies.mockResolvedValue([
      { id: 1, name: 'Acme Lifts', contact_email: 'hello@acme.test', contact_phone: '555-0100' },
    ])
    getPortalCompanyHeader.mockResolvedValue({
      id: 1,
      name: 'Acme Lifts',
      contact_email: 'hello@acme.test',
      contact_phone: '555-0100',
      address: 'Dublin',
      logo: '',
    })
    getPortalEquipment
      .mockResolvedValueOnce([
        {
          id: 101,
          company_id: 1,
          name: 'Warehouse Hoist',
          asset_tag: 'WH-1',
          serial_number: 'SN-101',
          location: 'Bay 1',
          status: 'active',
          next_inspection_due: '2026-09-01',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 101,
          company_id: 1,
          name: 'Warehouse Hoist',
          asset_tag: 'WH-1',
          serial_number: 'SN-101',
          location: 'Bay 1',
          status: 'decommissioned',
          next_inspection_due: '2026-09-01',
        },
      ])
    getEquipmentReports.mockResolvedValue([])

    let resolveStatusUpdate
    updatePortalEquipment.mockReturnValue(
      new Promise((resolve) => {
        resolveStatusUpdate = resolve
      }),
    )

    renderDashboardPage('/portal?companyId=1')

    expect(await screen.findByText('Active Equipment (1)')).toBeInTheDocument()
    expect(screen.getByText('Decommissioned Equipment (0)')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'View' }))
    const equipmentDetailsHeading = await screen.findByRole('heading', {
      name: 'Equipment Details: Warehouse Hoist',
    })
    const equipmentDetailsSection = equipmentDetailsHeading.closest('section')
    expect(equipmentDetailsSection).not.toBeNull()
    const statusSelect = equipmentDetailsSection?.querySelector(
      'select.rounded-md.border.border-slate-300.px-2.py-1.text-xs',
    )
    expect(statusSelect).not.toBeNull()
    await user.selectOptions(statusSelect, 'decommissioned')
    await user.click(screen.getByRole('button', { name: 'Update Status' }))
    await user.click(await screen.findByRole('button', { name: 'Yes, Decommission' }))

    await waitFor(() => {
      expect(screen.getByText('Active Equipment (0)')).toBeInTheDocument()
      expect(screen.getByText('Decommissioned Equipment (1)')).toBeInTheDocument()
    })

    resolveStatusUpdate({})
    await waitFor(() => {
      expect(updatePortalEquipment).toHaveBeenCalledWith(101, { status: 'decommissioned' })
    })
  })

  it('refreshes the pending approvals list when the owner clicks refresh', async () => {
    const user = userEvent.setup()

    getPortalMe.mockResolvedValue({
      id: 31,
      username: 'demo_owner',
      email: 'owner@example.com',
      fullName: 'Demo Owner',
      role: 'owner',
      allowedCompanyIds: [1],
    })
    getPortalCompanies.mockResolvedValue([
      { id: 1, name: 'Acme Lifts', contact_email: 'hello@acme.test', contact_phone: '555-0100' },
    ])
    getPortalCompanyHeader.mockResolvedValue({
      id: 1,
      name: 'Acme Lifts',
      contact_email: 'hello@acme.test',
      contact_phone: '555-0100',
      address: 'Dublin',
      logo: '',
    })
    getPortalEquipment.mockResolvedValue([
      {
        id: 101,
        name: 'Warehouse Hoist',
        asset_tag: 'WH-1',
        serial_number: 'SN-101',
        location: 'Bay 1',
        status: 'active',
        next_inspection_due: '2026-09-01',
      },
    ])
    getPendingReportApprovals
      .mockResolvedValueOnce([
        {
          id: 2,
          title: 'Submitted Hoist Inspection',
          report_date: '2026-07-02',
          status: 'submitted',
          submitted_by: 21,
          submitted_by_name: 'Demo Staff',
          summary: 'Submitted summary',
          company_name: 'Acme Lifts',
          equipment_name: 'Warehouse Hoist',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 2,
          title: 'Submitted Hoist Inspection',
          report_date: '2026-07-02',
          status: 'submitted',
          submitted_by: 21,
          submitted_by_name: 'Demo Staff',
          summary: 'Submitted summary',
          company_name: 'Acme Lifts',
          equipment_name: 'Warehouse Hoist',
        },
      ])

    renderDashboardPage('/portal')

    expect(await screen.findByRole('heading', { name: 'Customer List' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(getPendingReportApprovals).toHaveBeenCalledTimes(2)
  })

  it('lets owners jump from a pending approval review modal to the matching equipment', async () => {
    const user = userEvent.setup()

    getPortalMe.mockResolvedValue({
      id: 31,
      username: 'demo_owner',
      email: 'owner@example.com',
      fullName: 'Demo Owner',
      role: 'owner',
      allowedCompanyIds: [1],
    })
    getPortalCompanies.mockResolvedValue([
      { id: 1, name: 'Acme Lifts', contact_email: 'hello@acme.test', contact_phone: '555-0100' },
    ])
    getPortalCompanyHeader.mockResolvedValue({
      id: 1,
      name: 'Acme Lifts',
      contact_email: 'hello@acme.test',
      contact_phone: '555-0100',
      address: 'Dublin',
      logo: '',
    })
    getPortalEquipment.mockResolvedValue([
      {
        id: 101,
        company_id: 1,
        name: 'Warehouse Hoist',
        asset_tag: 'WH-1',
        serial_number: 'SN-101',
        location: 'Bay 1',
        status: 'active',
        next_inspection_due: '2026-09-01',
      },
    ])
    getPendingReportApprovals.mockResolvedValue([
      {
        id: 2,
        equipment_id: 101,
        company_id: 1,
        title: 'Submitted Hoist Inspection',
        report_date: '2026-07-02',
        status: 'submitted',
        submitted_by: 21,
        submitted_by_name: 'Demo Staff',
        summary: 'Submitted summary',
        findings: 'Findings',
        recommendations: 'Recommendations',
        company_name: 'Acme Lifts',
        equipment_name: 'Warehouse Hoist',
        images: [],
      },
    ])

    renderDashboardPage('/portal')

    expect(await screen.findByRole('heading', { name: 'Customer List' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Review Report' }))
    expect(await screen.findByRole('button', { name: 'Go to equipment' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Go to equipment' }))

    expect(await screen.findByRole('heading', { name: 'Equipment Details: Warehouse Hoist' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Go to equipment' })).not.toBeInTheDocument()
  })

  it('saves owner edits from the pending approvals modal without selecting equipment first', async () => {
    const user = userEvent.setup()

    getPortalMe.mockResolvedValue({
      id: 31,
      username: 'demo_owner',
      email: 'owner@example.com',
      fullName: 'Demo Owner',
      role: 'owner',
      allowedCompanyIds: [1],
    })
    getPortalCompanies.mockResolvedValue([
      { id: 1, name: 'Acme Lifts', contact_email: 'hello@acme.test', contact_phone: '555-0100' },
    ])
    getPortalEquipment.mockResolvedValue([])
    getPendingReportApprovals.mockResolvedValue([
      {
        id: 2,
        equipment_id: 101,
        company_id: 1,
        title: 'Submitted Hoist Inspection',
        report_date: '2026-07-02',
        status: 'submitted',
        submitted_by: 21,
        submitted_by_name: 'Demo Staff',
        summary: 'Submitted summary',
        findings: 'Findings',
        recommendations: 'Recommendations',
        company_name: 'Acme Lifts',
        equipment_name: 'Warehouse Hoist',
        images: [],
      },
    ])
    updateReport.mockResolvedValue({
      id: 2,
      equipment_id: 101,
      company_id: 1,
      title: 'Updated Submitted Hoist Inspection',
      report_date: '2026-07-03',
      status: 'approved',
      submitted_by: 21,
      submitted_by_name: 'Demo Staff',
      summary: 'Updated summary',
      findings: 'Updated findings',
      recommendations: 'Updated recommendations',
      images: [],
    })

    renderDashboardPage('/portal')

    expect(await screen.findByRole('heading', { name: 'Customer List' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Review Report' }))
    await user.click(await screen.findByRole('button', { name: 'Edit Report' }))

    await user.clear(screen.getByLabelText('Report Title'))
    await user.type(screen.getByLabelText('Report Title'), 'Updated Submitted Hoist Inspection')
    await user.click(screen.getByRole('button', { name: 'Save Report' }))

    await waitFor(() => {
      expect(updateReport).toHaveBeenCalledWith('2', expect.objectContaining({
        title: 'Updated Submitted Hoist Inspection',
        summary: 'Submitted summary',
        findings: 'Findings',
        recommendations: 'Recommendations',
        report_date: '2026-07-02',
        status: 'submitted',
        images: [],
        removed_image_ids: [],
      }))
    })

    expect(getEquipmentReports).not.toHaveBeenCalled()
  })
})
