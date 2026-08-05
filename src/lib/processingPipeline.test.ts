import { describe, expect, it } from 'vitest';
import { UserRole } from '@prisma/client';
import {
  addMonthsClamped,
  calculateDaysInStatus,
  getProcessingPipelineAccess,
  parseOptionalBoolean,
  parseOptionalMoney,
} from './processingPipeline';

describe('processing pipeline access', () => {
  it('scopes Loan Officers to a read-only mirror', () => {
    expect(getProcessingPipelineAccess(UserRole.LOAN_OFFICER)).toEqual({
      canView: true,
      canEdit: false,
      scope: 'OWN_LOANS',
    });
  });

  it('scopes Sr Processors to their editable assignments', () => {
    expect(getProcessingPipelineAccess(UserRole.PROCESSOR_SR)).toEqual({
      canView: true,
      canEdit: true,
      scope: 'ASSIGNED',
    });
  });

  it.each([
    UserRole.PROCESSOR_JR,
    UserRole.MANAGER,
    UserRole.ADMIN,
    UserRole.ADMIN_I,
    UserRole.ADMIN_II,
    UserRole.ADMIN_III,
  ])('gives %s editable company access', (role) => {
    expect(getProcessingPipelineAccess(role)).toEqual({
      canView: true,
      canEdit: true,
      scope: 'COMPANY',
    });
  });

  it('denies unrelated roles', () => {
    expect(getProcessingPipelineAccess(UserRole.DISCLOSURE_SPECIALIST).canView).toBe(false);
  });
});

describe('processing pipeline values', () => {
  it('calculates whole non-negative days in status', () => {
    expect(calculateDaysInStatus('2026-08-01T12:00:00.000Z', new Date('2026-08-05T11:59:59.000Z'))).toBe(3);
    expect(calculateDaysInStatus('2026-08-06T00:00:00.000Z', new Date('2026-08-05T00:00:00.000Z'))).toBe(0);
  });

  it('normalizes spreadsheet-style booleans and money', () => {
    expect(parseOptionalBoolean('YES')).toBe(true);
    expect(parseOptionalBoolean('0')).toBe(false);
    expect(parseOptionalBoolean('unknown')).toBeNull();
    expect(parseOptionalMoney('$12,345.67')).toBe(12345.67);
    expect(parseOptionalMoney('')).toBeNull();
  });

  it('calculates payment dates without rolling past short months', () => {
    expect(addMonthsClamped(new Date('2026-01-31T00:00:00.000Z'), 1).toISOString())
      .toBe('2026-02-28T00:00:00.000Z');
    expect(addMonthsClamped(new Date('2026-08-31T00:00:00.000Z'), 6).toISOString())
      .toBe('2027-02-28T00:00:00.000Z');
  });
});
