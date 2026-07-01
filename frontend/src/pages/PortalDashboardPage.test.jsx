import { render, screen, waitFor, within } from '@testing-library/react'
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
  getEquipmentReports: vi.fn(),
  getPortalCompanies: vi.fn(),
  getPortalCompanyHeader: vi.fn(),
  getPortalEquipment: vi.fn(),
  getPortalMe: vi.fn(),
  getPendingReportApprovals: vi.fn(),
  getReportRevisions: vi.fn(),
  hasPortalSession: vi.fn(),
  portalLogout: vi.fn(),
  updateReport: vi.fn(),
}))

import {
  createEquipmentReport,
  getEquipmentReports,
  getPortalCompanies,
  getPortalCompanyHeader,
  getPortalEquipment,
  getPortalMe,
  getPendingReportApprovals,
  hasPortalSession,
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
    hasPortalSession.mockReturnValue(true)
    getPortalCompanies.mockResolvedValue([])
    getEquipmentReports.mockResolvedValue([])
    getPortalCompanyHeader.mockResolvedValue({})
    getPortalEquipment.mockResolvedValue([])
    getPendingReportApprovals.mockResolvedValue([])
    updateReport.mockResolvedValue({})
  })

  it('redirects signed-out users to the portal login route', () => {
    hasPortalSession.mockReturnValue(false)

    renderDashboardPage()

    expect(screen.getByText('Login Page')).toBeInTheDocument()
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

  it('shows company details and equipment directly for customer users', async () => {
    mockCustomerData()

    renderDashboardPage()

    expect(await screen.findByText('Acme Lifts')).toBeInTheDocument()
    expect(screen.getByText('Equipment & Certification Hub')).toBeInTheDocument()
    expect(screen.getByText('Warehouse Hoist')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Customer List' })).not.toBeInTheDocument()
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
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'submitted')
    await user.click(screen.getByRole('button', { name: 'Create Report' }))

    expect(await screen.findAllByText('2027-06-30')).toHaveLength(2)
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

    await user.click(reportViewButtons[1])
    expect(await screen.findByRole('heading', { name: 'Submitted Hoist Inspection' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Report' })).not.toBeInTheDocument()
  })

  it('lets owners edit submitted reports with submitted and approved status options', async () => {
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
    expect(screen.getByRole('option', { name: 'Submitted' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Approved' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Draft' })).not.toBeInTheDocument()
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
})
