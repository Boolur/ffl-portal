import { describe, expect, it, vi } from 'vitest';
import { LeadStatus, Prisma, TaskKind } from '@prisma/client';
import {
  resolveSeniorProcessorForGroup,
  upsertProcessingPipelineForCompletedTask,
} from './processingPipelineService';
import { getProcessingAssignmentGroupForSeniorName } from './processingRouting';
import { ARIVE_SYNC_PILOT } from './ariveSyncTypes';

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
  function existingSubmission(options: { lender?: string; processingMethod?: string; loanId?: string; enabled?: boolean } = {}) {
    const loanId = options.loanId ?? ARIVE_SYNC_PILOT.loanId;
    const order: string[] = [];
    let current = {
      id: 'pilot-pipeline', loanId, sourceTaskId: 'previous-task', version: 7,
      finalRevenue: new Prisma.Decimal(6200), projectedRevenue: new Prisma.Decimal(5000),
      sheet: 'PIPELINE', pipelineStatus: 'CTC', statusChangedAt: new Date('2026-11-01T00:00:00Z'),
      titleStatus: 'ORDERED', payoffStatus: 'ORDERED', hoiStatus: 'NOT_STARTED',
      payoffOrderedAt: new Date('2026-10-25T00:00:00Z'), payoffExpiresAt: new Date('2026-11-20T00:00:00Z'),
      hoiOrderedAt: new Date('2026-10-26T00:00:00Z'), appraisalNeeded: true,
      cdSent: false, cdWarningStartsAt: new Date('2026-10-29T00:00:00Z'),
      rateLock: false, rateLockExpiresAt: null, rateLockConfirmedAt: null as Date | null,
      rateLockRequestedAt: new Date('2026-11-05T12:00:00Z'), rateLockRequestedById: 'requesting-lo',
      firstPaymentAt: new Date('2027-01-01T00:00:00Z'), sixthPaymentAt: new Date('2027-06-01T00:00:00Z'),
    };
    const managed = Object.fromEntries([
      'sheet', 'pipelineStatus', 'statusChangedAt', 'titleStatus', 'payoffStatus', 'hoiStatus',
      'payoffOrderedAt', 'payoffExpiresAt', 'hoiOrderedAt', 'appraisalNeeded',
      'cdSent', 'cdWarningStartsAt', 'rateLock', 'rateLockExpiresAt', 'rateLockConfirmedAt',
    ].map(field => [field, current[field as keyof typeof current]]));
    const state = { enabled: options.enabled ?? true, snapshot: { managed }, fieldSources: { pendingItems: { author: 'Arive processor' } } };
    const db = {
      $executeRaw: vi.fn(async (...args: unknown[]) => { void args; order.push('lock'); return 1; }),
      task: { findUnique: vi.fn().mockResolvedValue({
        id: 'resubmitted-task', loanId, kind: TaskKind.SUBMIT_PROCESSING, assignedUserId: 'junior-2',
        submissionData: {
          processingAssignmentGroup: 'MARTIN_SON_BUI', processingMethod: options.processingMethod ?? 'IN_HOUSE',
          investor: options.lender ?? 'AVEN', appraisalNeeded: 'No', projectedRevenue: '$4,500',
        },
        loan: { id: loanId, program: null },
      }) },
      loan: { findUnique: vi.fn().mockResolvedValue({ id: loanId, loanNumber: '17881588', borrowerName: 'TESTING TESTER' }) },
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'senior-2' }]) },
      lead: { findMany: vi.fn().mockResolvedValue([]) },
      processingPipelineLoan: {
        findUnique: vi.fn(async (query: { select?: unknown }) => {
          order.push(query.select ? 'reference' : 'fresh-row');
          return query.select ? { id: current.id, finalRevenue: current.finalRevenue } : { ...current };
        }),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          order.push('update');
          current = { ...current, ...data, version: data.version ? current.version + 1 : current.version };
          return current;
        }),
        create: vi.fn(),
      },
      arivePipelineSync: { findUnique: vi.fn().mockResolvedValue(state), update: vi.fn() },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit' }) },
      notificationOutbox: { upsert: vi.fn().mockResolvedValue({ id: 'outbox' }) },
    };
    return { db, tx: asTx(db), state, order, get current() { return current; } };
  }

  it.each([
    { lender: 'AVEN', processingMethod: 'IN_HOUSE' },
    { lender: 'UWM', processingMethod: 'THIRD_PARTY' },
  ])('retains imported milestones and payment dates when an enabled pilot submission is completed again ($lender)', async options => {
    const h = existingSubmission(options);
    const before = { ...h.current };
    const sourceBefore = structuredClone(h.state);
    await upsertProcessingPipelineForCompletedTask(h.tx, {
      taskId: 'resubmitted-task', actorId: 'reviewing-jr', completedAt: new Date('2026-11-06T12:00:00Z'),
    });
    expect(h.current).toMatchObject({
      ...before, sourceTaskId: 'resubmitted-task', version: 8,
      projectedRevenue: 4500, seniorProcessorId: 'senior-2', juniorProcessorId: 'junior-2',
    });
    expect(h.order).toEqual(['reference', 'lock', 'fresh-row', 'update']);
    expect(h.db.$executeRaw.mock.calls[0]?.[1]).toBe('arive-pipeline:pilot-pipeline');
    expect(h.db.processingPipelineLoan.update.mock.calls[0][0].data).not.toHaveProperty('finalRevenue');
    expect(h.db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      userId: 'reviewing-jr', action: 'PROCESSING_PIPELINE_REFRESHED',
    }) }));
    expect(h.db.arivePipelineSync.update).not.toHaveBeenCalled();
    expect(h.state).toEqual(sourceBefore);
  });

  it('preserves the sync result committed while a repeated completion was waiting for the pipeline lock', async () => {
    const h = existingSubmission();
    h.db.$executeRaw.mockImplementationOnce(async () => {
      h.order.push('lock');
      // Represents another transaction committing before our advisory lock resolves.
      h.current.titleStatus = 'RECEIVED';
      h.current.payoffOrderedAt = new Date('2026-11-05T00:00:00Z');
      h.current.rateLock = true;
      h.current.rateLockConfirmedAt = new Date('2026-11-05T14:00:00Z');
      h.current.finalRevenue = new Prisma.Decimal(7000);
      h.current.version = 8;
      return 1;
    });
    await upsertProcessingPipelineForCompletedTask(h.tx, { taskId: 'resubmitted-task', actorId: 'reviewing-jr' });
    expect(h.current).toMatchObject({ titleStatus: 'RECEIVED', payoffOrderedAt: new Date('2026-11-05T00:00:00Z'),
      rateLock: true, rateLockConfirmedAt: new Date('2026-11-05T14:00:00Z'), finalRevenue: new Prisma.Decimal(7000), version: 9 });
    expect(h.order.indexOf('fresh-row')).toBeGreaterThan(h.order.indexOf('lock'));
  });

  it.each([
    { loanId: ARIVE_SYNC_PILOT.loanId, enabled: false },
    { loanId: 'ordinary-loan', enabled: true },
  ])('retains the legacy completion behavior for paused or unrelated loans ($loanId, enabled $enabled)', async options => {
    const h = existingSubmission(options);
    await upsertProcessingPipelineForCompletedTask(h.tx, {
      taskId: 'resubmitted-task', actorId: 'reviewing-jr', completedAt: new Date('2026-11-06T12:00:00Z'),
    });
    expect(h.current).toMatchObject({ titleStatus: 'RECEIVED', payoffStatus: 'RECEIVED', hoiStatus: 'RECEIVED',
      payoffOrderedAt: null, rateLock: true, rateLockRequestedAt: null, appraisalNeeded: false, version: 7 });
    expect(h.db.processingPipelineLoan.update.mock.calls[0][0].data).not.toHaveProperty('version');
    if (options.loanId !== ARIVE_SYNC_PILOT.loanId) {
      expect(h.db.$executeRaw).not.toHaveBeenCalled();
      expect(h.db.arivePipelineSync.findUnique).not.toHaveBeenCalled();
    }
  });

  it('creates once, then refreshes the existing loan row and audits both events', async () => {
    let existing: { id: string; finalRevenue: number | null } | null = null;
    const create = vi.fn(async () => {
      existing = { id: 'pipeline-1', finalRevenue: 4500 };
      return existing;
    });
    const update = vi.fn(async (input: unknown) => {
      void input;
      return existing;
    });
    const auditCreate = vi.fn().mockResolvedValue({ id: 'audit-1' });
    const tx = asTx({
      task: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'task-1',
          loanId: 'loan-1',
          kind: TaskKind.SUBMIT_PROCESSING,
          assignedUserId: 'junior-1',
          submissionData: {
            processingMethod: 'IN_HOUSE',
            processingAssignmentGroup: 'MARTIN_SON_BUI',
            appraisalWaiver: 'No',
            appraisalNeeded: 'No',
            appraisalNotes: 'Existing appraisal remains valid.',
            loanType: 'Conventional',
            loanProgram: 'Cash out',
            propertyState: 'CA',
            investor: 'UWM',
            projectedRevenue: '$4,500',
          },
          loan: { id: 'loan-1', program: null },
        }),
      },
      loan: {
        update: vi.fn().mockResolvedValue({
          id: 'loan-1',
          program: 'Cash out',
        }),
        findUnique: vi.fn().mockResolvedValue({
          id: 'loan-1',
          loanNumber: '17112767',
          borrowerName: 'Pipeline Borrower',
          borrowerFirstName: 'Pipeline',
          borrowerLastName: 'Borrower',
          borrowerEmail: 'pipeline@example.com',
          borrowerPhone: '5551112222',
          propertyAddress: '10 Main St',
        }),
      },
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: 'senior-1' }]),
      },
      lead: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      processingPipelineLoan: {
        findUnique: vi.fn(async () => existing),
        create,
        update,
      },
      notificationOutbox: {
        upsert: vi.fn().mockResolvedValue({ id: 'outbox-1' }),
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
        processingMethod: 'IN_HOUSE',
        appraisalNeeded: false,
        appraisalNotes: 'Existing appraisal remains valid.',
        propertyState: 'CA',
        lender: 'UWM',
        projectedRevenue: 4500,
        finalRevenue: 4500,
      }),
    }));
    const updateInput = update.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(updateInput.data).not.toHaveProperty('finalRevenue');
    expect(tx.loan.update).toHaveBeenCalledWith({
      where: { id: 'loan-1' },
      data: { program: 'Cash out' },
    });
    expect(auditCreate).toHaveBeenCalledTimes(2);
    expect(auditCreate.mock.calls[0][0].data.action).toBe('PROCESSING_PIPELINE_CREATED');
    expect(auditCreate.mock.calls[1][0].data.action).toBe('PROCESSING_PIPELINE_REFRESHED');
  });

  it('syncs a matched lead to submitted processing when the row is created', async () => {
    const auditCreate = vi.fn().mockResolvedValue({ id: 'audit-1' });
    const leadUpdate = vi.fn().mockResolvedValue({ id: 'lead-1' });
    const pipelineCreate = vi.fn().mockResolvedValue({ id: 'pipeline-1' });
    const tx = asTx({
      task: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'task-1',
          loanId: 'loan-1',
          kind: TaskKind.SUBMIT_PROCESSING,
          assignedUserId: 'junior-1',
          submissionData: {
            borrowerFirstName: 'Jane',
            borrowerLastName: 'Borrower',
            borrowerEmail: 'jane@example.com',
          },
          loan: { id: 'loan-1', program: 'Purchase' },
        }),
      },
      loan: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'loan-1',
          loanNumber: '17112767',
          borrowerName: 'Jane Borrower',
          borrowerFirstName: 'Jane',
          borrowerLastName: 'Borrower',
          borrowerEmail: 'jane@example.com',
          borrowerPhone: null,
          propertyAddress: null,
        }),
      },
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: 'senior-1' }]),
      },
      lead: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'lead-1',
          status: LeadStatus.HOT,
          firstName: 'Jane',
          lastName: 'Borrower',
          email: 'jane@example.com',
          phone: null,
          homePhone: null,
          workPhone: null,
          coFirstName: null,
          coLastName: null,
          coEmail: null,
          coPhone: null,
          coHomePhone: null,
          coWorkPhone: null,
          propertyAddress: null,
          propertyCity: null,
          propertyState: null,
          propertyZip: null,
          mailingAddress: null,
          mailingCity: null,
          mailingState: null,
          mailingZip: null,
        }]),
        update: leadUpdate,
      },
      processingPipelineLoan: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: pipelineCreate,
      },
      notificationOutbox: {
        upsert: vi.fn().mockResolvedValue({ id: 'outbox-1' }),
      },
      auditLog: { create: auditCreate },
    });

    await upsertProcessingPipelineForCompletedTask(tx, {
      taskId: 'task-1',
      actorId: 'junior-1',
      completedAt: new Date('2026-08-05T20:00:00.000Z'),
    });

    expect(leadUpdate).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: { status: LeadStatus.SUBMITTED_PROCESSING },
    });
    expect(pipelineCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ loanType: null }),
      }),
    );
    expect(auditCreate).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'LEAD_PIPELINE_STATUS_SYNCED',
      }),
    }));
  });
});
