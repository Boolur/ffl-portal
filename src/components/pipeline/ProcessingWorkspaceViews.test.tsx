import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/ariveSyncPresentation', async () => import('../../lib/ariveSyncPresentation'));
import { projectAriveApplicationSnapshot, readAriveApplicationView, type AriveApplicationView } from '../../lib/ariveApplicationSnapshot';
import { BorrowerInfoView, LoanPropertyView, type ProcessingWorkspaceDetails } from './ProcessingWorkspaceViews';

function details(application?: AriveApplicationView | null): ProcessingWorkspaceDetails {
  // The two views consume these groups; action authorization is tested separately.
  return {
    borrower: { firstName: 'Portal', lastName: 'Applicant', name: 'Portal Applicant', phone: '2025550190', email: 'portal@example.test', coBorrower: { firstName: null, lastName: null, phone: null, email: null } },
    loan: { loanType: 'Conventional', purpose: 'Purchase', program: 'Portal program', channel: 'Portal channel', loanNumber: '12345678', leadSource: null, amount: 100000, lender: null, cashBack: null, projectedRevenue: null },
    property: { address: 'Original BISU address', state: 'CA', occupancy: 'PrimaryResidence', estimatedValue: 250000, yearBuilt: 1990, yearAcquired: 2020, titleHeldAs: null, unit: null },
    ownership: { primaryLoanOfficer: null, secondaryLoanOfficer: null, seniorProcessor: null, juniorProcessor: null, processingMethod: null },
    ariveApplication: application,
  } as unknown as ProcessingWorkspaceDetails;
}

describe('documented Arive application workspace fields', () => {
  it('keeps current Arive contacts within their applicant cards and the original BISU contacts separately labeled', () => {
    const application: AriveApplicationView = { ...projectAriveApplicationSnapshot({ loanBorrowers: [
      { applicantType: 'Borrower', borrowerPairLoanAppSequence: 1, firstName: 'Ada', lastName: 'Primary', nickName: 'A', emailAddressText: 'ada@example.test', mobilePhone10digit: '2025550100', workPhone: '2025550101', homePhone: '2025550102', posAppSubmissionDate: '2026-11-12', currentResidence: { addressLineText: '123 Primary Residence', durationTermMonths: 24 } },
      { applicantType: 'CoBorrower', borrowerPairLoanAppSequence: 1, firstName: 'Bea', lastName: 'Secondary', emailAddressText: 'bea@example.test', mobilePhone10digit: '2025550110', currentResidence: { addressLineText: '456 Secondary Residence' } },
    ] }), syncedAt: null };
    const html = renderToStaticMarkup(createElement(BorrowerInfoView, { details: details(application) }));
    const primary = html.slice(html.indexOf('Ada Primary'), html.indexOf('Bea Secondary'));
    const secondary = html.slice(html.indexOf('Bea Secondary'), html.indexOf('Original BISU submission contacts'));
    for (const text of ['ada@example.test', '2025550100', '2025550101', '2025550102', '123 Primary Residence', '11/12/26']) expect(primary).toContain(text);
    expect(primary).not.toContain('bea@example.test'); expect(primary).not.toContain('portal@example.test');
    expect(secondary).toContain('bea@example.test'); expect(secondary).toContain('456 Secondary Residence'); expect(secondary).not.toContain('ada@example.test');
    expect(html).toContain('Borrower · Application 1 · Arive'); expect(html).toContain('Co-borrower · Application 1 · Arive');
    expect(html.indexOf('Original BISU submission contacts')).toBeGreaterThan(html.indexOf('Bea Secondary'));
    expect(html).toContain('Primary borrower · BISU'); expect(html).toContain('portal@example.test');
  });
  it('keeps BISU contacts usable when Arive has no applicant details and does not backfill missing Arive contacts from BISU', () => {
    const unavailable = renderToStaticMarkup(createElement(BorrowerInfoView, { details: details(null) }));
    expect(unavailable).toContain('Portal Applicant'); expect(unavailable).not.toContain('Applicant details from Arive');
    const oldApplication = readAriveApplicationView({ application: { version: 1, applicants: [{ role: 'Borrower', firstName: 'Original', lastName: 'Arive' }] } }, null);
    const old = renderToStaticMarkup(createElement(BorrowerInfoView, { details: details(oldApplication) }));
    const arive = old.slice(old.indexOf('Original Arive'), old.indexOf('Original BISU submission contacts'));
    expect(arive).toContain('Not provided'); expect(arive).not.toContain('portal@example.test'); expect(arive).not.toContain('2025550190');
  });
  it('shows the documented property contract, value, county and purchase date without relabeling BISU history as Arive', () => {
    const application: AriveApplicationView = { ...projectAriveApplicationSnapshot({ purchasePriceOrEstimatedValue: 800000, purchaseDate: '2026-11-12', subjectProperty: {
      addressLineText: '123 Current Arive Street', city: 'Sample', state: 'CA', county: 'Synthetic County', postalCode: '900000001', salesContractAmt: 750000, financedUnitCount: 2,
    } }), syncedAt: null };
    const html = renderToStaticMarkup(createElement(LoanPropertyView, { details: details(application) }));
    for (const text of ['123 Current Arive Street', 'Synthetic County', '90000-0001', 'Sales contract amount', '$750,000', 'Purchase price / estimated value', '$800,000', 'Purchase date', '11/12/26', 'Units financed']) expect(html).toContain(text);
    expect(html).not.toContain('Original BISU address');
    const portalSection = html.slice(html.indexOf('Portal submission details'));
    expect(portalSection).toContain('1990'); expect(portalSection).toContain('2020'); expect(portalSection).toContain('Original BISU figures');
  });
});
