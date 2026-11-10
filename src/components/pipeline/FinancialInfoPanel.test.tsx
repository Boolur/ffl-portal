import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/ariveSyncPresentation', async () => import('../../lib/ariveSyncPresentation'));
import { projectAriveApplicationSnapshot, type AriveApplicationView } from '../../lib/ariveApplicationSnapshot';
import { AriveFinancialInfo, AriveLoanTermsCard } from './FinancialInfoPanel';

describe('application financial information', () => {
  it('shows a clear unavailable state instead of fabricating figures from an old submission', () => {
    const html = renderToStaticMarkup(createElement(AriveFinancialInfo, {}));
    expect(html).toContain('No verified Arive financial snapshot');
    expect(html).not.toContain('$0');
  });
  it('renders actual amounts, zero values, missing values and employer dates independently', () => {
    const application: AriveApplicationView = { ...projectAriveApplicationSnapshot({ estCashToClose: 12345, downPayment: 0, ltv: 80, backEndDTI: 35.5,
      employment: [{ employerName: 'Synthetic employer', monthlyIncome: 5000, startDate: '2026-11-10', isPrimaryBorrower: false }] }), syncedAt: '2026-11-10T18:00:00Z' };
    const html = renderToStaticMarkup(createElement(AriveFinancialInfo, { application }));
    for (const text of ['$12,345.00', '$0.00', '80%', '35.5%', '$5,000.00', 'Synthetic employer', '11/10/26', 'Co-borrower', 'Not provided', 'Last successful sync']) expect(html).toContain(text);
    expect(html).not.toContain('Download 1003');
  });
  it('keeps source loan terms in a separate card without assuming undocumented term units', () => {
    const application: AriveApplicationView = { ...projectAriveApplicationSnapshot({ lenderName: 'Synthetic lender', noteRate: 6.125, amortizationTerm: 360 }), syncedAt: null };
    const html = renderToStaticMarkup(createElement(AriveLoanTermsCard, { application }));
    expect(html).toContain('Loan terms from Arive'); expect(html).toContain('Synthetic lender'); expect(html).toContain('6.125%');
    expect(html).toContain('360'); expect(html).not.toContain('360 months');
    expect(renderToStaticMarkup(createElement(AriveLoanTermsCard, {}))).toBe('');
  });
});
