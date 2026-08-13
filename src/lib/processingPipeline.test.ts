import { describe, expect, it } from 'vitest';
import {
  ProcessingItemStatus,
  ProcessingPipelineStatus,
  UserRole,
} from '@prisma/client';
import {
  addMonthsClamped,
  calculateDaysInStatus,
  canEditProcessingPipelineMethod,
  getApprovedWithConditionsAt,
  getCdWarningStartsAt,
  getItemOrderedAt,
  getMortgageFirstPaymentDate,
  getProcessingPipelineAccess,
  getProcessingPipelineLeadSource,
  getProcessingPipelineLockedDefaults,
  isAppraisalBackOverdue,
  isCdSentOverdue,
  isConditionItemOverdue,
  isOrderedItemOverdue,
  isRateLockOverdueAfterAppraisal,
  isRateLockExpiring,
  isProcessingPipelineFieldLocked,
  normalizeProcessingLender,
  parseOptionalBoolean,
  parseOptionalMoney,
} from './processingPipeline';
import { canAccessPipelinePortal } from './pipelinePilot';

describe('processing pipeline access', () => {
  it('scopes Loan Officers to a read-only mirror', () => {
    expect(getProcessingPipelineAccess(UserRole.LOAN_OFFICER)).toEqual({
      canView: true,
      canEdit: false,
      scope: 'OWN_LOANS',
    });
  });

  it('gives LO Assistants read-only company visibility', () => {
    expect(canAccessPipelinePortal({ role: UserRole.LOA })).toBe(true);
    expect(getProcessingPipelineAccess(UserRole.LOA)).toEqual({
      canView: true,
      canEdit: false,
      scope: 'COMPANY',
    });
  });

  it('scopes Sr Processors to their editable assignments', () => {
    expect(getProcessingPipelineAccess(UserRole.PROCESSOR_SR)).toEqual({
      canView: true,
      canEdit: true,
      scope: 'ASSIGNED',
    });
  });

  it('scopes Jr Processors to their assigned processor groups', () => {
    expect(getProcessingPipelineAccess(UserRole.PROCESSOR_JR)).toEqual({
      canView: true,
      canEdit: true,
      scope: 'ASSIGNED',
    });
  });

  it.each([
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

  it('lets Loan Officers edit only self-processed and third-party loans', () => {
    expect(canEditProcessingPipelineMethod(UserRole.LOAN_OFFICER, 'SELF_PROCESSED')).toBe(true);
    expect(canEditProcessingPipelineMethod(UserRole.LOAN_OFFICER, 'THIRD_PARTY')).toBe(true);
    expect(canEditProcessingPipelineMethod(UserRole.LOAN_OFFICER, 'IN_HOUSE')).toBe(false);
    expect(canEditProcessingPipelineMethod(UserRole.LOAN_OFFICER, null)).toBe(false);
  });
});

describe('processing pipeline locked defaults', () => {
  it('uses the lead vendor as the pipeline source for lead buys', () => {
    expect(getProcessingPipelineLeadSource('Lead Buy', 'Lead Point')).toBe('Lead Point');
    expect(getProcessingPipelineLeadSource('Mailer', 'Ignored Vendor')).toBe('Mailer');
    expect(getProcessingPipelineLeadSource('', '')).toBeNull();
  });

  it('normalizes and recognizes supported lender name variants', () => {
    expect(normalizeProcessingLender('  Figure-Lending, LLC ')).toBe('FIGURE LENDING LLC');
    expect(getProcessingPipelineLockedDefaults('Aven Financial', null)?.kind)
      .toBe('SPECIAL_LENDER');
    expect(getProcessingPipelineLockedDefaults('NFTYDoor', null)).toBeNull();
  });

  it('uses special lender defaults ahead of third-party defaults', () => {
    const defaults = getProcessingPipelineLockedDefaults('NFTY Home', 'THIRD_PARTY');
    expect(defaults).toMatchObject({
      kind: 'SPECIAL_LENDER',
      values: {
        titleStatus: ProcessingItemStatus.RECEIVED,
        payoffStatus: ProcessingItemStatus.RECEIVED,
        hoiStatus: ProcessingItemStatus.RECEIVED,
        appraisalNeeded: false,
        cdSent: true,
        rateLock: true,
      },
    });
    expect(isProcessingPipelineFieldLocked(
      'rateLock',
      'NFTY Home',
      'THIRD_PARTY',
    )).toBe(true);
  });

  it('locks third-party condition items to N/A', () => {
    const defaults = getProcessingPipelineLockedDefaults(
      'Other Lender',
      'THIRD_PARTY',
    );
    expect(defaults).toMatchObject({
      kind: 'THIRD_PARTY',
      values: {
        titleStatus: ProcessingItemStatus.NOT_APPLICABLE,
        payoffStatus: ProcessingItemStatus.NOT_APPLICABLE,
        hoiStatus: ProcessingItemStatus.NOT_APPLICABLE,
      },
    });
    expect(isProcessingPipelineFieldLocked(
      'appraisalNeeded',
      'Other Lender',
      'THIRD_PARTY',
    )).toBe(false);
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

  it('sets mortgage first payments to the first of the second following month', () => {
    expect(
      getMortgageFirstPaymentDate(
        new Date('2026-08-15T12:00:00.000Z'),
      ).toISOString(),
    ).toBe('2026-10-01T12:00:00.000Z');
    expect(
      getMortgageFirstPaymentDate(
        new Date('2026-12-31T12:00:00.000Z'),
      ).toISOString(),
    ).toBe('2027-02-01T12:00:00.000Z');
  });

  it('warns three days before a locked rate expires', () => {
    const now = new Date('2026-08-10T12:00:00.000Z');
    expect(isRateLockExpiring(true, '2026-08-13T12:00:00.000Z', now)).toBe(true);
    expect(isRateLockExpiring(true, '2026-08-13T12:00:01.000Z', now)).toBe(false);
    expect(isRateLockExpiring(false, '2026-08-11T12:00:00.000Z', now)).toBe(false);
  });

  it('warns when a rate remains unlocked five days after appraisal back', () => {
    const now = new Date('2026-08-10T12:00:00.000Z');
    expect(isRateLockOverdueAfterAppraisal(false, '2026-08-05T12:00:00.000Z', now)).toBe(true);
    expect(isRateLockOverdueAfterAppraisal(false, '2026-08-05T12:00:01.000Z', now)).toBe(false);
    expect(isRateLockOverdueAfterAppraisal(true, '2026-08-01T12:00:00.000Z', now)).toBe(false);
  });

  it('warns for an unsent CD two days after Rate Lock is enabled', () => {
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

  it('warns two days after Payoff or HOI remains ordered', () => {
    const now = new Date('2026-08-10T12:00:00.000Z');
    expect(isOrderedItemOverdue(
      '2026-08-08T12:00:00.000Z',
      ProcessingItemStatus.ORDERED,
      now,
    )).toBe(true);
    expect(isOrderedItemOverdue(
      '2026-08-01T12:00:00.000Z',
      ProcessingItemStatus.RECEIVED,
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

  it('starts the CD timer once when Rate Lock is enabled', () => {
    const previous = new Date('2026-08-09T00:00:00.000Z');
    const now = new Date('2026-08-10T12:00:00.000Z');
    expect(getCdWarningStartsAt(true, null, now)).toBe(now);
    expect(getCdWarningStartsAt(true, previous, now)).toBe(previous);
    expect(getCdWarningStartsAt(false, previous, now)).toBeNull();
  });

  it('records ordered timestamps until the item leaves Ordered', () => {
    const previous = new Date('2026-08-09T00:00:00.000Z');
    const now = new Date('2026-08-10T12:00:00.000Z');
    expect(getItemOrderedAt(ProcessingItemStatus.ORDERED, null, now)).toBe(now);
    expect(getItemOrderedAt(ProcessingItemStatus.ORDERED, previous, now)).toBe(previous);
    expect(getItemOrderedAt(ProcessingItemStatus.RECEIVED, previous, now)).toBeNull();
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
