import { describe, expect, it } from 'vitest';
import type { PayrollRequestRow } from '@/app/actions/payrollActions';
import { buildPayrollExportWorkbook } from './payrollExportReport';

function request(
  loanChannel: PayrollRequestRow['loanChannel'],
  overrides: Partial<PayrollRequestRow> = {},
) {
  return {
    loanChannel,
    loanNumber: loanChannel === 'BROKER' ? 'BROKER-100' : 'NONDEL-200',
    borrowerName: 'A & B <Borrower>',
    loanOfficerName: 'Example Officer',
    loanOfficerEmail: 'officer@example.com',
    loanType: 'Conventional',
    lender: 'Example Lender',
    processingType: 'LOAN_OFFICER',
    leadSource: 'MAILER',
    mailerCampaign: 'Fall <Mailer>',
    leadProvidedBy: 'SELF_GENERATED',
    expectedRevenue: 1234.56,
    submittedAt: '2026-09-16T15:00:00.000Z',
    managerCalculationRequired: false,
    ...overrides,
  } as PayrollRequestRow;
}

describe('payroll export workbook', () => {
  it('separates Broker and Non-Del requests into worksheets', () => {
    const workbook = buildPayrollExportWorkbook({
      rows: [request('BROKER'), request('NON_DELEGATED')],
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      generatedAt: '2026-09-16T18:00:00.000Z',
    });

    expect(workbook.content).toContain('<Worksheet ss:Name="Broker">');
    expect(workbook.content).toContain('<Worksheet ss:Name="Non-Del">');
    expect(workbook.content).toContain('BROKER-100');
    expect(workbook.content).toContain('NONDEL-200');
    expect(workbook.filename).toBe(
      'payroll-export-report-2026-09-01-to-2026-09-30.xls',
    );
  });

  it('includes LO entry fields and escapes XML values', () => {
    const workbook = buildPayrollExportWorkbook({
      rows: [request('BROKER')],
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    });

    expect(workbook.content).toContain('Mailer Campaign');
    expect(workbook.content).toContain('Figure/NFTY Attachment URL');
    expect(workbook.content).toContain('Borrower Credit Score');
    expect(workbook.content).toContain('A &amp; B &lt;Borrower&gt;');
    expect(workbook.content).toContain('Fall &lt;Mailer&gt;');
    expect(workbook.content).not.toContain('A & B <Borrower>');
  });

  it('adds filters, frozen headers, styling, and an empty-tab message', () => {
    const workbook = buildPayrollExportWorkbook({
      rows: [request('BROKER')],
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    });

    expect(workbook.content).toContain('<FreezePanes/>');
    expect(workbook.content).toContain('<AutoFilter');
    expect(workbook.content).toContain('ss:StyleID="DataEvenCurrency"');
    expect(workbook.content).toContain(
      'No Non-Del payroll requests were submitted in this date range.',
    );
    expect(workbook.mimeType).toContain('application/vnd.ms-excel');
  });
});
