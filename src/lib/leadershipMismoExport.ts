import { validMismoFilenameNumber } from './mismoAriveLoanNumber';

export function isAriveExportGuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function onlyChild(parent: Element | null, tag: string) {
  if (!parent) return null;
  const nodes = Array.from(parent.children).filter(child => child.localName === tag && child.namespaceURI === parent.namespaceURI);
  return nodes.length === 1 ? nodes[0] : null;
}

function individualContactValues(party: Element | null, kind: string, field: string) {
  const contacts = onlyChild(onlyChild(party, 'INDIVIDUAL'), 'CONTACT_POINTS');
  const values: string[] = [];
  if (!contacts) return values;
  for (const contact of Array.from(contacts.children)) {
    if (contact.localName !== 'CONTACT_POINT' || contact.namespaceURI !== contacts.namespaceURI) continue;
    for (const entry of Array.from(contact.children))
      if (entry.localName === kind && entry.namespaceURI === contact.namespaceURI)
        values.push(onlyChild(entry, field)?.textContent?.trim() ?? '');
  }
  return values;
}

export function leadershipOriginatorEmail(parties: readonly Element[]): string | undefined {
  if (parties.length !== 1) return;
  const values = individualContactValues(parties[0], 'CONTACT_POINT_EMAIL', 'ContactPointEmailValue');
  if (values.some(email => email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return;
  const emails = new Set(values.map(value => value.toLowerCase()));
  if (emails.size === 1) return [...emails][0];
}

export function leadershipApplicantContact(party: Element | null) {
  const name = onlyChild(onlyChild(party, 'INDIVIDUAL'), 'NAME');
  return {
    firstName: onlyChild(name, 'FirstName')?.textContent?.trim() ?? '',
    lastName: onlyChild(name, 'LastName')?.textContent?.trim() ?? '',
    email: individualContactValues(party, 'CONTACT_POINT_EMAIL', 'ContactPointEmailValue').find(Boolean) ?? '',
    phone: individualContactValues(party, 'CONTACT_POINT_TELEPHONE', 'ContactPointTelephoneValue').find(Boolean) ?? '',
  };
}

export function leadershipApplicants(parties: readonly Element[]) {
  const applicants = parties.map(party => {
    const classification = Array.from(party.getElementsByTagNameNS('*', 'BorrowerClassificationType'));
    const role = classification.length === 0 ? '' : classification.length === 1
      ? classification[0].textContent?.trim().toLowerCase() : 'ambiguous';
    return { party, role };
  });
  const primary = applicants.filter(({ role }) => role === 'primary');
  const secondary = applicants.filter(({ role }) => role === 'secondary');
  const unclassified = applicants.filter(({ role }) => role === '');
  const primaryParty = primary.length === 1 ? primary[0].party : !primary.length && unclassified.length === 1 &&
    (applicants.length === 1 || secondary.length === applicants.length - 1) ? unclassified[0].party : null;
  const others = applicants.filter(({ party }) => party !== primaryParty);
  const coBorrowerParty = others.length === 1 && (others[0].role === 'secondary' || (primaryParty && others[0].role === ''))
    ? others[0].party : null;
  return { primaryParty, coBorrowerParty };
}

type DocumentLoanFields = {
  arriveLoanNumber?: string; leadershipExportGuid?: string; borrowerFirstName?: string; borrowerLastName?: string;
  propertyStreet?: string; propertyUnit?: string; propertyCity?: string; propertyState?: string; propertyZip?: string;
};

export function leadershipDocumentIdentity(fields: DocumentLoanFields) {
  const norm = (value?: string) => value?.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ') ?? '';
  return { number: norm(fields.arriveLoanNumber), guid: norm(fields.leadershipExportGuid),
    borrower: [norm(fields.borrowerFirstName), norm(fields.borrowerLastName)],
    address: [norm(fields.propertyStreet), norm(fields.propertyCity), norm(fields.propertyState), norm(fields.propertyZip)],
    unit: norm(fields.propertyUnit) };
}

export function sameLeadershipDocumentLoan(bound: ReturnType<typeof leadershipDocumentIdentity>, fields: DocumentLoanFields) {
  const next = leadershipDocumentIdentity(fields);
  if (!/^\d{1,15}$/.test(bound.number) || bound.number !== next.number) return false;
  if (bound.guid) return isAriveExportGuid(bound.guid) && bound.guid === next.guid;
  return bound.borrower.every((value, i) => value && value === next.borrower[i]) &&
    bound.address.every((value, i) => value && value === next.address[i]) && bound.unit === next.unit;
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
