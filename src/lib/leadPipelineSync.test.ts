import { describe, expect, it, vi } from 'vitest';
import { LeadStatus, Prisma, TaskKind } from '@prisma/client';
import {
  buildLeadMatchCandidates,
  findUniqueLeadPipelineMatch,
  leadStatusForTaskKind,
  normalizeLeadPipelineAddress,
  normalizeLeadPipelinePhone,
  shouldReplaceLeadPipelineStatus,
  syncLeadStatusForLoan,
} from './leadPipelineSync';

function asTx(value: unknown) {
  return value as Prisma.TransactionClient;
}

const baseLead = {
  id: 'lead-1',
  status: LeadStatus.NEW,
  firstName: 'Jane',
  lastName: 'Borrower',
  email: 'jane@example.com',
  phone: '(555) 111-2222',
  homePhone: null,
  workPhone: null,
  coFirstName: null,
  coLastName: null,
  coEmail: null,
  coPhone: null,
  coHomePhone: null,
  coWorkPhone: null,
  propertyAddress: '123 Main Street Apt 4',
  propertyCity: 'Anaheim',
  propertyState: 'CA',
  propertyZip: '92801',
  mailingAddress: null,
  mailingCity: null,
  mailingState: null,
  mailingZip: null,
};

describe('lead pipeline matching helpers', () => {
  it('normalizes common phone and address variations', () => {
    expect(normalizeLeadPipelinePhone('+1 (555) 111-2222')).toBe('5551112222');
    expect(normalizeLeadPipelineAddress('123 Main Street, Apt 4')).toBe('123 main st');
  });

  it('matches a lead by borrower name plus a strong signal', () => {
    const candidates = buildLeadMatchCandidates(
      {
        id: 'loan-1',
        loanNumber: '17112767',
        borrowerName: 'Jane Borrower',
        borrowerFirstName: 'Jane',
        borrowerLastName: 'Borrower',
        borrowerEmail: null,
        borrowerPhone: null,
        propertyAddress: '123 Main St, Anaheim, CA 92801',
      },
      null,
    );

    expect(findUniqueLeadPipelineMatch(candidates, [baseLead])).toMatchObject({
      kind: 'matched',
      lead: { id: 'lead-1' },
    });
  });

  it('fails closed when more than one lead matches', () => {
    const candidates = buildLeadMatchCandidates(
      {
        id: 'loan-1',
        loanNumber: '17112767',
        borrowerName: 'Jane Borrower',
        borrowerFirstName: 'Jane',
        borrowerLastName: 'Borrower',
        borrowerEmail: 'jane@example.com',
        borrowerPhone: null,
        propertyAddress: null,
      },
      null,
    );

    expect(
      findUniqueLeadPipelineMatch(candidates, [
        baseLead,
        { ...baseLead, id: 'lead-2', propertyAddress: '9 Other Rd' },
      ]),
    ).toMatchObject({
      kind: 'ambiguous',
      matchedLeadIds: ['lead-1', 'lead-2'],
    });
  });

  it('maps task milestones and prevents lower statuses from overwriting higher progress', () => {
    expect(leadStatusForTaskKind(TaskKind.SUBMIT_PLUS_ONE)).toBe(
      LeadStatus.SUBMITTED_PLUS_ONE,
    );
    expect(leadStatusForTaskKind(TaskKind.SUBMIT_DISCLOSURES)).toBe(
      LeadStatus.SUBMITTED_DISCLOSURES,
    );
    expect(leadStatusForTaskKind(TaskKind.SUBMIT_PROCESSING)).toBe(
      LeadStatus.SUBMITTED_PROCESSING,
    );
    expect(
      shouldReplaceLeadPipelineStatus(
        LeadStatus.SUBMITTED_PROCESSING,
        LeadStatus.SUBMITTED_DISCLOSURES,
      ),
    ).toBe(false);
  });
});

describe('syncLeadStatusForLoan', () => {
  it('updates exactly one matched lead and writes an audit entry', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'lead-1' });
    const auditCreate = vi.fn().mockResolvedValue({ id: 'audit-1' });
    const tx = asTx({
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
      task: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'task-1',
          kind: TaskKind.SUBMIT_DISCLOSURES,
          loanId: 'loan-1',
          submissionData: null,
        }),
      },
      lead: {
        findMany: vi.fn().mockResolvedValue([baseLead]),
        update,
      },
      auditLog: { create: auditCreate },
    });

    await expect(
      syncLeadStatusForLoan(tx, {
        loanId: 'loan-1',
        taskId: 'task-1',
        nextStatus: LeadStatus.SUBMITTED_DISCLOSURES,
        actorId: 'user-1',
        source: 'test',
      }),
    ).resolves.toMatchObject({
      kind: 'updated',
      leadId: 'lead-1',
      previousStatus: LeadStatus.NEW,
      nextStatus: LeadStatus.SUBMITTED_DISCLOSURES,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: { status: LeadStatus.SUBMITTED_DISCLOSURES },
    });
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'LEAD_PIPELINE_STATUS_SYNCED',
        loanId: 'loan-1',
        userId: 'user-1',
      }),
    }));
  });
});
