import { describe, expect, it } from 'vitest';
import { parseArivePipelineDate, planArivePipelineSync, type ArivePipelineCurrent } from './arivePipelineMapping';

const at = (date: string) => new Date(date.length === 10 ? `${date}T00:00:00.000Z` : date);
const now = at('2026-11-05T23:00:00Z');
function current(overrides: Partial<ArivePipelineCurrent> = {}): ArivePipelineCurrent {
  return { sheet: 'PIPELINE', pipelineStatus: 'PENDING_APPROVAL', statusChangedAt: at('2026-10-15'), movedAt: null, archivedAt: null,
    titleStatus: 'NOT_STARTED', payoffStatus: 'NOT_STARTED', hoiStatus: 'NOT_STARTED', payoffOrderedAt: null, hoiOrderedAt: null,
    appraisalNeeded: null, appraisalOrderedAt: null, appraisalScheduledAt: null, appraisalBackAt: null,
    cdSent: false, cdWarningStartsAt: null, rateLock: false, rateLockExpiresAt: null, rateLockConfirmedAt: null,
    rateLockRequestedAt: null, rateLockRequestedById: null, approvedWithConditionsAt: null, fundedAt: null,
    estimatedSigningAt: null, payoffExpiresAt: null, ...overrides };
}
const tracker = (name: string, status: string, date: string | null = null, history: { name: string; date: string }[] = []) => ({ name, displayName: name, currentTrackerStatus: { name: status, date }, trackerStatusesHistory: history });
const standardTrackers = () => [tracker('TITLE', 'NOT_ORDERED'), tracker('HOI', 'NOT_ORDERED'), tracker('PAYOFFS', 'NOT_ORDERED'), tracker('APPRAISAL', 'NOT_ORDERED'), tracker('CD', 'NOT_SENT'), tracker('RATE_LOCK', 'None')];
const details = (stage = 'APPLICATION_INTAKE', date: string | null = '2026-10-15') => ({ currentLoanStatus: { status: stage, date }, loanStatusHistory: [{ status: stage, date }], keyDates: {} });
function plan(options: { stage?: string; date?: string | null; details?: object; trackers?: unknown[]; current?: ArivePipelineCurrent } = {}) {
  return planArivePipelineSync({ details: { ...details(options.stage, options.date), ...options.details }, trackers: { loanTrackers: options.trackers ?? standardTrackers() }, current: options.current ?? current(), now });
}
describe('inbound Arive stage routing', () => {
  it.each([
    ['UNDERWRITING_SUBMITTED', 'SUBBED_TO_UW'], ['APPROVED_WITH_CONDITION', 'APPROVED_WITH_CONDITIONS'],
    ['RE_SUBMITTAL', 'RE_SUB'], ['CLEAR_TO_CLOSE', 'CTC'], ['DOCS_OUT', 'DOCS_OUT'],
  ])('maps %s with its actual stage date', (stage, expected) => {
    const result = plan({ stage, date: '2026-10-21' });
    expect(result.patch.pipelineStatus).toBe(expected); expect(result.patch.statusChangedAt).toEqual(at('2026-10-21'));
    expect(result.source.stage).toBe(stage);
  });
  it('shows early stages exactly without inventing an underwriting status', () => {
    const result = plan({ stage: 'QUALIFICATION', date: '2026-11-01' });
    expect(result.patch.pipelineStatus).toBeUndefined(); expect(result.source.stageLabel).toBe('Qualification');
    expect(result.patch.statusChangedAt).toEqual(at('2026-11-01'));
  });
  it('moves suspended loans into Restructures using the source milestone', () => {
    expect(plan({ stage: 'SUSPENDED', date: '2026-11-02' }).patch).toMatchObject({ sheet: 'RESTRUCTURE', pipelineStatus: 'SUSPENDED_RESTRUCTURE', statusChangedAt: at('2026-11-02'), movedAt: at('2026-11-02') });
  });
  it('moves funded loans without calculating payment dates or changing financial/assignment fields', () => {
    const result = plan({ stage: 'LOAN_FUNDED', date: '2026-11-02' });
    expect(result.patch).toMatchObject({ sheet: 'FUNDING', pipelineStatus: 'FUNDED', fundedAt: at('2026-11-02') });
    for (const field of ['projectedRevenue', 'finalRevenue', 'firstPaymentAt', 'sixthPaymentAt', 'seniorProcessorId', 'juniorProcessorId', 'processingMethod', 'loanOfficerId']) expect(result.patch).not.toHaveProperty(field);
  });
  it('uses the funded milestone for a later post-funding stage, without treating commission as final revenue', () => {
    const result = plan({ stage: 'COMMISSION_PAID', date: '2026-11-04', details: { loanStatusHistory: [{ status: 'LOAN_FUNDED', date: '2026-11-01' }] } });
    expect(result.patch.fundedAt).toEqual(at('2026-11-01')); expect(result.patch).not.toHaveProperty('finalRevenue');
  });
  it('flags a missing funded date rather than using the date of a later commission stage', () => {
    const result = plan({ stage: 'COMMISSION_PAID', date: '2026-11-04' });
    expect(result.patch.sheet).toBe('FUNDING'); expect(result.patch.fundedAt).toBeUndefined();
    expect(result.issues).toContainEqual(expect.objectContaining({ field: 'fundedAt', code: 'MISSING_DATE' }));
  });
  it('never reverses funding or clears funding dates automatically', () => {
    const result = plan({ stage: 'SUSPENDED', current: current({ sheet: 'FUNDING', pipelineStatus: 'FUNDED', fundedAt: at('2026-11-01') }) });
    for (const key of ['sheet', 'pipelineStatus', 'fundedAt', 'statusChangedAt']) expect(result.patch).not.toHaveProperty(key);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'FUNDED_REVERSAL_REVIEW' }));
  });
  it('archives recognized adverse files without deletion or fabricating an adverse milestone', () => {
    const result = plan({ details: { currentLoanStatus: { status: 'APPLICATION_INTAKE', date: null, adverseReason: 'APP_WITHDRAWN_BY_BORROWER' } } });
    expect(result.patch.archivedAt).toEqual(now); expect(result.source.stageDate).toBeNull();
    expect(result.patch).not.toHaveProperty('archivedById');
  });
  it('does not equate an ordinary Arive archive or unknown adverse reason to an approved removal', () => {
    for (const change of [{ archiveIndicator: true }, { currentLoanStatus: { status: 'APPLICATION_INTAKE', date: '2026-10-15', adverseReason: 'UNFAMILIAR' } }]) {
      const result = plan({ details: change }); expect(result.patch).not.toHaveProperty('archivedAt'); expect(result.issues.length).toBeGreaterThan(0);
    }
  });
  it('keeps an already funded loan in Fundings when Arive later reports adverse action', () => {
    const result = plan({ current: current({ sheet: 'FUNDING', pipelineStatus: 'FUNDED', fundedAt: at('2026-11-01') }), details: { currentLoanStatus: { status: 'LOAN_FUNDED', date: '2026-11-01', adverseReason: 'APP_RESCINDED_BY_BORROWER' } } });
    for (const field of ['archivedAt', 'sheet', 'pipelineStatus', 'fundedAt']) expect(result.patch).not.toHaveProperty(field);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'FUNDED_ADVERSE_REVIEW', message: expect.stringContaining('remains in Fundings') }));
  });
  it('never automatically restores an already archived portal file', () => {
    const result = plan({ stage: 'UNDERWRITING_SUBMITTED', current: current({ archivedAt: at('2026-10-20') }) });
    expect(result.patch).not.toHaveProperty('archivedAt'); expect(result.patch).not.toHaveProperty('sheet');
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'ARCHIVED_REVIEW' }));
  });
  it('keeps actual stage and missing-date warning without rejecting Docs Out or inventing signing', () => {
    const result = plan({ stage: 'DOCS_OUT', date: null });
    expect(result.patch.pipelineStatus).toBe('DOCS_OUT'); expect(result.patch).not.toHaveProperty('statusChangedAt');
    expect(result.patch).not.toHaveProperty('estimatedSigningAt');
    expect(result.issues.map(i => i.field)).toEqual(expect.arrayContaining(['statusChangedAt', 'estimatedSigningAt']));
  });
  it('keeps unknown stage labels visible but does not change routing', () => {
    const result = plan({ stage: 'NEW_FUTURE_STAGE' });
    expect(result.source.stage).toBe('NEW_FUTURE_STAGE'); expect(result.patch).not.toHaveProperty('pipelineStatus');
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'UNKNOWN_STAGE' }));
  });
  it('preserves date-only source strings so Pacific-time display does not move them back a day', () => {
    const result = plan({ date: '2026-10-15', trackers: [tracker('TITLE', 'RECEIVED', '2026-10-21')] });
    expect(result.source.stageDate).toBe('2026-10-15'); expect(result.source.stageHistory[0].date).toBe('2026-10-15');
    expect(result.source.trackers[0].date).toBe('2026-10-21');
  });
});

describe('actual tracker milestones and SLA fields', () => {
  it('uses key-date priority, retained historical order dates and actual current states', () => {
    const result = plan({ stage: 'CLEAR_TO_CLOSE', details: { keyDates: { hoiOrderedDate: '2026-10-18' }, loanStatusHistory: [{ status: 'APPROVED_WITH_CONDITION', date: '2026-10-17' }] }, trackers: [
      ...standardTrackers().filter(t => !['TITLE', 'HOI', 'PAYOFFS'].includes(t.name)), tracker('TITLE', 'RECEIVED', '2026-10-22'),
      tracker('HOI', 'ORDERED', '2026-10-19'), tracker('PAYOFFS', 'RECEIVED', '2026-10-21', [{ name: 'ORDERED', date: '2026-10-18' }]),
    ] });
    expect(result.patch).toMatchObject({ titleStatus: 'RECEIVED', hoiStatus: 'ORDERED', hoiOrderedAt: at('2026-10-18'), payoffStatus: 'RECEIVED', payoffOrderedAt: at('2026-10-18'), approvedWithConditionsAt: at('2026-10-17') });
    expect(result.issues).toContainEqual(expect.objectContaining({ field: 'payoffExpiresAt', code: 'MISSING_DATE' }));
  });
  it('clears an owned stale nullable date when the known ordered status has no date', () => {
    const result = plan({ trackers: [tracker('HOI', 'ORDERED')], current: current({ hoiOrderedAt: at('2026-10-01') }) });
    expect(result.patch.hoiOrderedAt).toBeNull(); expect(result.patch.hoiStatus).toBe('ORDERED');
    expect(result.issues).toContainEqual(expect.objectContaining({ field: 'hoiOrderedAt', code: 'MISSING_DATE' }));
  });
  it('retains unmapped or duplicate tracker states rather than guessing completion', () => {
    const result = plan({ trackers: [tracker('TITLE', 'RECEIVED'), tracker('TITLE', 'NOT_ORDERED'), tracker('HOI', 'NEW_STATUS'), tracker('APPRAISAL', 'NEW_STATUS')], current: current({ titleStatus: 'ORDERED', hoiStatus: 'ORDERED', appraisalBackAt: at('2026-10-01') }) });
    for (const field of ['titleStatus', 'hoiStatus', 'appraisalBackAt']) expect(result.patch).not.toHaveProperty(field);
    expect(result.issues.map(i => i.code)).toEqual(expect.arrayContaining(['DUPLICATE_TRACKER', 'UNMAPPED_TRACKER_STATUS']));
  });
  it('accepts a single documented current-status array and refuses ambiguous multiple statuses', () => {
    const result = plan({ trackers: [{ name: 'TITLE', currentTrackerStatus: [{ name: 'RECEIVED', date: '2026-10-21' }] }, { name: 'HOI', currentTrackerStatus: [{ name: 'RECEIVED' }, { name: 'ORDERED' }] }] });
    expect(result.patch.titleStatus).toBe('RECEIVED'); expect(result.patch).not.toHaveProperty('hoiStatus');
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'AMBIGUOUS_TRACKER_STATUS' }));
  });
  it('does not mistake appraisal delivery for receipt and never invents appraisal dates', () => {
    const result = plan({ details: { keyDates: { appraisalOrderedDate: '2026-10-19', appraisalDeliveryDate: '2026-10-25' } }, trackers: [tracker('APPRAISAL', 'RECEIVED')] });
    expect(result.patch.appraisalOrderedAt).toEqual(at('2026-10-19')); expect(result.patch).not.toHaveProperty('appraisalBackAt');
    expect(result.issues).toContainEqual(expect.objectContaining({ field: 'appraisalBackAt', code: 'MISSING_DATE' }));
  });
  it.each([['ORDERED', true], ['WAIVED', false]] as const)('removes only the prior %s requirement inference when appraisal returns to Not Ordered', (status, needed) => {
    const forward = plan({ trackers: [tracker('APPRAISAL', status, '2026-11-05')] });
    expect(forward.patch.appraisalNeeded).toBe(needed);
    const restored = plan({ trackers: [tracker('APPRAISAL', 'NOT_ORDERED')], current: current({ ...forward.patch, previousArive: { appraisal: { status, needed } } }) });
    expect(restored.patch.appraisalNeeded).toBeNull();
    expect(restored.managed.appraisalNeeded).toBeNull();
  });
  it.each([true, false])('keeps an independently known appraisal requirement of %s on the first Not Ordered read', appraisalNeeded => {
    const result = plan({ trackers: [tracker('APPRAISAL', 'NOT_ORDERED')], current: current({ appraisalNeeded }) });
    expect(result.patch).not.toHaveProperty('appraisalNeeded');
    expect(result.managed).not.toHaveProperty('appraisalNeeded');
  });
  it.each([
    { status: 'NOT_ORDERED', needed: true, current: true },
    { status: 'UNFAMILIAR', needed: true, current: true },
    { status: 'ORDERED', needed: true, current: false },
    { status: 'ORDERED', needed: false, current: false },
  ])('does not clear an unproven or independently changed appraisal requirement ($status, $needed, $current)', previous => {
    const result = plan({ trackers: [tracker('APPRAISAL', 'NOT_ORDERED')], current: current({ appraisalNeeded: previous.current, previousArive: { appraisal: { status: previous.status, needed: previous.needed } } }) });
    expect(result.patch).not.toHaveProperty('appraisalNeeded');
  });
  it('retains actual appraisal milestones when resetting only the inferred requirement', () => {
    const result = plan({ trackers: [tracker('APPRAISAL', 'NOT_ORDERED', null, [
      { name: 'ORDERED', date: '2026-10-20' }, { name: 'SCHEDULED', date: '2026-10-22' }, { name: 'RECEIVED', date: '2026-10-25' },
    ])], current: current({ appraisalNeeded: true, appraisalOrderedAt: at('2026-10-20'), appraisalScheduledAt: at('2026-10-22'), appraisalBackAt: at('2026-10-25'), previousArive: { appraisal: { status: 'RECEIVED', needed: true } } }) });
    expect(result.patch.appraisalNeeded).toBeNull();
    for (const field of ['appraisalOrderedAt', 'appraisalScheduledAt', 'appraisalBackAt']) expect(result.patch).not.toHaveProperty(field);
    expect(result.managed).toMatchObject({ appraisalOrderedAt: at('2026-10-20'), appraisalScheduledAt: at('2026-10-22'), appraisalBackAt: at('2026-10-25') });
  });
  it('captures all trackers without treating payroll/funding trackers as accounting approvals', () => {
    const names = ['TRID', 'RATE_LOCK', 'ITP', 'APPRAISAL', 'HOI', 'TITLE', 'PAYOFFS', 'HOA_FEE', 'FLOOD_CERTIFICATION', 'CD', 'SIGNED_DOCS_WITH_LENDER', 'FUNDING_CONDITIONS', 'FTC', 'FUNDING_WIRE', 'MERS', 'POST_CLOSING_AUDIT', 'PAYROLL', 'CLIENT_REVIEW'];
    const result = plan({ trackers: names.map(name => tracker(name, 'COMPLETE', '2026-10-20')) });
    expect(result.source.trackers).toHaveLength(18); expect(result.patch).not.toHaveProperty('sheet'); expect(result.patch).not.toHaveProperty('finalRevenue');
  });
});

describe('rate lock request reconciliation', () => {
  const requested = current({ rateLockRequestedAt: at('2026-11-05T18:00:00Z'), rateLockRequestedById: 'requester' });
  const locked = (lockDate: string | null, state = requested) => plan({ current: state, details: { lockDate, lockExpirationDate: '2026-12-05' }, trackers: [tracker('RATE_LOCK', 'Locked')] });
  it('clears a pending request only after a reliable new lock confirmation', () => {
    const result = locked('2026-11-05T19:00:00Z');
    expect(result.clearRateLockRequest).toBe(true);
    expect(result.patch).toMatchObject({ rateLock: true, rateLockConfirmedAt: at('2026-11-05T19:00:00Z'), cdWarningStartsAt: at('2026-11-05T19:00:00Z'), rateLockRequestedAt: null, rateLockRequestedById: null });
  });
  it('keeps requests newer than the known lock and flags the mismatch', () => {
    const result = locked('2026-11-04'); expect(result.clearRateLockRequest).toBe(false); expect(result.patch).not.toHaveProperty('rateLockRequestedAt');
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'STALE_LOCK_CONFIRMATION' }));
  });
  it('does not clear a request when lock confirmation has no date', () => {
    const result = locked(null); expect(result.patch.rateLock).toBe(true); expect(result.clearRateLockRequest).toBe(false); expect(result.patch).not.toHaveProperty('rateLockRequestedAt');
    expect(result.issues).toContainEqual(expect.objectContaining({ field: 'rateLockConfirmedAt', code: 'MISSING_DATE' }));
  });
  it('requires an unlocked snapshot observed after the request for same-day date-only confirmation', () => {
    expect(locked('2026-11-05').clearRateLockRequest).toBe(false);
    expect(locked('2026-11-05', { ...requested, previousArive: { rateLock: false, observedAt: '2026-11-05T18:30:00Z' } }).clearRateLockRequest).toBe(true);
    for (const previousArive of [{ rateLock: true, observedAt: '2026-11-05T18:30:00Z' }, { rateLock: false, observedAt: '2026-11-05T17:00:00Z' }, { rateLock: false, observedAt: '2026-11-06T00:00:00Z' }]) expect(locked('2026-11-05', { ...requested, previousArive }).clearRateLockRequest).toBe(false);
  });
  it('does not infer a lock from an undocumented numeric lockStatus or nonexact tracker casing', () => {
    const result = plan({ details: { lockStatus: 1 }, trackers: [tracker('RATE_LOCK', 'LOCKED')] });
    expect(result.patch).not.toHaveProperty('rateLock'); expect(result.clearRateLockRequest).toBe(false);
  });
});

describe('repeatability and invalid input', () => {
  it('produces no second database patch for an identical applied snapshot', () => {
    const first = plan({ stage: 'SUSPENDED', date: '2026-10-20' });
    expect(plan({ stage: 'SUSPENDED', date: '2026-10-20', current: { ...current(), ...first.patch } }).patch).toEqual({});
  });
  it('retains Arive ownership for already-matching values without managing portal request metadata', () => {
    const result = plan();
    expect(result.patch).toEqual({});
    expect(result.managed).toMatchObject({ titleStatus: 'NOT_STARTED', hoiStatus: 'NOT_STARTED', payoffStatus: 'NOT_STARTED', cdSent: false, rateLock: false, statusChangedAt: at('2026-10-15') });
    for (const field of ['rateLockRequestedAt', 'rateLockRequestedById', 'movedAt', 'archivedAt']) expect(result.managed).not.toHaveProperty(field);
  });
  it.each(['2026-02-30', '2026-13-01', '11/05/2026', '2026-11-05T12:00:00', 'invalid'])('rejects invalid or ambiguous date %s', value => expect(parseArivePipelineDate(value)).toBeNull());
  it('does not mutate the fetched details, trackers or current row', () => {
    const input = { details: details('LOAN_FUNDED', '2026-11-01'), trackers: { loanTrackers: standardTrackers() }, current: current(), now };
    const before = JSON.stringify(input); planArivePipelineSync(input); expect(JSON.stringify(input)).toBe(before);
  });
  it('rejects malformed tracker responses rather than planning a false empty reset', () => {
    expect(() => planArivePipelineSync({ details: details(), trackers: {}, current: current(), now })).toThrow();
    expect(() => plan({ trackers: [{ name: 'TITLE', trackerStatusesHistory: 'invalid' }] })).toThrow();
  });
});
