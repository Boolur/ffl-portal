import { describe, expect, it } from 'vitest';
import { ariveRouteAfterApply, ownsAriveRoute, planAriveRolloutSync, type AriveRolloutCurrent } from './arivePipelineMapping';
const date = (day: string) => new Date(day);
const now = date('2026-11-12T20:00:00Z');
function current(extra: Partial<AriveRolloutCurrent> = {}): AriveRolloutCurrent {
  return { sheet: 'PIPELINE', pipelineStatus: 'PENDING_APPROVAL', statusChangedAt: date('2026-10-01'), movedAt: null, archivedAt: null, archivedById: null, version: 3,
    titleStatus: 'NOT_STARTED', payoffStatus: 'NOT_STARTED', hoiStatus: 'NOT_STARTED', payoffOrderedAt: null, hoiOrderedAt: null,
    appraisalNeeded: null, appraisalOrderedAt: null, appraisalScheduledAt: null, appraisalBackAt: null,
    cdSent: false, cdWarningStartsAt: null, rateLock: false, rateLockExpiresAt: null, rateLockConfirmedAt: null,
    rateLockRequestedAt: null, rateLockRequestedById: null, approvedWithConditionsAt: null, fundedAt: null,
    estimatedSigningAt: null, payoffExpiresAt: null, firstPaymentAt: null, sixthPaymentAt: null, ...extra };
}
function plan(stage: string, row = current(), extra: Partial<Parameters<typeof planAriveRolloutSync>[0]> = {}) {
  return planAriveRolloutSync({ details: { currentLoanStatus: { status: stage, date: '2026-11-10' }, archiveIndicator: false, loanStatusHistory: [] },
    trackers: { loanTrackers: [] }, current: row, now, everFunded: false, routingProvenance: {}, generation: 1, ...extra });
}
function suspended() {
  const before = current(); const p = plan('SUSPENDED', before); const after = { ...before, ...p.patch, version: 4 };
  return { after, provenance: ariveRouteAfterApply(before, p, {}, 1, 4) };
}
function archived() {
  const before = current(); const p = plan('APPLICATION_INTAKE', before, { details: { archiveIndicator: false, currentLoanStatus: { status: 'APPLICATION_INTAKE', adverseReason: 'APP_WITHDRAWN_BY_BORROWER' } } });
  const after = { ...before, ...p.patch, version: 4 };
  return { after, provenance: ariveRouteAfterApply(before, p, {}, 1, 4) };
}
describe('canonical Arive routing provenance and financial invariants', () => {
  it.each(['APPLICATION_INTAKE', 'QUALIFICATION', 'PREAPPROVED', 'LOAN_SETUP', 'DISCLOSURE_SENT', 'DOCS_SIGNED'])('returns an unchanged sync-owned restructure at %s', stage => {
    const { after, provenance } = suspended();
    const result = plan(stage, after, { routingProvenance: provenance });
    expect(result.source.stage).toBe(stage); expect(result.patch.sheet).toBe('PIPELINE');
    expect(result.patch.pipelineStatus).toBe(stage === 'DOCS_SIGNED' ? 'DOCS_OUT' : 'PENDING_APPROVAL');
    expect(ariveRouteAfterApply(after, result, provenance, 1, 5)).toBeNull();
  });
  it('restores only the exact sync archive, without deleting record history', () => {
    const { after, provenance } = archived(); const result = plan('UNDERWRITING_SUBMITTED', after, { routingProvenance: provenance });
    expect(result.patch).toMatchObject({ archivedAt: null, pipelineStatus: 'SUBBED_TO_UW' });
    expect(result.patch).not.toHaveProperty('archivedById');
  });
  it.each(['version', 'actor', 'generation', 'date'])('refuses restoration after %s no longer matches provenance', change => {
    const { after, provenance } = archived();
    if (change === 'version') after.version++;
    if (change === 'actor') after.archivedById = 'manager';
    if (change === 'date') after.archivedAt = date('2026-11-13');
    const result = plan('QUALIFICATION', after, { routingProvenance: provenance, generation: change === 'generation' ? 2 : 1 });
    expect(result.patch).not.toHaveProperty('archivedAt'); expect(result.patch).not.toHaveProperty('sheet');
  });
  it.each(['UNFAMILIAR', 'archive', 'unknown adverse'])('does not restore when activity is ambiguous: %s', kind => {
    const { after, provenance } = archived();
    const details = { currentLoanStatus: { status: kind === 'UNFAMILIAR' ? kind : 'QUALIFICATION', adverseReason: kind === 'unknown adverse' ? 'NEW_REASON' : '' }, archiveIndicator: kind === 'archive' };
    expect(plan('QUALIFICATION', after, { routingProvenance: provenance, details }).patch).not.toHaveProperty('archivedAt');
  });
  it('keeps a manual restructure in place even when Arive reaches underwriting', () => {
    expect(plan('UNDERWRITING_SUBMITTED', current({ sheet: 'RESTRUCTURE', pipelineStatus: 'SUSPENDED_RESTRUCTURE' })).patch).not.toHaveProperty('sheet');
  });
  it.each([undefined, null, 'false'])('retains routing when archiveIndicator is %s rather than confirmed false', archiveIndicator => {
    const { after, provenance } = archived();
    const result = plan('QUALIFICATION', after, { routingProvenance: provenance, details: { archiveIndicator, currentLoanStatus: { status: 'QUALIFICATION', date: '2026-11-10' } } });
    expect(result.patch).not.toHaveProperty('archivedAt'); expect(result.patch).not.toHaveProperty('sheet');
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'ARCHIVE_INDICATOR_UNAVAILABLE' }));
  });
  it('moves a previously nonfunded sync archive to Fundings on actual funding', () => {
    const { after, provenance } = archived(); const result = plan('LOAN_FUNDED', after, { routingProvenance: provenance });
    expect(result.patch).toMatchObject({ archivedAt: null, sheet: 'FUNDING', fundedAt: date('2026-11-10') });
    expect(result.everFunded).toBe(true);
  });
  it('retains sticky funding protection even when the current folder and upstream history no longer show funding', () => {
    const { after, provenance } = archived(); const result = plan('QUALIFICATION', after, { routingProvenance: provenance, everFunded: true });
    expect(result.patch).not.toHaveProperty('archivedAt'); expect(result.patch).not.toHaveProperty('sheet'); expect(result.everFunded).toBe(true);
  });
  it('fills missing payment dates independently using existing BISU calendar rules', () => {
    const row = current({ firstPaymentAt: date('2027-01-01T12:00:00Z') });
    const result = plan('LOAN_FUNDED', row);
    expect(result.patch).not.toHaveProperty('firstPaymentAt'); expect(result.patch.sixthPaymentAt).toEqual(date('2027-05-10'));
    expect(result.managed).not.toHaveProperty('firstPaymentAt'); expect(result.managed).not.toHaveProperty('sixthPaymentAt');
  });
  it('keeps populated dates and flags disagreement after a funding correction', () => {
    const result = plan('LOAN_FUNDED', current({ firstPaymentAt: date('2026-12-01'), sixthPaymentAt: date('2027-04-01') }));
    expect(result.patch).not.toHaveProperty('firstPaymentAt'); expect(result.patch).not.toHaveProperty('sixthPaymentAt');
    expect(result.issues.filter(i => i.code === 'PAYMENT_DATE_DISAGREEMENT').map(i => i.field)).toEqual(['firstPaymentAt', 'sixthPaymentAt']);
  });
  it('does not calculate payment dates from a commission date when funding is absent', () => {
    const result = plan('COMMISSION_PAID'); expect(result.patch).not.toHaveProperty('firstPaymentAt'); expect(result.patch).not.toHaveProperty('sixthPaymentAt');
  });
  it('carries route ownership across its own unrelated sync revision', () => {
    const { after, provenance } = suspended(); const result = plan('SUSPENDED', after, { routingProvenance: provenance });
    const next = ariveRouteAfterApply(after, result, provenance, 1, 5);
    expect(ownsAriveRoute({ ...after, version: 5 }, next, 1)).toBe(true);
  });
});
