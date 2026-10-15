import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { SubmissionDetailSections, formatSubmissionValue, submissionSections } from './SubmissionDetailSections';

const values = { borrowerFirstName: 'Taylor', borrowerLastName: 'Example', borrowerPhone: '555-0100', borrowerEmail: 'taylor.long.email@example.test', coBorrowerFirstName: 'Jordan', coBorrowerLastName: 'Example', coBorrowerPhone: '555-0101', coBorrowerEmail: 'jordan@example.test', employerName: 'Example Manufacturing Company', employerAddress: '100 Industrial Way, Sample City, CA', employerDurationLineOfWork: '12 years', loanAmount: '325000', cashBack: '0', projectedRevenue: '4500', loanType: 'Conventional', loanProgram: 'Rate and Term', loanPurpose: 'Refinance', preApproved: 'true', investor: 'Example investor', channel: 'Broker', aus: 'DU', creditReportType: 'Hard Report', creditReportNotesExp: 'Confirm the updated account balance before underwriting.\nLO will provide the supporting statement.', notesGoals: 'Lower the monthly payment while retaining the existing loan term.', propertyStreet: '100 Example Street', propertyCity: 'Sample City', propertyState: 'CA', propertyZip: '90210', homeValue: '525000', yearAquired: '2019', propertyOccupancy: 'Primary residence', titleCompany: 'Example Title', appraisalNeeded: 'false', processingDocumentTaskId: 'internal-id-must-not-render', loanOfficerId: 'private-user-id', loanOfficer: 'Example LO' };
const rows = Object.entries(values).map(([key, value]) => ({ key, label: key, value }));

describe('mortgage submission field organization', () => {
  it('keeps both applicants in distinct sections with consistent field order', () => {
    const html = renderToStaticMarkup(<SubmissionDetailSections tab="borrower" rows={rows} />);
    const primary = html.slice(html.indexOf('Primary borrower'), html.indexOf('Co-borrower'));
    expect(primary).toContain('Taylor'); expect(primary).not.toContain('Jordan');
    expect(html.slice(html.indexOf('Co-borrower'))).toContain('Jordan');
    expect(primary.indexOf('First name')).toBeLessThan(primary.indexOf('Last name'));
    expect(html).not.toContain('Credit report');
  });
  it('places title, valuation, appraisal, and credit in their intended tabs without internal references', () => {
    const property = renderToStaticMarkup(<SubmissionDetailSections tab="property" rows={rows} />);
    const loan = renderToStaticMarkup(<SubmissionDetailSections tab="loan" rows={rows} />);
    expect(property).toContain('Title and ownership'); expect(property).toContain('$525,000.00'); expect(property).toContain('2019');
    expect(property).not.toContain('Experian notes');
    expect(loan).toContain('Underwriting and credit'); expect(loan).toContain('$0.00');
    expect(loan).not.toContain('private-user-id'); expect(loan).not.toContain('internal-id-must-not-render');
    expect(loan).not.toContain('Year acquired');
  });
  it('handles absent co-borrowers, zero amounts, booleans, and invalid numeric input honestly', () => {
    expect(renderToStaticMarkup(<SubmissionDetailSections tab="borrower" rows={[]} />)).toContain('No co-borrower information');
    expect(formatSubmissionValue('0', 'money')).toBe('$0.00');
    expect(formatSubmissionValue('false')).toBe('No');
    expect(formatSubmissionValue('unknown', 'money')).toBe('unknown');
    expect(formatSubmissionValue('')).toBe('');
    const keys = Object.values(submissionSections).flatMap(sections => sections.flatMap(section => section.fields.flatMap(([keys]) => keys.split('|'))));
    expect(new Set(keys).size).toBe(keys.length);
  });
  if (process.env.RENDER_SUBMISSION_WORKSPACE === '1') it('renders synthetic tab previews', () => {
    mkdirSync('outputs/submission-workspace', { recursive: true });
    for (const tab of ['borrower', 'property', 'loan'] as const) {
      const html = renderToStaticMarkup(<SubmissionDetailSections tab={tab} rows={rows} />);
      writeFileSync(`outputs/submission-workspace/${tab}.html`, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="preview.css"></head><body class="bg-slate-100 p-5"><main class="mx-auto max-w-[1400px]">${html}</main></body></html>`);
    }
  });
});
