import { describe, expect, it } from 'vitest';
import {
  canonicalLender,
  canonicalLoanType,
  chooseCanonicalPipelineRows,
  normalizeAppraisal,
  normalizeAriveNumber,
  normalizeItemStatus,
  normalizePipelineStatus,
  normalizeYesNo,
  parsePipelineDate,
} from './processingPipelineBackfill.mjs';

function row(overrides = {}) {
  return {
    sourceSheet: 'Sheet1',
    sourceRow: 2,
    rawAriveNumber: '17300000',
    ariveNumber: '17300000',
    borrowerName: 'Sample Borrower',
    assignedAt: new Date('2026-08-01T12:00:00.000Z'),
    pipelineStatus: 'APPROVED_WITH_CONDITIONS',
    titleStatus: 'RECEIVED',
    payoffStatus: 'ORDERED',
    hoiStatus: 'NOT_STARTED',
    appraisalNeeded: true,
    appraisalTbd: false,
    ...overrides,
  };
}

describe('processing pipeline workbook normalization', () => {
  it('normalizes the workbook status variants and misspellings', () => {
    expect(normalizePipelineStatus('Submitted to UW')).toBe('SUBBED_TO_UW');
    expect(normalizePipelineStatus('Approved with Conditions')).toBe(
      'APPROVED_WITH_CONDITIONS',
    );
    expect(normalizeItemStatus('✅Recieved ')).toBe('RECEIVED');
    expect(normalizeItemStatus('RECEVEID')).toBe('RECEIVED');
    expect(normalizeItemStatus('🟡 Ordered')).toBe('ORDERED');
    expect(normalizeItemStatus('n/a')).toBe('NOT_APPLICABLE');
  });

  it('normalizes yes/no and preserves TBD appraisal intent', () => {
    expect(normalizeYesNo('YES')).toBe(true);
    expect(normalizeYesNo('N')).toBe(false);
    expect(normalizeYesNo('')).toBeNull();
    expect(normalizeAppraisal('TBD')).toBe('TBD');
    expect(normalizeAppraisal('Junior')).toBe('TBD');
  });

  it('canonicalizes lender, loan type, ARIVE, and dates', () => {
    expect(canonicalLender('SUN WEST')).toBe('Sun West');
    expect(canonicalLender('Kind')).toBe('KIND');
    expect(canonicalLoanType('CONV')).toBe('Conventional');
    expect(canonicalLoanType('VA cashout')).toBe('VA Cashout');
    expect(normalizeAriveNumber(17300000)).toBe('17300000');
    expect(parsePipelineDate('8/12/26')?.toISOString()).toBe(
      '2026-08-12T12:00:00.000Z',
    );
  });
});

describe('processing pipeline workbook safety', () => {
  it('quarantines every row in a duplicate ARIVE group', () => {
    const result = chooseCanonicalPipelineRows([
      row(),
      row({ sourceRow: 3, borrowerName: 'Different Borrower' }),
    ]);
    expect(result.rows).toHaveLength(0);
    expect(result.invalid).toHaveLength(2);
    expect(result.duplicates).toEqual([
      expect.objectContaining({ ariveNumber: '17300000' }),
    ]);
  });

  it('quarantines unsupported appraisal and status values', () => {
    const result = chooseCanonicalPipelineRows([
      row({
        pipelineStatus: null,
        appraisalNeeded: null,
        appraisalTbd: false,
      }),
    ]);
    expect(result.rows).toHaveLength(0);
    expect(result.invalid[0].reasons).toEqual([
      'Pipeline Status is unsupported',
      'Appraisal must be Yes, No, or TBD',
    ]);
  });
});
