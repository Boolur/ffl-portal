import { describe, expect, it } from 'vitest';
import {
  ProcessingItemStatus,
  ProcessingPipelineStatus,
  UserRole,
} from '@prisma/client';
import {
  addMonthsClamped,
  calculateDaysInStatus,
  getApprovedWithConditionsAt,
  getCdWarningStartsAt,
  getProcessingPipelineAccess,
  isAppraisalBackOverdue,
  isCdSentOverdue,
  isConditionItemOverdue,
  isRateLockExpiring,
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

  it('warns three days before a locked rate expires', () => {
    const now = new Date('2026-08-10T12:00:00.000Z');
    expect(isRateLockExpiring(true, '2026-08-13T12:00:00.000Z', now)).toBe(true);
    expect(isRateLockExpiring(true, '2026-08-13T12:00:01.000Z', now)).toBe(false);
    expect(isRateLockExpiring(false, '2026-08-11T12:00:00.000Z', now)).toBe(false);
  });

  it('warns for an unsent CD two days after both prerequisites complete', () => {
    const now = new Date('2026-08-10T12:00:00.000Z');
    expect(isCdSentOverdue(false, '2026-08-08T12:00:00.000Z', now)).toBe(true);
    expect(isCdSentOverdue(false, '2026-08-08T12:00:01.000Z', now)).toBe(false);
    expect(isCdSentOverdue(true, '2026-08-01T12:00:00.000Z', now)).toBe(false);
  });

  it('warns only while condition items remain not started', () => {
    const now = new Date('2026-08-10T12:00:00.000Z');
    expect(isConditionItemOverdue(
      '2026-08-08T12:00:00.000Z',
      ProcessingItemStatus.NOT_STARTED,
      now,
    )).toBe(true);
    expect(isConditionItemOverdue(
      '2026-08-01T12:00:00.000Z',
      ProcessingItemStatus.ORDERED,
      now,
    )).toBe(false);
  });

  it('warns seven days after appraisal order until a back date exists', () => {
    const now = new Date('2026-08-10T12:00:00.000Z');
    expect(isAppraisalBackOverdue('2026-08-03T12:00:00.000Z', null, now)).toBe(true);
    expect(isAppraisalBackOverdue(
      '2026-08-01T12:00:00.000Z',
      '2026-08-09T12:00:00.000Z',
      now,
    )).toBe(false);
  });

  it('starts the CD timer only when both prerequisites are complete', () => {
    const now = new Date('2026-08-10T12:00:00.000Z');
    expect(getCdWarningStartsAt(
      '2026-08-09T00:00:00.000Z',
      true,
      '2026-09-01T00:00:00.000Z',
      now,
    )).toBe(now);
    expect(getCdWarningStartsAt(null, true, '2026-09-01T00:00:00.000Z', now)).toBeNull();
    expect(getCdWarningStartsAt('2026-08-09T00:00:00.000Z', false, null, now)).toBeNull();
  });

  it('records each Approved with Conditions transition without clearing history later', () => {
    const previous = new Date('2026-08-01T12:00:00.000Z');
    const now = new Date('2026-08-10T12:00:00.000Z');
    expect(getApprovedWithConditionsAt(
      ProcessingPipelineStatus.APPROVED_WITH_CONDITIONS,
      previous,
      now,
    )).toBe(now);
    expect(getApprovedWithConditionsAt(
      ProcessingPipelineStatus.RE_SUB,
      previous,
      now,
    )).toBe(previous);
  });
});
