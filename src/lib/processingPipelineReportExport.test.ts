import { describe, expect, it } from 'vitest';
import { ProcessingPipelineStatus } from '@prisma/client';
import type { ProcessingPipelineReport } from '@/app/actions/processingPipelineReportingActions';
import {
  buildProcessingReportWorkbook,
  processingReportFilename,
} from './processingPipelineReportExport';

const report: ProcessingPipelineReport = {
  type: 'LAST_TOUCH',
  generatedAt: '2026-09-18T19:00:00.000Z',
  rows: [
    {
      pipelineLoanId: 'pipeline-1',
      bucket: 'Pipeline',
      rateLockRequested: true,
      assignmentDate: '2026-09-01T12:00:00.000Z',
      loanNumber: '12345678',
      borrowerName: 'A & B <Borrower>',
      loanOfficer: 'Loan Officer',
      juniorProcessor: 'Jr Processor',
      seniorProcessor: 'Sr Processor',
      state: 'FL',
      lender: 'Example Lender',
      loanType: 'Conventional',
      pipelineStatus: ProcessingPipelineStatus.DOCS_OUT,
      statusChangedAt: '2026-09-17T12:00:00.000Z',
      daysInStatus: 1,
      pendingItems: 'Final review',
      lastChangedItem: 'Pipeline Status: CTC → Docs out',
      lastChangedBy: 'Processor',
      lastTouchedAt: '2026-09-17T12:00:00.000Z',
      lastTouchedAge: '1 day ago',
    },
  ],
};

const fundingReport: ProcessingPipelineReport = {
  type: 'FUNDING',
  generatedAt: '2026-09-18T19:00:00.000Z',
  fundedFrom: '2026-08-01',
  fundedTo: '2026-08-31',
  rows: [
    {
      pipelineLoanId: 'pipeline-funded-1',
      assignmentDate: '2026-07-15T12:00:00.000Z',
      loanNumber: '87654321',
      loanOfficer: 'Loan Officer',
      borrowerName: 'Funded Borrower',
      leadSource: 'Referral',
      state: 'FL',
      loanType: 'Conventional',
      lender: 'Example Lender',
      juniorProcessor: 'Jr Processor',
      seniorProcessor: 'Sr Processor',
      fundedAt: '2026-08-15T12:00:00.000Z',
      finalRevenue: 7250.5,
      firstPaymentAt: '2026-10-01T12:00:00.000Z',
      sixthPaymentAt: '2027-02-15T12:00:00.000Z',
    },
  ],
};

const pipelineStatusReport: ProcessingPipelineReport = {
  type: 'PIPELINE_STATUS',
  generatedAt: '2026-09-23T18:00:00.000Z',
  selectedStatuses: [ProcessingPipelineStatus.DOCS_OUT],
  includesRestrictedColumns: true,
  rows: [
    {
      pipelineLoanId: 'pipeline-status-1',
      bucket: 'Pipeline',
      rateLockRequested: true,
      assignmentDate: '2026-09-01T12:00:00.000Z',
      loanNumber: '11223344',
      borrowerName: 'Full Column Borrower',
      borrowerFirstName: 'Full Column',
      borrowerLastName: 'Borrower',
      loanOfficer: 'Loan Officer',
      juniorProcessor: 'Jr Processor',
      seniorProcessor: 'Sr Processor',
      state: 'FL',
      lender: 'Example Lender',
      leadSource: 'Referral',
      loanAmount: 425000,
      loanType: 'Conventional',
      pipelineStatus: ProcessingPipelineStatus.DOCS_OUT,
      statusChangedAt: '2026-09-20T12:00:00.000Z',
      daysInStatus: 3,
      pendingItems: 'Final docs',
      restructureNotes: 'Prior restructure note',
      titleStatus: 'RECEIVED',
      hoiStatus: 'ORDERED',
      appraisalNeeded: 'Yes',
      payoffStatus: 'RECEIVED',
      payoffExpiresAt: '2026-10-01T12:00:00.000Z',
      appraisalNotes: 'Rush appraisal',
      appraisalOrderedAt: '2026-09-02T12:00:00.000Z',
      appraisalScheduledAt: '2026-09-05T12:00:00.000Z',
      appraisalBackAt: '2026-09-08T12:00:00.000Z',
      cdSent: 'Yes',
      estimatedSigningAt: '2026-09-25T12:00:00.000Z',
      extraNotes: 'Ready for signing',
      rateLock: 'Yes',
      projectedRevenue: 8000,
      finalRevenue: 7750,
    },
  ],
};

describe('processing report workbook export', () => {
  it('escapes XML and preserves the report column order', () => {
    const workbook = buildProcessingReportWorkbook(report, {
      scopeLabel: 'Team A & Team B',
    });
    expect(workbook.content).toContain('A &amp; B &lt;Borrower&gt;');
    expect(workbook.content).toContain('Team A &amp; Team B');
    expect(workbook.content).not.toContain('A & B <Borrower>');
    expect(workbook.content.indexOf('Assignment Date')).toBeLessThan(
      workbook.content.indexOf('Arive #'),
    );
    expect(workbook.content.indexOf('Arive #')).toBeLessThan(
      workbook.content.indexOf('Borrower'),
    );
  });

  it('includes filters, frozen headers, native dates, and status styles', () => {
    const workbook = buildProcessingReportWorkbook(report);
    expect(workbook.content).toContain('<AutoFilter');
    expect(workbook.content).toContain('<FreezePanes/>');
    expect(workbook.content).toContain('ss:Type="DateTime"');
    expect(workbook.content).toContain('ss:StyleID="StatusGreen"');
    expect(workbook.mimeType).toContain('application/vnd.ms-excel');
  });

  it('builds a deterministic Excel filename', () => {
    expect(processingReportFilename(report)).toBe(
      'processing-last-touch-2026-09-18.xls',
    );
  });

  it('exports the funding date range and funding column order', () => {
    const workbook = buildProcessingReportWorkbook(fundingReport);
    expect(workbook.filename).toBe('processing-funding-2026-09-18.xls');
    expect(workbook.content).toContain(
      'Funded loans from 2026-08-01 through 2026-08-31.',
    );
    expect(workbook.content).toContain('Funded date range 2026-08-01 through 2026-08-31');
    expect(workbook.content.indexOf('Assigned')).toBeLessThan(
      workbook.content.indexOf('Arive #'),
    );
    expect(workbook.content.indexOf('Funded Date')).toBeLessThan(
      workbook.content.indexOf('Final Revenue'),
    );
    expect(workbook.content).toContain('ss:StyleID="DataEvenCurrency"');
    expect(workbook.content).toContain('ss:StyleID="DataEvenDateOnly"');
  });

  it('exports every pipeline data column in the status report', () => {
    const workbook = buildProcessingReportWorkbook(pipelineStatusReport);
    const orderedHeaders = [
      'Assignment Date',
      'Arive #',
      'Loan Officer',
      'First Name',
      'Last Name',
      'State',
      'Lender',
      'Lead Source',
      'Loan Amount',
      'Loan Type',
      'Jr Processor',
      'Sr Processor',
      'Pipeline Status',
      'Pending Items',
      'Restructure Notes',
      'Title',
      'HOI',
      'Appraisal?',
      'Payoff',
      'Payoff Expiration',
      'Days in Status',
      'Appraisal Notes',
      'Appraisal Ordered',
      'Appraisal Scheduled Date',
      'Appraisal Back',
      'CD Sent?',
      'Est. Signing',
      'Extra Notes',
      'Rate Lock',
      'Projected Revenue',
      'Final Revenue',
    ];
    let previousIndex = -1;
    for (const header of orderedHeaders) {
      const index = workbook.content.indexOf(
        `<Data ss:Type="String">${header}</Data>`,
      );
      expect(index).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }
  });

  it('keeps processor-restricted financial columns out of status exports', () => {
    const restrictedReport: ProcessingPipelineReport = {
      ...pipelineStatusReport,
      includesRestrictedColumns: false,
      rows: pipelineStatusReport.rows.map((row) => ({
        ...row,
        leadSource: null,
        loanAmount: null,
        projectedRevenue: null,
      })),
    };
    const workbook = buildProcessingReportWorkbook(restrictedReport);
    expect(workbook.content).not.toContain(
      '<Data ss:Type="String">Lead Source</Data>',
    );
    expect(workbook.content).not.toContain(
      '<Data ss:Type="String">Loan Amount</Data>',
    );
    expect(workbook.content).not.toContain(
      '<Data ss:Type="String">Projected Revenue</Data>',
    );
    expect(workbook.content).toContain(
      '<Data ss:Type="String">Final Revenue</Data>',
    );
  });
});
