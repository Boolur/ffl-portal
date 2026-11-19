import { createHash } from 'node:crypto';
import { normalizeAriveIdentity, type AriveLoanIdentity } from './ariveIdentity';

/** Invalidate saved data when a loan is reassigned, renumbered or replaced. */
export function pilotIdentityHash(loan: AriveLoanIdentity): string {
  const fields = [
    loan.id,
    loan.loanNumber,
    loan.borrowerName,
    loan.borrowerFirstName,
    loan.borrowerLastName,
    loan.loanOfficer.email,
    loan.secondaryLoanOfficer?.email,
  ];
  return createHash('sha256')
    .update(JSON.stringify(fields.map(normalizeAriveIdentity)))
    .digest('hex');
}
