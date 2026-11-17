/** Pure identity checks shared by diagnostics and synchronization. */
export type AriveLoanIdentity = {
  id: string; loanNumber: string; borrowerName: string; borrowerFirstName: string | null; borrowerLastName: string | null;
  loanOfficer: { email: string }; secondaryLoanOfficer: { email: string } | null;
};
export type AriveSavedIdentity = { ariveGuid?: string | null; verifiedOriginatorEmail?: string | null };
export type AriveIdentityIssue = 'LOAN_NUMBER' | 'GUID' | 'ORIGINATOR' | 'SAVED_ORIGINATOR' | 'BORROWER_NAME';
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const normalizeAriveIdentity = (value: unknown) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : '';
export const isAriveBorrowerApplicant = (value: unknown) => value === 'Borrower' || value === 'CoBorrower';

/** An expected LO must be the named originator or explicitly hold Originator on this exact file. */
export function inspectAriveLoanIdentity(details: unknown, loan: AriveLoanIdentity, saved?: AriveSavedIdentity) {
  const data = record(details); const issues: AriveIdentityIssue[] = [];
  if (!/^\d{1,15}$/.test(loan.loanNumber) || String(data.ariveLoanId) !== loan.loanNumber) issues.push('LOAN_NUMBER');
  const guid = typeof data.sysGUID === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(data.sysGUID) ? data.sysGUID : null;
  if (!guid || saved?.ariveGuid && saved.ariveGuid !== guid) issues.push('GUID');

  const primary = normalizeAriveIdentity(data.loanOriginatorEmail);
  const originators = new Set([primary, ...(Array.isArray(data.loanTeam) ? data.loanTeam.map(record)
    .filter(member => normalizeAriveIdentity(member.loanRole) === 'originator')
    .map(member => normalizeAriveIdentity(member.emailAddressText)) : [])].filter(Boolean));
  const expected = [...new Set([loan.loanOfficer.email, loan.secondaryLoanOfficer?.email].map(normalizeAriveIdentity).filter(Boolean))];
  const matched = expected.filter(email => originators.has(email));
  if (!matched.length) issues.push('ORIGINATOR');
  const pinnedOriginator = normalizeAriveIdentity(saved?.verifiedOriginatorEmail);
  if (pinnedOriginator && (!expected.includes(pinnedOriginator) || !originators.has(pinnedOriginator))) issues.push('SAVED_ORIGINATOR');

  const first = normalizeAriveIdentity(loan.borrowerFirstName); const last = normalizeAriveIdentity(loan.borrowerLastName);
  const borrower = first && last ? `${first} ${last}` : normalizeAriveIdentity(loan.borrowerName);
  const applicants = Array.isArray(data.loanBorrowers) ? data.loanBorrowers.map(record).filter(row => isAriveBorrowerApplicant(row.applicantType)) : [];
  if (!borrower || !applicants.some(row => `${normalizeAriveIdentity(row.firstName)} ${normalizeAriveIdentity(row.lastName)}` === borrower)) issues.push('BORROWER_NAME');
  return { guid, originatorEmail: pinnedOriginator && matched.includes(pinnedOriginator) ? pinnedOriginator : matched[0] || null, issues };
}

/** A summary can omit the team, but cannot borrow evidence from a different or contradictory file. */
export function withAriveDetailTeamEvidence(summary: unknown, details: unknown): unknown {
  const listed = record(summary); const detailed = record(details);
  if (listed.loanTeam != null || String(listed.ariveLoanId) !== String(detailed.ariveLoanId)
    || typeof listed.sysGUID !== 'string' || listed.sysGUID !== detailed.sysGUID
    || !normalizeAriveIdentity(listed.loanOriginatorEmail) || normalizeAriveIdentity(listed.loanOriginatorEmail) !== normalizeAriveIdentity(detailed.loanOriginatorEmail)
    || !Array.isArray(detailed.loanTeam)) return summary;
  return { ...listed, loanTeam: detailed.loanTeam };
}
