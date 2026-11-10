import { describe, expect, it, vi } from 'vitest';
import type { ArivePipelineSync, Prisma, ProcessingPipelineLoan } from '@prisma/client';
import { ARIVE_SYNC_PILOT } from './ariveSyncTypes';
import { ariveSyncSameValue, ariveSyncView, guardArivePipelineEdit, preserveAriveManagedFields } from './ariveSyncState';

function setup() {
  const current = { id: 'pilot-pipeline', loanId: ARIVE_SYNC_PILOT.loanId, archivedAt: null, titleStatus: 'RECEIVED', statusChangedAt: new Date('2026-11-05T00:00:00Z'),
    firstPaymentAt: new Date('2027-01-01T00:00:00Z'), sixthPaymentAt: new Date('2027-06-01T00:00:00Z'),
    rateLockRequestedAt: new Date('2026-11-05T18:00:00Z'), rateLockRequestedById: 'requester', extraNotes: 'Portal-owned note',
  } as unknown as ProcessingPipelineLoan;
  let state = {
    id: 'state', enabled: true, lastSuccessAt: new Date('2026-11-05T22:00:00Z'), lastAttemptAt: new Date('2026-11-05T21:59:00Z'), nextAttemptAt: new Date('2026-11-05T22:05:00Z'),
    lastError: null, leaseToken: 'DO_NOT_EXPOSE_LEASE_TOKEN',
    snapshot: { source: { stage: 'UNDERWRITING_SUBMITTED', stageLabel: 'Submitted to underwriting', stageDate: '2026-11-05', privateSource: 'DO_NOT_EXPOSE_RAW_SOURCE' },
      managed: { titleStatus: 'RECEIVED', statusChangedAt: '2026-11-05T00:00:00.000Z' }, structuredValues: { pendingItems: 'Paystubs' },
    },
    fieldSources: { pendingItems: { author: 'Processor', effectiveAt: '2026-11-05T12:00:00Z', rawText: 'DO_NOT_EXPOSE_RAW_HTML' } },
    conflicts: [], issues: [{ field: 'payoffExpiresAt', code: 'MISSING_DATE', message: 'Payoff expiry is missing.' }],
  } as unknown as ArivePipelineSync;
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    arivePipelineSync: {
      findUnique: vi.fn(async () => state),
      update: vi.fn(async ({ data }: { data: Partial<ArivePipelineSync> }) => { state = { ...state, ...data }; return state; }),
    },
    auditLog: { create: vi.fn(async ({ data }: { data: unknown }) => data) },
  };
  return { current, get state() { return state; }, tx, client: tx as unknown as Prisma.TransactionClient };
}
describe('Arive-owned portal edits', () => {
  it('rejects and records a mismatched edit while retaining the Arive value', async () => {
    const h = setup(); const result = await guardArivePipelineEdit(h.client, h.current, 'admin', { titleStatus: 'ORDERED', extraNotes: 'Allowed portal note' });
    expect(result).toMatchObject({ success: false, ariveConflict: true, blockedFields: ['titleStatus'] });
    expect(h.state.conflicts).toEqual([expect.objectContaining({ field: 'titleStatus', portalValue: 'ORDERED', ariveValue: 'RECEIVED' })]);
    expect(h.tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'PROCESSING_ARIVE_PORTAL_EDIT_CONFLICT' }) }));
    expect(h.current.titleStatus).toBe('RECEIVED');
  });
  it('allows already-matching values, equivalent date-only input, and portal-owned fields', async () => {
    const h = setup(); expect(await guardArivePipelineEdit(h.client, h.current, 'admin', { titleStatus: 'RECEIVED', statusChangedAt: '2026-11-05', extraNotes: 'Changed portal note' })).toBeNull();
    expect(h.tx.auditLog.create).not.toHaveBeenCalled(); expect(h.tx.arivePipelineSync.update).not.toHaveBeenCalled();
  });
  it('prevents manual active-pipeline removal while Arive owns the file lifecycle', async () => {
    const h = setup();
    const result = await guardArivePipelineEdit(h.client, h.current, 'admin', { archivedAt: new Date('2026-11-05T23:00:00Z') });
    expect(result).toMatchObject({ success: false, ariveConflict: true, blockedFields: ['archivedAt'] });
    expect(h.state.conflicts).toEqual([expect.objectContaining({ field: 'archivedAt', ariveValue: null })]);
  });
  it('does not affect other loans or a paused integration', async () => {
    const h = setup(); expect(await guardArivePipelineEdit(h.client, { ...h.current, loanId: 'other-loan' }, 'admin', { titleStatus: 'ORDERED' })).toBeNull();
    expect(h.tx.arivePipelineSync.findUnique).not.toHaveBeenCalled();
    h.state.enabled = false; expect(await guardArivePipelineEdit(h.client, h.current, 'admin', { titleStatus: 'ORDERED' })).toBeNull();
    expect(h.tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('keeps derived legacy defaults from overwriting imported milestones or financial scheduling', async () => {
    const h = setup();
    const data: Prisma.ProcessingPipelineLoanUpdateManyMutationInput = { titleStatus: 'NOT_APPLICABLE', statusChangedAt: new Date('2026-12-01'), firstPaymentAt: null, sixthPaymentAt: null, rateLockRequestedAt: null, rateLockRequestedById: null, extraNotes: 'Updated portal note' };
    await preserveAriveManagedFields(h.client, h.current, data);
    expect(data).toMatchObject({ titleStatus: 'RECEIVED', statusChangedAt: h.current.statusChangedAt, firstPaymentAt: h.current.firstPaymentAt, sixthPaymentAt: h.current.sixthPaymentAt,
      rateLockRequestedAt: h.current.rateLockRequestedAt, rateLockRequestedById: 'requester', extraNotes: 'Updated portal note' });
  });
  it('leaves legacy mutations untouched on other loans', async () => {
    const h = setup(); const data = { titleStatus: 'NOT_APPLICABLE' as const, firstPaymentAt: null };
    await preserveAriveManagedFields(h.client, { ...h.current, loanId: 'other-loan' }, data);
    expect(data).toEqual({ titleStatus: 'NOT_APPLICABLE', firstPaymentAt: null }); expect(h.tx.arivePipelineSync.findUnique).not.toHaveBeenCalled();
  });
});

describe('safe sync presentation and comparisons', () => {
  function trackerState(trackers: unknown, issues: { field: string; code: string; message: string }[] = []) {
    const h = setup();
    h.state.snapshot = {
      source: { trackers, privatePayload: 'DO_NOT_EXPOSE_SOURCE_PAYLOAD' },
      managed: { titleStatus: 'RECEIVED', appraisalNeeded: true },
    } as unknown as Prisma.JsonValue;
    h.state.issues = issues;
    return h.state;
  }
  it('presents the four current source trackers in a fixed order without leaking history or unrelated trackers', () => {
    const state = trackerState([
      { name: 'PAYOFFS', status: 'REQUESTED', statusLabel: 'Requested', date: '2026-11-10' },
      { name: 'APPRAISAL', status: 'NOT_ORDERED', statusLabel: 'Not ordered', date: null, history: [{ status: 'RECEIVED', date: '2026-10-01', privateValue: 'DO_NOT_EXPOSE_HISTORY' }] },
      { name: 'TITLE', label: 'DO_NOT_EXPOSE_UNTRUSTED_LABEL', status: 'RECEIVED', statusLabel: 'Received', date: '2026-10-15', rawText: 'DO_NOT_EXPOSE_RAW_TEXT' },
      { name: 'HOI', status: 'ORDERED', statusLabel: 'Ordered', date: '2026-11-10T17:30:00.000Z' },
      { name: 'PAYROLL', status: 'DO_NOT_EXPOSE_UNRELATED_STATUS', date: '2026-11-10' },
    ]);
    const view = ariveSyncView(state, true, false)!;
    expect(view.serviceTrackers).toEqual([
      { name: 'TITLE', label: 'Title', status: 'RECEIVED', statusLabel: 'Received', date: '2026-10-15', availability: 'current' },
      { name: 'HOI', label: 'Homeowners insurance', status: 'ORDERED', statusLabel: 'Ordered', date: '2026-11-10T17:30:00.000Z', availability: 'current' },
      { name: 'APPRAISAL', label: 'Appraisal', status: 'NOT_ORDERED', statusLabel: 'Not ordered', date: null, availability: 'current' },
      { name: 'PAYOFFS', label: 'Payoffs', status: 'REQUESTED', statusLabel: 'Requested', date: '2026-11-10', availability: 'current' },
    ]);
    expect(JSON.stringify(view)).not.toContain('DO_NOT_EXPOSE');
  });
  it('shows an unfamiliar actual status without substituting the retained portal value or an invalid date', () => {
    const state = trackerState([{ name: 'TITLE', status: 'ADDITIONAL_REVIEW', statusLabel: 'Additional review', date: 'DO_NOT_EXPOSE_INVALID_DATE' }]);
    expect(ariveSyncView(state, true, false)?.serviceTrackers?.[0]).toEqual({
      name: 'TITLE', label: 'Title', status: 'ADDITIONAL_REVIEW', statusLabel: 'Additional review', date: null, availability: 'current',
    });
  });
  it('marks duplicate trackers and ambiguous current-status responses for review instead of choosing a status', () => {
    const state = trackerState([
      { name: 'TITLE', status: 'RECEIVED', statusLabel: 'Received', date: '2026-11-10' },
      { name: 'TITLE', status: 'ORDERED', statusLabel: 'Ordered', date: '2026-11-09' },
      { name: 'APPRAISAL', status: '', statusLabel: 'Not supplied', date: null },
    ], [{ field: 'APPRAISAL', code: 'AMBIGUOUS_TRACKER_STATUS', message: 'Multiple current statuses.' }]);
    const trackers = ariveSyncView(state, true, false)!.serviceTrackers!;
    for (const index of [0, 2]) expect(trackers[index]).toMatchObject({ status: '', date: null, availability: 'ambiguous', statusLabel: 'Multiple current statuses — review Arive' });
    expect(trackers[1]).toMatchObject({ status: '', date: null, availability: 'missing' });
  });
  it.each([undefined, null, {}, [{ name: 'APPRAISAL', status: null, date: '2026-11-10' }]])('does not infer missing tracker statuses from retained fields or malformed snapshots (%j)', trackers => {
    const view = ariveSyncView(trackerState(trackers), true, false)!;
    expect(view.serviceTrackers).toHaveLength(4);
    for (const tracker of view.serviceTrackers!) expect(tracker).toMatchObject({ status: '', date: null, availability: 'missing', statusLabel: 'Not supplied by Arive' });
  });
  it('compares actual timestamps and equivalent date-only inputs without treating unrelated strings as dates', () => {
    expect(ariveSyncSameValue('statusChangedAt', '2026-11-05', new Date('2026-11-05T00:00:00Z'))).toBe(true);
    expect(ariveSyncSameValue('statusChangedAt', '2026-11-05T05:00:00-07:00', '2026-11-05T12:00:00Z')).toBe(true);
    expect(ariveSyncSameValue('statusChangedAt', '2026-11-04', new Date('2026-11-05T00:00:00Z'))).toBe(false);
    expect(ariveSyncSameValue('extraNotes', '2026-11-05', '2026-11-05T00:00:00Z')).toBe(false);
    expect(ariveSyncSameValue('extraNotes', undefined, null)).toBe(true);
  });
  it('returns only display fields and provenance summaries, never raw state or source HTML', () => {
    const h = setup(); const view = ariveSyncView(h.state, true, false);
    expect(view).toMatchObject({ enabled: true, canManage: false, stage: 'UNDERWRITING_SUBMITTED', stageDate: '2026-11-05', managedFields: ['titleStatus', 'statusChangedAt'], missingFields: ['payoffExpiresAt'], structuredFields: [{ key: 'pendingItems', value: 'Paystubs', author: 'Processor', updatedAt: '2026-11-05T12:00:00Z' }] });
    expect(JSON.stringify(view)).not.toContain('DO_NOT_EXPOSE');
    expect(ariveSyncView(h.state, false, true)).toBeNull();
  });
  it('renders an eligible unconfigured file as paused without synthetic success dates', () => {
    expect(ariveSyncView(null, true, true)).toMatchObject({ enabled: false, lastSuccessAt: null, stage: null, issues: [], conflicts: [], managedFields: [], canManage: true });
  });
});
