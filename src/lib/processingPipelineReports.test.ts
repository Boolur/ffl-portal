import { describe, expect, it } from 'vitest';
import {
  ProcessingItemStatus,
  ProcessingPipelineStatus,
  UserRole,
} from '@prisma/client';
import {
  buildProcessingReportWhere,
  canGenerateProcessingReports,
  formatProcessingAuditActivity,
  latestProcessingActivity,
  latestServiceActivity,
  PROCESSING_REPORT_STATUSES,
  remainingProcessingServices,
  validateProcessingReportStatuses,
} from './processingPipelineReports';

const manager = {
  id: 'manager-1',
  role: UserRole.MANAGER,
  processingAssignmentGroups: [],
};

describe('processing report permissions and scope', () => {
  it.each([
    UserRole.PROCESSOR_JR,
    UserRole.PROCESSOR_SR,
    UserRole.MANAGER,
    UserRole.PROCESSING_MANAGER,
    UserRole.ADMIN,
    UserRole.ADMIN_I,
    UserRole.ADMIN_II,
    UserRole.ADMIN_III,
  ])('allows %s to generate reports', (role) => {
    expect(canGenerateProcessingReports(role)).toBe(true);
  });

  it.each([UserRole.LOAN_OFFICER, UserRole.LOA, UserRole.QC])(
    'denies %s',
    (role) => {
      expect(canGenerateProcessingReports(role)).toBe(false);
    },
  );

  it('intersects the base scope with selected Team loan officers', () => {
    const where = buildProcessingReportWhere(manager, ['lo-1', 'lo-2']);
    const serialized = JSON.stringify(where);
    expect(serialized).toContain('"archivedAt":null');
    expect(serialized).toContain('"secondaryLoanOfficerId":{"in":["lo-1","lo-2"]}');
    expect(serialized).toContain('"loanOfficerId":{"in":["lo-1","lo-2"]}');
  });

  it('keeps Jr Processors inside their assignment scope', () => {
    const where = buildProcessingReportWhere({
      id: 'jr-1',
      role: UserRole.PROCESSOR_JR,
      processingAssignmentGroups: ['Jack Team'],
    });
    const serialized = JSON.stringify(where);
    expect(serialized).toContain('"juniorProcessorId":"jr-1"');
    expect(serialized).toContain('"assignmentGroup":{"in":["Jack Team"]}');
  });

  it('includes only active sheets and treats rate lock as a row flag', () => {
    const serialized = JSON.stringify(buildProcessingReportWhere(manager));
    expect(serialized).toContain('"PIPELINE"');
    expect(serialized).toContain('"RESTRUCTURE"');
    expect(serialized).not.toContain('"FUNDING"');
    expect(serialized).not.toContain('rateLockRequestedAt');
  });
});

describe('processing report calculations', () => {
  it('validates and deduplicates selected statuses', () => {
    expect(
      validateProcessingReportStatuses([
        ProcessingPipelineStatus.DOCS_OUT,
        ProcessingPipelineStatus.DOCS_OUT,
      ]),
    ).toEqual({
      success: true,
      statuses: [ProcessingPipelineStatus.DOCS_OUT],
    });
    expect(validateProcessingReportStatuses([]).success).toBe(false);
    expect(
      validateProcessingReportStatuses([
        ProcessingPipelineStatus.FUNDED,
      ]).success,
    ).toBe(false);
    expect(PROCESSING_REPORT_STATUSES).not.toContain(
      ProcessingPipelineStatus.FUNDED,
    );
  });

  it('uses the newest audit for last touch and formats its detail', () => {
    const now = new Date('2026-09-18T12:00:00.000Z');
    const result = latestProcessingActivity(
      [
        {
          action: 'PROCESSING_PIPELINE_FIELD_CHANGED',
          details: JSON.stringify({
            field: 'titleStatus',
            previousValue: 'NOT_STARTED',
            newValue: 'ORDERED',
          }),
          createdAt: '2026-09-17T12:00:00.000Z',
          actor: 'New Actor',
        },
        {
          action: 'PROCESSING_PIPELINE_MOVED',
          details: null,
          createdAt: '2026-09-10T12:00:00.000Z',
          actor: 'Old Actor',
        },
      ],
      '2026-09-01T12:00:00.000Z',
      now,
    );
    expect(result.item).toBe('Title Status: Not started → ordered');
    expect(result.actor).toBe('New Actor');
    expect(result.age).toBe('1 day ago');
  });

  it('falls back cleanly when no usable audit exists', () => {
    const result = latestProcessingActivity(
      [],
      '2026-09-18T11:00:00.000Z',
      new Date('2026-09-18T12:00:00.000Z'),
    );
    expect(result).toMatchObject({
      item: 'Pipeline record created',
      actor: 'System',
      age: '1 hour ago',
    });
  });

  it('derives field-level service age without using unrelated audits', () => {
    const result = latestServiceActivity(
      'payoff',
      [
        {
          action: 'PROCESSING_PIPELINE_FIELD_CHANGED',
          details: JSON.stringify({ field: 'hoiStatus' }),
          createdAt: '2026-09-18T11:00:00.000Z',
          actor: 'Processor',
        },
        {
          action: 'PROCESSING_PIPELINE_FIELD_CHANGED',
          details: JSON.stringify({ field: 'payoffExpiresAt' }),
          createdAt: '2026-09-16T12:00:00.000Z',
          actor: 'Processor',
        },
      ],
      '2026-09-01T12:00:00.000Z',
      new Date('2026-09-18T12:00:00.000Z'),
    );
    expect(result.source).toBe('AUDIT');
    expect(result.age).toBe('2 days ago');
  });

  it('recognizes service fields saved from the borrower workspace', () => {
    const result = latestServiceActivity(
      'appraisal',
      [
        {
          action: 'PROCESSING_BORROWER_DETAILS_UPDATED',
          details: JSON.stringify({
            source: 'borrower_workspace',
            fields: ['appraisalScheduledAt', 'extraNotes'],
          }),
          createdAt: '2026-09-18T10:00:00.000Z',
          actor: 'Processor',
        },
      ],
      '2026-09-01T12:00:00.000Z',
      new Date('2026-09-18T12:00:00.000Z'),
    );
    expect(result).toMatchObject({
      source: 'AUDIT',
      age: '2 hours ago',
    });
  });

  it('summarizes only incomplete services', () => {
    expect(
      remainingProcessingServices({
        titleStatus: ProcessingItemStatus.RECEIVED,
        hoiStatus: ProcessingItemStatus.ORDERED,
        payoffStatus: ProcessingItemStatus.NOT_APPLICABLE,
        appraisalNeeded: true,
        appraisalBackAt: null,
      }),
    ).toEqual(['HOI', 'Appraisal']);
  });

  it('formats bucket moves from audit details', () => {
    expect(
      formatProcessingAuditActivity({
        action: 'PROCESSING_PIPELINE_MOVED',
        details: JSON.stringify({
          fromSheet: 'PIPELINE',
          toSheet: 'RESTRUCTURE',
        }),
        createdAt: '2026-09-18T12:00:00.000Z',
        actor: 'Manager',
      }),
    ).toBe('Moved pipeline → restructure');
  });
});
