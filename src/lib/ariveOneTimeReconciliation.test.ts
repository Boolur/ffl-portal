import { describe, expect, it } from 'vitest';
import { planAriveOneTimeReconciliation, type AriveOneTimeReconciliationInput } from './ariveOneTimeReconciliation';
import { inspectAriveLoanIdentity } from './ariveIdentity';
import type { AriveNote } from './ariveClient';

const date = (value: string) => new Date(value);
function fixture(): AriveOneTimeReconciliationInput {
  return {
    approved: { portalLoanId: 'portal-loan', previousLoanNumber: 'OLD-ULI', ariveLoanId: '12345678', ariveGuid: 'guid-approved', borrowerFirstName: 'Synthetic', borrowerLastName: 'Applicant' },
    loan: { id: 'portal-loan', loanNumber: 'OLD-ULI', borrowerName: 'Synthetic Applicant', borrowerFirstName: 'Synthetic', borrowerLastName: 'Applicant',
      loanOfficer: { email: 'lo@example.test' }, secondaryLoanOfficer: null, amount: '200000.00', program: 'Old program', propertyAddress: 'Old address', borrowerPhone: null, borrowerEmail: null },
    current: { id: 'pipeline', loanId: 'portal-loan', sheet: 'PIPELINE', pipelineStatus: 'PENDING_APPROVAL', version: 7, statusChangedAt: date('2026-10-01'), movedAt: null,
      archivedAt: null, archivedById: null, titleStatus: 'NOT_STARTED', payoffStatus: 'NOT_STARTED', hoiStatus: 'NOT_STARTED', payoffOrderedAt: null, hoiOrderedAt: null,
      appraisalNeeded: null, appraisalOrderedAt: null, appraisalScheduledAt: null, appraisalBackAt: null, cdSent: false, cdWarningStartsAt: null,
      rateLock: false, rateLockExpiresAt: null, rateLockConfirmedAt: null, rateLockRequestedAt: null, rateLockRequestedById: null,
      approvedWithConditionsAt: null, fundedAt: null, estimatedSigningAt: null, payoffExpiresAt: null, firstPaymentAt: null, sixthPaymentAt: null,
      missingItemsCurrentStatus: 'Portal pending items', loanType: 'HELOC', propertyState: 'TX', lender: 'Old lender' },
    details: { ariveLoanId: 12345678, sysGUID: 'guid-approved', loanOriginatorEmail: 'lo@example.test', modifiedDateTime: '2026-11-19T18:00:00Z',
      loanBorrowers: [{ applicantType: 'Borrower', firstName: 'Synthetic', lastName: 'Applicant', borrowerPairLoanAppSequence: 1, emailAddressText: 'applicant@example.test', mobilePhone10digit: '2025550100' }],
      baseLoanAmount: 300000, totalLoanAmount: 315000, mortgageType: 'Conventional', lienPosition: 'FirstLien', lenderName: 'Synthetic lender', lenderProductName: 'Conventional Fixed',
      subjectTBDIndicator: false, subjectProperty: { addressLineText: '123 Synthetic Lane', addressUnitIdentifier: '2', city: 'Sample', state: 'CA', postalCode: '900001234' },
      currentLoanStatus: { status: 'UNDERWRITING_SUBMITTED', date: '2026-11-18', adverseReason: '' }, loanStatusHistory: [], archiveIndicator: false },
    trackers: { loanTrackers: [{ name: 'TITLE', currentTrackerStatus: [{ name: 'RECEIVED', date: '2026-11-18' }], trackerStatusesHistory: [] }] },
    notes: [], previous: null, financialHistoryProtected: false, generation: 4,
    now: date('2026-11-19T20:00:00Z'), readStartedAt: date('2026-11-19T19:59:00Z'),
  };
}
const note = (text: string, id = '1', at = '2026-11-19T19:00:00Z'): AriveNote => ({ id, text, author: 'Synthetic processor', createdAt: at, updatedAt: at, replies: [] });
function prior(input: AriveOneTimeReconciliationInput, snapshot: unknown = {}) {
  return { ariveLoanId: input.approved.ariveLoanId, ariveGuid: input.approved.ariveGuid, verifiedOriginatorEmail: 'lo@example.test',
    snapshot, fieldSources: {}, conflicts: [], routingProvenance: {}, everFunded: false, collectedSnapshot: {} };
}
const detail = (input: AriveOneTimeReconciliationInput) => input.details as Record<string, unknown>;

describe('explicit one-time Arive reconciliation', () => {
  it('maps approved canonical facts, keeps loan terms separate and produces a deterministic pure plan', () => {
    const input = fixture(), before = JSON.stringify(input), result = planAriveOneTimeReconciliation(input);
    expect(result.loanPatch).toEqual({ loanNumber: '12345678', amount: 315000, program: 'Conventional Fixed', propertyAddress: '123 Synthetic Lane 2, Sample, CA 90000-1234', borrowerPhone: '2025550100', borrowerEmail: 'applicant@example.test' });
    expect(result.pipelinePatch).toMatchObject({ pipelineStatus: 'SUBBED_TO_UW', titleStatus: 'RECEIVED', loanType: 'Conventional', propertyState: 'CA', lender: 'Synthetic lender' });
    expect(result.snapshot.application.loan.lienPosition).toBe('FirstLien');
    expect(result.nextPipelineVersion).toBe(8);
    expect(result.verifiedIdentity).toEqual({ ariveLoanId: '12345678', ariveGuid: 'guid-approved', verifiedOriginatorEmail: 'lo@example.test' });
    expect(JSON.stringify(input)).toBe(before);
    expect(planAriveOneTimeReconciliation(input)).toEqual(result);
  });
  it('uses the explicitly approved expanded borrower name without weakening the shared matcher', () => {
    const input = fixture(); input.loan.borrowerName = 'Jordan Example'; input.loan.borrowerFirstName = 'Jordan'; input.loan.borrowerLastName = 'Example';
    input.approved.borrowerFirstName = 'Jordan Taylor'; input.approved.borrowerLastName = 'Morgan Example';
    detail(input).loanBorrowers = [{ applicantType: 'Borrower', firstName: 'Jordan Taylor', lastName: 'Morgan Example' }];
    expect(inspectAriveLoanIdentity(input.details, { ...input.loan, loanNumber: input.approved.ariveLoanId }).issues).toContain('BORROWER_NAME');
    expect(planAriveOneTimeReconciliation(input).loanPatch).toMatchObject({ borrowerName: 'Jordan Taylor Morgan Example', borrowerFirstName: 'Jordan Taylor', borrowerLastName: 'Morgan Example' });
  });
  it.each(['portal id', 'old number', 'arive number', 'guid', 'borrower', 'originator'])('rejects changed identity: %s', kind => {
    const input = fixture();
    if (kind === 'portal id') input.approved.portalLoanId = 'other';
    if (kind === 'old number') input.loan.loanNumber = 'changed';
    if (kind === 'arive number') detail(input).ariveLoanId = 87654321;
    if (kind === 'guid') detail(input).sysGUID = 'other-guid';
    if (kind === 'borrower') detail(input).loanBorrowers = [{ applicantType: 'Borrower', firstName: 'Other', lastName: 'Person' }];
    if (kind === 'originator') detail(input).loanOriginatorEmail = 'other@example.test';
    expect(() => planAriveOneTimeReconciliation(input)).toThrow();
  });
  it('accepts current portal LO only as an explicit Originator, never a processor role', () => {
    const input = fixture(); detail(input).loanOriginatorEmail = 'other@example.test';
    detail(input).loanTeam = [{ loanRole: 'Originator', emailAddressText: 'lo@example.test' }];
    expect(planAriveOneTimeReconciliation(input).verifiedIdentity.verifiedOriginatorEmail).toBe('lo@example.test');
    detail(input).loanTeam = [{ loanRole: 'Processor', emailAddressText: 'lo@example.test' }];
    expect(() => planAriveOneTimeReconciliation(input)).toThrow('ORIGINATOR');
  });
  it('requires a unique approved applicant and never borrows co-borrower contacts', () => {
    const input = fixture(); detail(input).loanBorrowers = [
      { applicantType: 'Borrower', firstName: 'Synthetic', lastName: 'Applicant', borrowerPairLoanAppSequence: 1 },
      { applicantType: 'CoBorrower', firstName: 'Other', lastName: 'Applicant', emailAddressText: 'wrong@example.test' },
    ];
    expect(planAriveOneTimeReconciliation(input).loanPatch).not.toHaveProperty('borrowerEmail');
    (detail(input).loanBorrowers as object[]).push({ applicantType: 'Borrower', firstName: 'Synthetic', lastName: 'Applicant', borrowerPairLoanAppSequence: 2 });
    expect(() => planAriveOneTimeReconciliation(input)).toThrow('AMBIGUOUS');
    input.approved.applicationSequence = 1;
    expect(planAriveOneTimeReconciliation(input).loanPatch).not.toHaveProperty('borrowerEmail');
  });
  it('does not mix prior data from another permanent identity', () => {
    const input = fixture(); input.previous = { ...prior(input, { managed: { sheet: 'PIPELINE' } }), ariveGuid: 'different' };
    expect(() => planAriveOneTimeReconciliation(input)).toThrow('PREVIOUS_ARIVE_LINK');
    input.previous = { ...prior(input), ariveLoanId: input.loan.loanNumber, ariveGuid: null, verifiedOriginatorEmail: null };
    expect(planAriveOneTimeReconciliation(input).verifiedIdentity.ariveGuid).toBe('guid-approved');
  });
  it('retains saved originator and snapshot regression safeguards', () => {
    const input = fixture(); input.previous = { ...prior(input), verifiedOriginatorEmail: 'not-portal-lo@example.test' };
    expect(() => planAriveOneTimeReconciliation(input)).toThrow('SAVED_ORIGINATOR');
    input.previous = prior(input, { modifiedDateTime: '2026-11-20T00:00:00Z' });
    expect(() => planAriveOneTimeReconciliation(input)).toThrow('SNAPSHOT_REGRESSED');
  });
  it.each([null, -1, 10_000_000_000, 315000.123, 'bad'])('retains amount for an unusable source value %s', amount => {
    const input = fixture(); detail(input).totalLoanAmount = amount; detail(input).baseLoanAmount = null;
    const result = planAriveOneTimeReconciliation(input);
    expect(result.loanPatch).not.toHaveProperty('amount');
    expect(result.issues).toContainEqual(expect.objectContaining({ field: 'loan.amount', code: 'SOURCE_VALUE_UNAVAILABLE' }));
  });
  it('falls back to base amount only when total is absent and keeps unchanged owned values in provenance', () => {
    const input = fixture(); detail(input).totalLoanAmount = null; detail(input).baseLoanAmount = '200000.00';
    const result = planAriveOneTimeReconciliation(input);
    expect(result.loanPatch).not.toHaveProperty('amount'); expect(result.snapshot.canonicalLoan.amount).toBe(200000);
  });
  it.each(['bad', Infinity])('does not disguise an invalid supplied total %s by using the base amount', total => {
    const input = fixture(); detail(input).totalLoanAmount = total;
    const result = planAriveOneTimeReconciliation(input);
    expect(result.loanPatch).not.toHaveProperty('amount');
    expect(result.issues).toContainEqual(expect.objectContaining({ field: 'loan.amount', code: 'SOURCE_VALUE_UNAVAILABLE' }));
  });
  it.each(['TBD', 'incomplete'])('retains the canonical address when source is %s', kind => {
    const input = fixture();
    if (kind === 'TBD') detail(input).subjectTBDIndicator = true;
    else detail(input).subjectProperty = { city: 'New city' };
    expect(planAriveOneTimeReconciliation(input).loanPatch).not.toHaveProperty('propertyAddress');
  });
  it('routes actual funding and fills only missing payment dates', () => {
    const input = fixture(); detail(input).currentLoanStatus = { status: 'LOAN_FUNDED', date: '2026-11-18' };
    input.current.firstPaymentAt = date('2027-02-01');
    const result = planAriveOneTimeReconciliation(input);
    expect(result.pipelinePatch).toMatchObject({ sheet: 'FUNDING', pipelineStatus: 'FUNDED', fundedAt: date('2026-11-18'), sixthPaymentAt: date('2027-05-18') });
    expect(result.pipelinePatch).not.toHaveProperty('firstPaymentAt'); expect(result.everFunded).toBe(true);
  });
  it.each(['payroll', 'prior', 'collected'])('retains funding protection from %s before adverse routing', kind => {
    const input = fixture(); detail(input).currentLoanStatus = { status: 'APPLICATION_INTAKE', adverseReason: 'APP_WITHDRAWN_BY_BORROWER' };
    input.previous = prior(input);
    if (kind === 'payroll') input.financialHistoryProtected = true;
    if (kind === 'prior') input.previous.everFunded = true;
    if (kind === 'collected') input.previous.collectedSnapshot = { everFunded: true };
    const result = planAriveOneTimeReconciliation(input);
    expect(result.everFunded).toBe(true); expect(result.pipelinePatch).not.toHaveProperty('archivedAt');
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'FUNDED_ADVERSE_REVIEW' }));
  });
  it('records exact routing provenance for a confirmed nonfunded adverse action', () => {
    const input = fixture(); detail(input).currentLoanStatus = { status: 'APPLICATION_INTAKE', adverseReason: 'APP_WITHDRAWN_BY_BORROWER' };
    const result = planAriveOneTimeReconciliation(input);
    expect(result.pipelinePatch.archivedAt).toEqual(input.now);
    expect(result.routingProvenance).toMatchObject({ kind: 'ARCHIVE', generation: 4, pipelineVersion: 8, archivedAt: input.now.toISOString() });
  });
  it.each(['unknown stage', 'missing archive flag', 'unknown adverse', 'archive without reason'])('retains routing for %s', kind => {
    const input = fixture();
    if (kind === 'unknown stage') detail(input).currentLoanStatus = { status: 'UNFAMILIAR_STAGE' };
    if (kind === 'missing archive flag') delete detail(input).archiveIndicator;
    if (kind === 'unknown adverse') detail(input).currentLoanStatus = { status: 'UNDERWRITING_SUBMITTED', adverseReason: 'UNFAMILIAR_REASON' };
    if (kind === 'archive without reason') detail(input).archiveIndicator = true;
    const result = planAriveOneTimeReconciliation(input);
    for (const field of ['sheet', 'pipelineStatus', 'archivedAt', 'fundedAt']) expect(result.pipelinePatch).not.toHaveProperty(field);
    expect(result.issues.length).toBeGreaterThan(0);
  });
  it('carries actual service dates and clears a request only for a later confirmed lock', () => {
    const input = fixture();
    const tracker = (name: string, status: string) => ({ name, currentTrackerStatus: [{ name: status, date: '2026-11-18' }], trackerStatusesHistory: [{ name: 'ORDERED', date: '2026-11-12' }] });
    input.trackers = { loanTrackers: [tracker('TITLE', 'RECEIVED'), tracker('HOI', 'RECEIVED'), tracker('PAYOFFS', 'RECEIVED'), tracker('APPRAISAL', 'COMPLETE'), tracker('RATE_LOCK', 'Locked')] };
    input.current.rateLockRequestedAt = date('2026-11-17T18:00:00Z'); input.current.rateLockRequestedById = 'requesting-user';
    detail(input).lockDate = '2026-11-18T19:00:00Z'; detail(input).lockExpirationDate = '2026-12-18';
    const result = planAriveOneTimeReconciliation(input);
    expect(result.pipelinePatch).toMatchObject({ titleStatus: 'RECEIVED', hoiStatus: 'RECEIVED', payoffStatus: 'RECEIVED',
      hoiOrderedAt: date('2026-11-12'), payoffOrderedAt: date('2026-11-12'), appraisalBackAt: date('2026-11-18'),
      rateLock: true, rateLockConfirmedAt: date('2026-11-18T19:00:00Z'), rateLockRequestedAt: null, rateLockRequestedById: null });
    expect(result.clearRateLockRequest).toBe(true);
    detail(input).lockDate = '2026-11-16';
    const stale = planAriveOneTimeReconciliation(input);
    expect(stale.clearRateLockRequest).toBe(false); expect(stale.pipelinePatch).not.toHaveProperty('rateLockRequestedAt');
  });
  it('keeps existing service values when Arive omits current statuses', () => {
    const input = fixture(); input.current.titleStatus = 'RECEIVED'; input.current.hoiStatus = 'ORDERED'; input.current.payoffStatus = 'RECEIVED';
    input.trackers = { loanTrackers: [{ name: 'TITLE', trackerStatusesHistory: [{ name: 'NOT_ORDERED', date: '2026-11-18' }] }] };
    const result = planAriveOneTimeReconciliation(input);
    for (const key of ['titleStatus', 'hoiStatus', 'payoffStatus']) expect(result.pipelinePatch).not.toHaveProperty(key);
    expect(result.issues).toContainEqual(expect.objectContaining({ field: 'TITLE', code: 'MISSING_TRACKER_STATUS' }));
    expect(result.issues).toContainEqual(expect.objectContaining({ field: 'HOI', code: 'MISSING_TRACKER_STATUS' }));
  });
  it('maps all eight headers and stores only three structured values as pipeline fields', () => {
    const input = fixture(); input.notes = [note('Pending Items: Updated items\nScheduled Signing: 11/23/2026\nPayoff Expiry: 2026-12-01\nCondition needed: Paystub\nHOI expiration: 2027-01-01\n1004D: Needed\nWater inspection: Complete\nPest inspection: Waived')];
    const result = planAriveOneTimeReconciliation(input);
    expect(result.pipelinePatch).toMatchObject({ missingItemsCurrentStatus: 'Updated items', estimatedSigningAt: date('2026-11-23'), payoffExpiresAt: date('2026-12-01') });
    expect(Object.keys(result.snapshot.structuredValues)).toHaveLength(8);
    expect(result.snapshot.structuredValues).toMatchObject({ conditionNeeded: 'Paystub', hoiExpiration: '2027-01-01', completion1004D: 'Needed', waterInspection: 'Complete', pestInspection: 'Waived' });
    expect(result.pipelinePatch).not.toHaveProperty('conditionNeeded');
  });
  it('preserves applied notes when their header is removed and permits an explicit clear', () => {
    const input = fixture(); input.notes = [note('Pending Items: Previously applied')];
    const first = planAriveOneTimeReconciliation(input);
    input.current.missingItemsCurrentStatus = 'Previously applied'; input.previous = { ...prior(input, first.snapshot), fieldSources: first.fieldSources };
    input.notes = [note('Ordinary note', '1', '2026-11-19T19:30:00Z')];
    const removed = planAriveOneTimeReconciliation(input);
    expect(removed.pipelinePatch).not.toHaveProperty('missingItemsCurrentStatus');
    expect(removed.snapshot.structuredValues.pendingItems).toBe('Previously applied');
    expect(removed.issues).toContainEqual(expect.objectContaining({ code: 'SOURCE_REMOVED' }));
    input.notes = [note('Pending Items: clear', '2', '2026-11-19T19:40:00Z')];
    expect(planAriveOneTimeReconciliation(input).pipelinePatch.missingItemsCurrentStatus).toBeNull();
  });
  it('records conflicting manual changes, retaining existing conflict history', () => {
    const input = fixture(); input.previous = prior(input, { managed: { loanType: 'FHA' }, canonicalLoan: { amount: 190000 } });
    input.previous.conflicts = [{ field: 'titleStatus', label: 'Title', portalValue: 'ORDERED', ariveValue: 'RECEIVED', detectedAt: '2026-11-01T00:00:00Z' }];
    const result = planAriveOneTimeReconciliation(input);
    expect(result.conflicts).toContainEqual(expect.objectContaining({ field: 'loan.amount', portalValue: '200000', ariveValue: '315000' }));
    expect(result.conflicts).toContainEqual(expect.objectContaining({ field: 'loanType', portalValue: 'HELOC', ariveValue: 'Conventional' }));
    expect(result.conflicts[0].field).toBe('titleStatus');
  });
  it('never projects assignment, financial workflow, private or task mutations even if provider supplies them', () => {
    const input = fixture(); Object.assign(detail(input), { loanOfficerId: 'DO_NOT_COPY', processorId: 'DO_NOT_COPY', projectedRevenue: 999, finalRevenue: 999, payroll: 'DO_NOT_COPY', ssn: 'DO_NOT_COPY', tasks: ['DO_NOT_COPY'] });
    const result = planAriveOneTimeReconciliation(input);
    for (const key of ['loanOfficerId', 'secondaryLoanOfficerId', 'processorId', 'seniorProcessorId', 'juniorProcessorId', 'assignmentGroup', 'processingMethod', 'projectedRevenue', 'finalRevenue', 'stage', 'pipelineStageId', 'sourceTaskId', 'enabled', 'operatorPaused']) {
      expect(result.loanPatch).not.toHaveProperty(key); expect(result.pipelinePatch).not.toHaveProperty(key);
    }
    expect(JSON.stringify(result)).not.toContain('DO_NOT_COPY');
    expect(result).not.toHaveProperty('taskPatch'); expect(result).not.toHaveProperty('payrollPatch');
  });
  it('projects notes with replies without copying arbitrary provider metadata', () => {
    const input = fixture(); input.notes = [Object.assign(note('Parent'), { secret: 'DO_NOT_COPY', replies: [note('Reply', '2')] })];
    const result = planAriveOneTimeReconciliation(input);
    expect(result.notes[0].replies[0].text).toBe('Reply'); expect(JSON.stringify(result.notes)).not.toContain('DO_NOT_COPY');
    expect(result.notesHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
