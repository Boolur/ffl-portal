import { PayrollCompRequestStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { loanOfficerFinalComp, requestLoanOfficerRevenue } from './payrollLoanOfficerComp';

const request = {
  managerCalculationRequired: false,
  managerCalculationCompletedAt: null,
  status: PayrollCompRequestStatus.PENDING_REVIEW,
  estimatedCompAmount: null,
  expectedRevenue: 1195.69,
  splits: [
    { roleLabel: 'Loan Officer', amount: 1076.12 },
    { roleLabel: 'Company', amount: 119.57 },
    { roleLabel: 'Post-Split Add-Backs', amount: 440 },
  ],
};

describe('loan officer portal compensation', () => {
  it.each(Object.values(PayrollCompRequestStatus))('matches preview final comp for a %s request', (status) => {
    expect(requestLoanOfficerRevenue({ ...request, status })).toBe(1516.12);
    expect(loanOfficerFinalComp(request.splits)).toBe(1516.12);
  });

  it('excludes reimbursements paid to managers', () => {
    const splits = request.splits.map((split) => split.roleLabel === 'Post-Split Add-Backs'
      ? { ...split, roleLabel: 'Manager Reimbursement' }
      : split);
    expect(requestLoanOfficerRevenue({ ...request, splits })).toBe(1076.12);
  });

  it('preserves retail estimates until the manager calculation is approved', () => {
    const retail = { ...request, managerCalculationRequired: true, estimatedCompAmount: 2000 };
    expect(requestLoanOfficerRevenue(retail)).toBe(2000);
    const completed = { ...retail, managerCalculationCompletedAt: '2026-10-01T00:00:00Z' };
    expect(requestLoanOfficerRevenue(completed)).toBe(2000);
    expect(requestLoanOfficerRevenue({ ...completed, status: PayrollCompRequestStatus.APPROVED })).toBe(1516.12);
    expect(requestLoanOfficerRevenue({ ...completed, status: PayrollCompRequestStatus.PAID })).toBe(1516.12);
  });

  it('preserves a zero payout instead of falling back to split basis', () => {
    expect(requestLoanOfficerRevenue({ ...request, splits: [{ roleLabel: 'Loan Officer', amount: 0 }] })).toBe(0);
    expect(loanOfficerFinalComp([])).toBe(0);
  });
});
