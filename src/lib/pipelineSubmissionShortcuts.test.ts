import { describe, expect, it } from 'vitest';
import { TaskKind, TaskStatus } from '@prisma/client';
import {
  buildPipelineSubmissionPrefill,
  derivePipelineSubmissionShortcuts,
} from './pipelineSubmissionShortcuts';

const completed = (kind: TaskKind) => ({
  kind,
  status: TaskStatus.COMPLETED,
  completedAt: new Date('2026-08-20T12:00:00Z'),
});

describe('pipeline submission shortcut eligibility', () => {
  it('offers both downstream submissions after a completed +1', () => {
    expect(
      derivePipelineSubmissionShortcuts(
        'plusOne',
        [completed(TaskKind.SUBMIT_PLUS_ONE)],
        true,
      ),
    ).toEqual({ disclosures: true, processing: true });
  });

  it('advances from a completed disclosure and blocks existing targets', () => {
    const history = [
      completed(TaskKind.SUBMIT_PLUS_ONE),
      completed(TaskKind.SUBMIT_DISCLOSURES),
    ];
    expect(
      derivePipelineSubmissionShortcuts('disclosures', history, true),
    ).toEqual({ disclosures: false, processing: true });

    expect(
      derivePipelineSubmissionShortcuts(
        'disclosures',
        [...history, {
          kind: TaskKind.SUBMIT_PROCESSING,
          status: TaskStatus.PENDING,
          completedAt: null,
        }],
        true,
      ),
    ).toEqual({ disclosures: false, processing: false });
  });

  it('requires completion and submission permission', () => {
    const pendingPlusOne = [{
      kind: TaskKind.SUBMIT_PLUS_ONE,
      status: TaskStatus.PENDING,
      completedAt: null,
    }];
    expect(
      derivePipelineSubmissionShortcuts('plusOne', pendingPlusOne, true),
    ).toEqual({ disclosures: false, processing: false });
    expect(
      derivePipelineSubmissionShortcuts(
        'plusOne',
        [completed(TaskKind.SUBMIT_PLUS_ONE)],
        false,
      ),
    ).toEqual({ disclosures: false, processing: false });
  });

  it('allows resubmission when a deleted target is absent from history', () => {
    expect(
      derivePipelineSubmissionShortcuts(
        'plusOne',
        [completed(TaskKind.SUBMIT_PLUS_ONE)],
        true,
      ).disclosures,
    ).toBe(true);
  });
});

describe('pipeline submission prefill', () => {
  it('uses canonical loan identity while retaining safe reusable fields', () => {
    const prefill = buildPipelineSubmissionPrefill(
      {
        id: 'loan-1',
        loanNumber: '17112767',
        borrowerName: 'Canonical Borrower',
        borrowerFirstName: 'Current',
        borrowerLastName: 'Borrower',
        borrowerPhone: '5551112222',
        borrowerEmail: 'current@example.com',
        amount: '325000.00',
        program: 'Conventional',
        propertyAddress: '10 Main St',
        loanOfficerId: 'lo-1',
        secondaryLoanOfficerId: null,
        loanOfficer: { name: 'Primary LO' },
      },
      {
        arriveLoanNumber: 'STALE',
        borrowerFirstName: 'Stale',
        borrowerEmail: 'stale@example.com',
        investor: 'UWM',
        leadSource: 'Mailer',
        projectedRevenue: '6500',
        creditCardNumber: '4111111111111111',
        workflowVersion: 'internal',
      },
    );

    expect(prefill).toMatchObject({
      loanId: 'loan-1',
      arriveLoanNumber: '17112767',
      borrowerFirstName: 'Current',
      borrowerLastName: 'Borrower',
      borrowerEmail: 'current@example.com',
      loanOfficerId: 'lo-1',
      secondaryLoanOfficerId: '__NA__',
      investor: 'UWM',
      lender: 'UWM',
      leadSource: 'Mailer',
      projectedRevenue: '6500',
    });
    expect(prefill).not.toHaveProperty('creditCardNumber');
    expect(prefill).not.toHaveProperty('workflowVersion');
  });
});
