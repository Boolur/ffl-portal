import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

type LoanVisibilityShape = {
  loanOfficerId: string;
  secondaryLoanOfficerId?: string | null;
  visibilitySubmitterUserId?: string | null;
};

export function buildLoanOfficerLoanOrClauses(userId: string): Prisma.LoanWhereInput[] {
  return [
    { loanOfficerId: userId },
    { secondaryLoanOfficerId: userId },
    { visibilitySubmitterUserId: userId },
  ];
}

export function buildLoanOfficerLoanWhere(userId?: string | null): Prisma.LoanWhereInput {
  if (!userId) return { id: '__none__' };
  return { OR: buildLoanOfficerLoanOrClauses(userId) };
}

/**
 * Synchronous builder that produces a Task where-clause using a
 * nested relation filter (`loan: { OR: [...] }`). Prisma compiles
 * this to a correlated EXISTS subquery against Loan, which in
 * production has been the dominant cost for every LO-scoped Task
 * query once the Loan table grew past ~100k rows.
 *
 * Prefer {@link resolveLoanOfficerTaskWhere} whenever the caller is
 * already async -- it pre-resolves the user's loan ids and collapses
 * the query to a plain `loanId IN (...)` lookup which hits the
 * `Task(loanId, ...)` indexes directly.
 *
 * This synchronous form is retained for callers that need a pure
 * where-shape (serializable, composable with other filters, used
 * inside transactions where a separate round trip is undesirable).
 */
export function buildLoanOfficerTaskWhere(userId?: string | null): Prisma.TaskWhereInput {
  if (!userId) return { id: '__none__' };
  return {
    OR: [
      {
        loan: {
          OR: buildLoanOfficerLoanOrClauses(userId),
        },
      },
    ],
  };
}

/**
 * Async LO Task scope: pre-fetches the user's loan ids and returns a
 * where-clause shaped as `{ loanId: { in: [...] } }`. Cheap because
 * Loan has indexes on every LO-facing column; the subsequent Task
 * query then uses `Task_loanId_dueDate_idx` / `Task_loanId_updatedAt_idx`
 * directly instead of a correlated subquery.
 */
export async function resolveLoanOfficerTaskWhere(
  userId?: string | null
): Promise<Prisma.TaskWhereInput> {
  if (!userId) return { id: '__none__' };
  const loans = await prisma.loan.findMany({
    where: { OR: buildLoanOfficerLoanOrClauses(userId) },
    select: { id: true },
  });
  if (loans.length === 0) return { id: '__none__' };
  return { loanId: { in: loans.map((l) => l.id) } };
}

export function canLoanOfficerViewLoan(loan: LoanVisibilityShape, userId: string): boolean {
  return (
    loan.loanOfficerId === userId ||
    loan.secondaryLoanOfficerId === userId ||
    loan.visibilitySubmitterUserId === userId
  );
}
