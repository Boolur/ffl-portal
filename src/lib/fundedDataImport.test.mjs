import { describe, expect, it } from 'vitest';
import {
  canonicalLeadSource,
  canonicalLender,
  chooseCanonicalFundedRows,
  normalizeAriveNumber,
  parseFundedDate,
  parseRevenue,
  payrollLeadProvidedByFor,
  payrollLeadSourceFor,
  resolveFundedOfficerName,
} from './fundedDataImport.mjs';

function row(overrides = {}) {
  return {
    sourceSheet: 'Sheet1',
    sourceRow: 2,
    sourceOrder: 1,
    rawAriveNumber: '17000000',
    ariveNumber: '17000000',
    loanOfficer: 'Adam Agahi',
    assignedAt: new Date('2026-01-10T12:00:00.000Z'),
    borrowerName: 'Sample Borrower',
    leadSource: 'Referral',
    rawLeadSource: 'Referall',
    propertyState: 'CA',
    loanType: 'Conventional',
    lender: 'UWM',
    senior: null,
    fundedAt: new Date('2026-02-10T12:00:00.000Z'),
    finalRevenue: 5000,
    ...overrides,
  };
}

describe('funded data normalization', () => {
  it('accepts only canonical eight-digit ARIVE numbers', () => {
    expect(normalizeAriveNumber(17000000)).toBe('17000000');
    expect(normalizeAriveNumber(' 1700 0000 ')).toBe('17000000');
    expect(normalizeAriveNumber('Figure')).toBeNull();
    expect(normalizeAriveNumber(65)).toBeNull();
  });

  it('applies the approved officer aliases', () => {
    expect(resolveFundedOfficerName('Arash Agahi')).toBe('Adam Agahi');
    expect(resolveFundedOfficerName('Spencer Simmons')).toBe('Sarah Behl');
    expect(resolveFundedOfficerName('Ryan Haward')).toBe('Nick Yebisu');
  });

  it('normalizes common lender and lead-source variants', () => {
    expect(canonicalLender(' figure ')).toBe('FIGURE');
    expect(canonicalLender('Nifty')).toBe('NFTY');
    expect(canonicalLeadSource('REFFERAL')).toBe('Referral');
    expect(canonicalLeadSource('FRU')).toBe('Lead Buy - FreeRateUpdate');
    expect(payrollLeadSourceFor('WARM XFER')).toBe('WARM_TRANSFER');
    expect(payrollLeadProvidedByFor('Self Gen')).toBe('SELF_SOURCED');
  });

  it('parses Excel-style dates, malformed dates, and currency', () => {
    expect(parseFundedDate(46006)?.toISOString()).toBe('2025-12-15T12:00:00.000Z');
    expect(parseFundedDate('6//30/22026')?.toISOString()).toBe('2026-06-30T12:00:00.000Z');
    expect(
      parseFundedDate('Funded 10/29', new Date('2025-10-03T12:00:00.000Z'))?.toISOString(),
    ).toBe('2025-10-29T12:00:00.000Z');
    expect(parseRevenue('$4,500.25')).toBe(4500.25);
  });
});

describe('funded data deduplication', () => {
  it('keeps the latest funded row when duplicate values conflict', () => {
    const earlier = row();
    const later = row({
      sourceRow: 3,
      sourceOrder: 2,
      fundedAt: new Date('2026-03-10T12:00:00.000Z'),
      finalRevenue: 6000,
    });
    const result = chooseCanonicalFundedRows([earlier, later]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].finalRevenue).toBe(6000);
    expect(result.discardedDuplicates).toEqual([
      expect.objectContaining({ ariveNumber: '17000000', conflict: true }),
    ]);
  });

  it('quarantines malformed required values', () => {
    const result = chooseCanonicalFundedRows([
      row({ rawAriveNumber: 'Figure', ariveNumber: null }),
      row({ sourceRow: 3, sourceOrder: 2, finalRevenue: null }),
    ]);
    expect(result.rows).toHaveLength(0);
    expect(result.invalid).toHaveLength(2);
  });
});
