import { describe, expect, it } from 'vitest';
import { ProcessingItemStatus } from '@prisma/client';
import type { AriveSyncView } from './ariveSyncTypes';
import { ariveDateForSla, ariveFieldLabel, ariveFieldMissing, arivePipelineWarnings, ariveSyncHealth, formatAriveCalendarDate, formatAriveConflictValue, formatAriveSyncDate, mergeAriveConflictDraft } from './ariveSyncPresentation';

const now = Date.parse('2026-11-06T00:00:00Z');
function view(patch: Partial<AriveSyncView> = {}): AriveSyncView {
  return { enabled: true, lastSuccessAt: '2026-11-05T23:59:00Z', lastAttemptAt: null, nextAttemptAt: null, error: null,
    stage: 'APPLICATION_INTAKE', stageLabel: 'Application intake', stageDate: '2026-11-05', conflicts: [], missingFields: [], issues: [], managedFields: [], canManage: false, ...patch };
}

describe('Arive sync health', () => {
  it('does not add pilot UI for ordinary loans', () => {
    expect(ariveSyncHealth(undefined, now)).toBeNull();
    expect(ariveSyncHealth(null, now)).toBeNull();
  });
  it('does not label a paused connection as live even with prior success', () => {
    expect(ariveSyncHealth(view({ enabled: false }), now)?.label).toBe('Arive sync paused');
  });
  it('shows a connection failure ahead of stale or conflict status', () => {
    expect(ariveSyncHealth(view({ error: 'Permission denied', lastSuccessAt: null, conflicts: [{ field: 'titleStatus', label: 'Title', portalValue: 'Received', ariveValue: 'Ordered', detectedAt: '2026-11-05' }] }), now)?.tone).toBe('error');
  });
  it('does not claim a successful sync while required data is missing', () => {
    expect(ariveSyncHealth(view({ missingFields: ['estimatedSigningAt'] }), now)).toMatchObject({ tone: 'warning', label: 'Arive details need review' });
  });
  it('distinguishes first sync, delayed sync, and recent success', () => {
    expect(ariveSyncHealth(view({ lastSuccessAt: null }), now)?.tone).toBe('pending');
    expect(ariveSyncHealth(view({ lastSuccessAt: 'invalid' }), now)?.tone).toBe('pending');
    expect(ariveSyncHealth(view({ lastSuccessAt: '2026-11-05T23:00:00Z' }), now)?.label).toBe('Arive sync delayed');
    expect(ariveSyncHealth(view(), now)?.label).toBe('Synced with Arive');
  });
});

describe('dates and reminders', () => {
  it('keeps date-only values on their original calendar day', () => {
    expect(formatAriveSyncDate('2026-11-05')).toBe('2026-11-05');
    expect(formatAriveSyncDate('invalid')).toBe('Not supplied');
    expect(formatAriveSyncDate(null)).toBe('Not supplied');
  });
  it('keeps imported UTC-midnight milestones on their intended calendar day', () => {
    expect(formatAriveCalendarDate('2026-11-05T00:00:00.000Z')).toBe('11/05/26');
    expect(formatAriveCalendarDate('2026-11-05')).toBe('11/05/26');
    expect(formatAriveCalendarDate('2026-02-31')).toBe('Not supplied');
    expect(formatAriveCalendarDate(null)).toBe('Not supplied');
  });
  it('does not use an old portal date for a milestone missing in Arive', () => {
    const sync = view({ missingFields: ['appraisalOrderedAt'] });
    expect(ariveFieldMissing(sync, 'appraisalOrderedAt')).toBe(true);
    expect(ariveDateForSla(sync, 'appraisalOrderedAt', '2026-10-01')).toBeNull();
    expect(ariveDateForSla(sync, 'payoffOrderedAt', '2026-11-05')).toBe('2026-11-05');
  });
  it('leaves ordinary and paused pipeline reminders unchanged', () => {
    expect(ariveDateForSla(null, 'appraisalOrderedAt', '2026-10-01')).toBe('2026-10-01');
    expect(ariveDateForSla(view({ enabled: false, missingFields: ['appraisalOrderedAt'] }), 'appraisalOrderedAt', '2026-10-01')).toBe('2026-10-01');
  });
  it('uses readable field names in missing-data warnings', () => {
    expect(ariveFieldLabel('hoiOrderedAt')).toBe('Insurance ordered date');
    expect(ariveFieldLabel('pipeline.newMilestone')).toBe('New Milestone');
  });
});

describe('Arive conflict correction', () => {
  it('formats milestone differences without changing note text or the calendar date', () => {
    expect(formatAriveConflictValue('payoffExpiresAt', '2026-11-05T00:00:00.000Z')).toBe('11/05/26');
    expect(formatAriveConflictValue('rateLock', 'false')).toBe('No');
    expect(formatAriveConflictValue('titleStatus', 'NOT_STARTED')).toBe('Not started');
    expect(formatAriveConflictValue('missingItemsCurrentStatus', 'TRUE TEXT')).toBe('TRUE TEXT');
  });
  it('restores only rejected fields and retains unrelated unsaved portal edits', () => {
    const draft = { id: 'pipeline', version: 1, titleStatus: 'RECEIVED', extraNotes: 'Keep my unsaved note', projectedRevenue: '1234', estimatedSigningAt: '2026-11-20' };
    const latest = { id: 'pipeline', version: 2, titleStatus: 'ORDERED', extraNotes: 'Older saved note', projectedRevenue: '1000', estimatedSigningAt: '2026-11-19' };
    expect(mergeAriveConflictDraft(draft, latest, ['titleStatus', 'estimatedSigningAt'])).toEqual({ ...draft, version: 2, titleStatus: 'ORDERED', estimatedSigningAt: '2026-11-19' });
    expect(draft.version).toBe(1);
  });
  it('does not change identity or add arbitrary keys from conflict responses', () => {
    const draft = { id: 'pipeline', version: 1, extraNotes: 'Keep me' };
    const latest = { id: 'other-pipeline', version: 2, extraNotes: 'Replace me' };
    expect(mergeAriveConflictDraft(draft, latest, ['id', 'unrecognized'])).toEqual({ ...draft, version: 2 });
  });
});

describe('Arive service responsibility and deadlines', () => {
  const checkTime = new Date(now);
  function overdueRow(patch: Partial<Parameters<typeof arivePipelineWarnings>[0]> = {}): Parameters<typeof arivePipelineWarnings>[0] {
    return {
      ariveSync: view(), lender: 'Example lender', processingMethod: 'IN_HOUSE',
      approvedWithConditionsAt: '2026-10-01', titleStatus: ProcessingItemStatus.NOT_STARTED,
      payoffStatus: ProcessingItemStatus.NOT_STARTED, payoffOrderedAt: '2026-10-01', payoffExpiresAt: '2026-11-06',
      hoiStatus: ProcessingItemStatus.ORDERED, hoiOrderedAt: '2026-10-01',
      appraisalOrderedAt: '2026-10-01', appraisalBackAt: null,
      cdSent: false, cdWarningStartsAt: '2026-10-01', rateLock: false, rateLockExpiresAt: '2026-11-06', ...patch,
    };
  }
  it('keeps overdue reminders active when the processor is responsible', () => {
    expect(arivePipelineWarnings(overdueRow(), checkTime)).toMatchObject({ title: true, payoff: true, hoi: true, appraisalBack: true, cdSent: true });
    expect(arivePipelineWarnings(overdueRow({ rateLock: true }), checkTime).rateLockExpiring).toBe(true);
    expect(arivePipelineWarnings(overdueRow({ appraisalBackAt: '2026-10-01' }), checkTime).rateLockAfterAppraisal).toBe(true);
  });
  it('suppresses only third-party service exceptions without changing actual progress', () => {
    const row = overdueRow({ processingMethod: 'THIRD_PARTY' });
    expect(arivePipelineWarnings(row, checkTime)).toMatchObject({ title: false, payoff: false, hoi: false, appraisalBack: true, cdSent: true });
    expect(row.titleStatus).toBe(ProcessingItemStatus.NOT_STARTED);
    expect(row.hoiStatus).toBe(ProcessingItemStatus.ORDERED);
    expect(arivePipelineWarnings({ ...row, rateLock: true }, checkTime).rateLockExpiring).toBe(true);
    expect(arivePipelineWarnings({ ...row, appraisalBackAt: '2026-10-01' }, checkTime).rateLockAfterAppraisal).toBe(true);
    expect(arivePipelineWarnings({ ...row, payoffStatus: ProcessingItemStatus.RECEIVED }, checkTime).payoffExpiration).toBe('none');
  });
  it.each(['AVEN', 'Figure Lending', 'NFTY'])('keeps %s responsibility exceptions separate from imported progress', lender => {
    const row = overdueRow({ lender });
    expect(arivePipelineWarnings(row, checkTime)).toMatchObject({ title: false, payoff: false, hoi: false, appraisalBack: false, cdSent: false, rateLockExpiring: false, rateLockAfterAppraisal: false });
    expect(arivePipelineWarnings({ ...row, rateLock: true, payoffStatus: ProcessingItemStatus.RECEIVED }, checkTime)).toMatchObject({ rateLockExpiring: false, payoffExpiration: 'none' });
    expect(arivePipelineWarnings({ ...row, appraisalBackAt: '2026-10-01' }, checkTime).rateLockAfterAppraisal).toBe(false);
    expect(row.titleStatus).toBe(ProcessingItemStatus.NOT_STARTED);
  });
  it('does not change ordinary or paused file deadline behavior', () => {
    const ordinary = overdueRow({ lender: 'AVEN', ariveSync: null });
    expect(arivePipelineWarnings(ordinary, checkTime)).toMatchObject({ title: true, payoff: true, hoi: true, appraisalBack: true, cdSent: true });
    expect(arivePipelineWarnings({ ...ordinary, ariveSync: view({ enabled: false }) }, checkTime)).toEqual(arivePipelineWarnings(ordinary, checkTime));
  });
  it('does not use missing source dates while retaining other deadlines', () => {
    const row = overdueRow({ ariveSync: view({ missingFields: ['hoiOrderedAt', 'appraisalOrderedAt', 'cdWarningStartsAt'] }) });
    expect(arivePipelineWarnings(row, checkTime)).toMatchObject({ title: true, payoff: true, hoi: false, appraisalBack: false, cdSent: false });
  });
});
