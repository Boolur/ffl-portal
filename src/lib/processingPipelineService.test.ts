import { describe, expect, it, vi } from 'vitest';
import { Prisma, TaskKind } from '@prisma/client';
import {
  resolveSeniorProcessorForGroup,
  upsertProcessingPipelineForCompletedTask,
} from './processingPipelineService';
import { getProcessingAssignmentGroupForSeniorName } from './processingRouting';

function asTx(value: unknown) {
  return value as Prisma.TransactionClient;
}

describe('resolveSeniorProcessorForGroup', () => {
  it('returns the single configured Sr Processor', async () => {
    const tx = asTx({
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: 'senior-1' }]),
      },
    });
    await expect(resolveSeniorProcessorForGroup(tx, 'KATHY_BUI')).resolves.toEqual({
      seniorProcessorId: 'senior-1',
      resolution: 'MATCHED_BY_GROUP',
    });
  });

  it('falls back to the selected processor name when no group was configured', async () => {
    const findMany = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'senior-kathy' }]);
    const tx = asTx({ user: { findMany } });

    await expect(resolveSeniorProcessorForGroup(tx, 'KATHY_BUI')).resolves.toEqual({
      seniorProcessorId: 'senior-kathy',
      resolution: 'MATCHED_BY_NAME',
    });
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        name: { in: ['Kathy Bui'], mode: 'insensitive' },
      }),
    }));
  });

  it('fails closed for ambiguous assignments', async () => {
    const tx = asTx({
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: 'senior-1' }, { id: 'senior-2' }]),
      },
    });
    await expect(resolveSeniorProcessorForGroup(tx, 'JACK_NGO')).resolves.toEqual({
      seniorProcessorId: null,
      resolution: 'AMBIGUOUS',
    });
  });
});

describe('Sr Processor account-name mapping', () => {
  it('maps exact selection names and the known Martin account alias', () => {
    expect(getProcessingAssignmentGroupForSeniorName('Kathy Bui')).toBe('KATHY_BUI');
    expect(getProcessingAssignmentGroupForSeniorName('Jack Ngo')).toBe('JACK_NGO');
    expect(getProcessingAssignmentGroupForSeniorName('Martin Son Bui')).toBe('MARTIN_SON_BUI');
    expect(getProcessingAssignmentGroupForSeniorName('Martin Bui')).toBe('MARTIN_SON_BUI');
  });
});

describe('upsertProcessingPipelineForCompletedTask', () => {
  it('creates once, then refreshes the existing loan row and audits both events', async () => {
    let existing: { id: string } | null = null;
    const create = vi.fn(async () => {
      existing = { id: 'pipeline-1' };
      return existing;
    });
    const update = vi.fn(async () => existing);
    const auditCreate = vi.fn().mockResolvedValue({ id: 'audit-1' });
    const tx = asTx({
      task: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'task-1',
          loanId: 'loan-1',
          kind: TaskKind.SUBMIT_PROCESSING,
          assignedUserId: 'junior-1',
          submissionData: {
            processingAssignmentGroup: 'MARTIN_SON_BUI',
            appraisalWaiver: 'No',
            loanType: 'Conventional',
            investor: 'UWM',
            projectedRevenue: '$4,500',
          },
          loan: { id: 'loan-1', program: null },
        }),
      },
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: 'senior-1' }]),
      },
      processingPipelineLoan: {
        findUnique: vi.fn(async () => existing),
        create,
        update,
      },
      auditLog: { create: auditCreate },
    });

    const first = await upsertProcessingPipelineForCompletedTask(tx, {
      taskId: 'task-1',
      actorId: 'junior-1',
      completedAt: new Date('2026-08-05T20:00:00.000Z'),
    });
    const second = await upsertProcessingPipelineForCompletedTask(tx, {
      taskId: 'task-1',
      actorId: 'junior-1',
      completedAt: new Date('2026-08-05T20:00:00.000Z'),
    });

    expect(first?.id).toBe('pipeline-1');
    expect(second?.id).toBe('pipeline-1');
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        seniorProcessorId: 'senior-1',
        juniorProcessorId: 'junior-1',
        appraisalNeeded: true,
        lender: 'UWM',
        projectedRevenue: 4500,
      }),
    }));
    expect(auditCreate).toHaveBeenCalledTimes(2);
    expect(auditCreate.mock.calls[0][0].data.action).toBe('PROCESSING_PIPELINE_CREATED');
    expect(auditCreate.mock.calls[1][0].data.action).toBe('PROCESSING_PIPELINE_REFRESHED');
  });
});
