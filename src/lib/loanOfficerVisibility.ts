import { Prisma } from '@prisma/client';

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

export function canLoanOfficerViewLoan(loan: LoanVisibilityShape, userId: string): boolean {
  return (
    loan.loanOfficerId === userId ||
    loan.secondaryLoanOfficerId === userId ||
    loan.visibilitySubmitterUserId === userId
  );
}
