import { PayrollCompRequestStatus } from '@prisma/client';

type CompensationSplit = { roleLabel: string; amount: number };

export function loanOfficerFinalComp(splits: readonly CompensationSplit[]) {
  const amount = splits
    .filter((split) => split.roleLabel === 'Loan Officer' || split.roleLabel === 'Post-Split Add-Backs')
    .reduce((sum, split) => sum + split.amount, 0);
  return Math.round(amount * 100) / 100;
}

export function requestLoanOfficerRevenue(row: {
  managerCalculationRequired: boolean;
  managerCalculationCompletedAt: string | null;
  status: PayrollCompRequestStatus;
  estimatedCompAmount: number | null;
  expectedRevenue: number;
  splits: readonly CompensationSplit[];
}) {
  const finalCompAvailable = Boolean(row.managerCalculationCompletedAt) && (
    row.status === PayrollCompRequestStatus.APPROVED ||
    row.status === PayrollCompRequestStatus.PAID
  );
  if (row.managerCalculationRequired && !finalCompAvailable) {
    return row.estimatedCompAmount ?? row.expectedRevenue;
  }
  return loanOfficerFinalComp(row.splits);
}
