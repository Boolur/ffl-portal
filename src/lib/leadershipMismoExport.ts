import { validMismoFilenameNumber } from './mismoAriveLoanNumber';

export function isAriveExportGuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function onlyChild(parent: Element | null, tag: string) {
  if (!parent) return null;
  const nodes = Array.from(parent.children).filter(child => child.localName === tag && child.namespaceURI === parent.namespaceURI);
  return nodes.length === 1 ? nodes[0] : null;
}

/** Recognize the ARIVE export that uses a permanent LOS UUID and puts its
 * display number in LenderLoan. The Pilot verifies both with ARIVE at submit. */
export function readLeadershipMismoExport(
  doc: Document, filename: string, borrowerFirstName: string, borrowerLastName: string,
): { loanNumber: string; guid: string } | null {
  const loans = doc.getElementsByTagNameNS('*', 'LOAN');
  if (loans.length !== 1 || !borrowerFirstName.trim() || !borrowerLastName.trim()) return null;
  const loan = loans[0];
  const system = onlyChild(onlyChild(loan, 'ORIGINATION_SYSTEMS'), 'ORIGINATION_SYSTEM');
  if (onlyChild(system, 'LoanOriginationSystemName')?.textContent?.trim().toUpperCase() !== 'ARIVE') return null;
  const guid = onlyChild(system, 'LoanOriginationSystemLoanIdentifier')?.textContent?.trim();
  if (!isAriveExportGuid(guid)) return null;
  const identifier = onlyChild(onlyChild(loan, 'LOAN_IDENTIFIERS'), 'LOAN_IDENTIFIER');
  if (onlyChild(identifier, 'LoanIdentifierType')?.textContent?.trim() !== 'LenderLoan') return null;
  const loanNumber = onlyChild(identifier, 'LoanIdentifier')?.textContent?.trim();
  if (!loanNumber || !validMismoFilenameNumber(loanNumber)) return null;
  const expected = `${borrowerLastName.trim()}-${borrowerFirstName.trim()}-${loanNumber}.xml`;
  if (filename.normalize('NFC').toLowerCase() !== expected.normalize('NFC').toLowerCase()) return null;
  return { loanNumber, guid };
}
