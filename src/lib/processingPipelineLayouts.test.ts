import { describe, expect, it } from 'vitest';
import { UserRole } from '@prisma/client';
import {
  buildDefaultProcessingLayoutConfig,
  mandatoryColumnsForBucket,
  normalizeProcessingLayoutConfig,
  normalizeProcessingLayoutName,
  processingLayoutBucketColumns,
} from './processingPipelineLayouts';

describe('processing pipeline saved layouts', () => {
  it('builds independent defaults for every bucket', () => {
    const config = buildDefaultProcessingLayoutConfig(UserRole.MANAGER);

    expect(config.buckets.PIPELINE.columns).not.toBe(
      config.buckets.RESTRUCTURE.columns,
    );
    expect(
      config.buckets.RESTRUCTURE.columns.some(
        (column) => column.id === 'restructureNotes',
      ),
    ).toBe(true);
    expect(
      config.buckets.FUNDING.columns.every((column) => column.visible),
    ).toBe(true);
  });

  it('keeps mandatory columns visible while preserving their custom order', () => {
    const config = buildDefaultProcessingLayoutConfig(UserRole.MANAGER);
    const columns = config.buckets.PIPELINE.columns;
    const borrowerIndex = columns.findIndex(
      (column) => column.id === 'borrowerName',
    );
    const [borrower] = columns.splice(borrowerIndex, 1);
    borrower.visible = false;
    columns.unshift(borrower);

    const result = normalizeProcessingLayoutConfig(config, UserRole.MANAGER);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.config.buckets.PIPELINE.columns[0]).toMatchObject({
      id: 'borrowerName',
      visible: true,
    });
  });

  it('removes processor-restricted financial and lead columns', () => {
    const ids = processingLayoutBucketColumns(
      'PIPELINE',
      UserRole.PROCESSOR_SR,
    ).map((column) => column.id);

    expect(ids).not.toContain('loanAmount');
    expect(ids).not.toContain('projectedRevenue');
    expect(ids).not.toContain('leadSource');
  });

  it('rejects duplicate columns and invalid widths', () => {
    const duplicateConfig = buildDefaultProcessingLayoutConfig(UserRole.MANAGER);
    duplicateConfig.buckets.PIPELINE.columns.push({
      ...duplicateConfig.buckets.PIPELINE.columns[0],
    });
    expect(
      normalizeProcessingLayoutConfig(duplicateConfig, UserRole.MANAGER).success,
    ).toBe(false);

    const widthConfig = buildDefaultProcessingLayoutConfig(UserRole.MANAGER);
    widthConfig.buckets.PIPELINE.columns[0].width = 999;
    expect(
      normalizeProcessingLayoutConfig(widthConfig, UserRole.MANAGER).success,
    ).toBe(false);
  });

  it('requires all applicable identity and status columns', () => {
    expect(mandatoryColumnsForBucket('PIPELINE', UserRole.LOAN_OFFICER)).toEqual([
      'dateAssigned',
      'loanNumber',
      'loanOfficer',
      'borrowerName',
      'pipelineStatus',
    ]);
    expect(mandatoryColumnsForBucket('FUNDING', UserRole.LOAN_OFFICER)).toEqual([
      'dateAssigned',
      'loanNumber',
      'loanOfficer',
      'borrowerName',
    ]);
  });

  it('normalizes names for case-insensitive uniqueness', () => {
    expect(normalizeProcessingLayoutName('  My   Daily View  ')).toEqual({
      success: true,
      name: 'My Daily View',
      nameKey: 'my daily view',
    });
    expect(normalizeProcessingLayoutName('')).toMatchObject({ success: false });
  });
});
