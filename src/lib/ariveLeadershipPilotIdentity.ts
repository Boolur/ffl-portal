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

type CorroboratingFields = { amount?: unknown; propertyAddress?: string | null; borrowerPhone?: string | null; borrowerEmail?: string | null };
const middleNamePrefix = 'middle-name:v1:';
export const isMiddleNamePilotLink = (hash: string | null | undefined) => !!hash?.startsWith(middleNamePrefix);

/** A privately corroborated link also depends on the Standard facts used to prove it. */
export function corroboratedPilotIdentityHash(loan: AriveLoanIdentity & CorroboratingFields) {
  const fields = [pilotIdentityHash(loan), String(loan.amount ?? ''), loan.propertyAddress, loan.borrowerEmail, loan.borrowerPhone];
  return middleNamePrefix + createHash('sha256').update(JSON.stringify(fields.map(normalizeAriveIdentity))).digest('hex');
}

export function pilotIdentityMatches(loan: AriveLoanIdentity & CorroboratingFields, hash: string | null) {
  return hash === (isMiddleNamePilotLink(hash) ? corroboratedPilotIdentityHash(loan) : pilotIdentityHash(loan));
}
