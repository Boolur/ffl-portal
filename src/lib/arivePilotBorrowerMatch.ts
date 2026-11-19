import { inspectAriveLoanIdentity, normalizeAriveIdentity, type AriveSavedIdentity } from './ariveIdentity';
import type { AriveOneTimeLoan } from './ariveOneTimeReconciliation';
import { jsonRecord } from './ariveSyncState';
import { normalizeProcessingProperty } from './processingBorrowerDetails';
import { projectAriveApplicationSnapshot } from './ariveApplicationSnapshot';

const addressWords: Record<string, string> = { north: 'n', south: 's', east: 'e', west: 'w', street: 'st', avenue: 'ave',
  drive: 'dr', lane: 'ln', road: 'rd', boulevard: 'blvd', court: 'ct', place: 'pl', circle: 'cir', apartment: 'unit', apt: 'unit' };

function addressKey(value: string) {
  return value.toLowerCase().replace(/\b(\d{5})-\d{4}\b/g, '$1').replace(/#/g, ' unit ')
    .replace(/\b[a-z]+\b/g, word => addressWords[word] ?? word).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function phoneNumber(value: unknown) {
  const digits = typeof value === 'string' ? value.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '') : '';
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(digits) && !/^(\d)\1{9}$/.test(digits) ? digits : '';
}

function compareContacts(loan: AriveOneTimeLoan, borrower: Record<string, unknown>) {
  const email = normalizeAriveIdentity(loan.borrowerEmail);
  const sourceEmail = normalizeAriveIdentity(borrower.emailAddressText);
  const phone = phoneNumber(loan.borrowerPhone);
  const phones = [borrower.mobilePhone10digit, borrower.homePhone10digit, borrower.workPhone].map(phoneNumber).filter(Boolean);
  const emailAvailable = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !/^(no[-_.]?email|no[-_.]?reply|unknown|none|n\.?a)@/.test(email) && !!sourceEmail;
  const phoneAvailable = !!phone && phones.length > 0;
  return (emailAvailable || phoneAvailable) && (!emailAvailable || email === sourceEmail) && (!phoneAvailable || phones.includes(phone));
}

/** Strict exception for a BISU surname imported from ARIVE's middle-name field.
 * All corroboration is rechecked on every Pilot read. Standard matching never calls this helper. */
export function inspectPilotBorrower(details: unknown, loan: AriveOneTimeLoan, saved: AriveSavedIdentity) {
  const identity = inspectAriveLoanIdentity(details, loan, saved);
  const first = normalizeAriveIdentity(loan.borrowerFirstName);
  const last = normalizeAriveIdentity(loan.borrowerLastName);
  const expected = first && last ? first + ' ' + last : normalizeAriveIdentity(loan.borrowerName);
  const exact = { identity, expected, middleName: false };
  if (identity.issues.length !== 1 || identity.issues[0] !== 'BORROWER_NAME' || !saved.ariveGuid ||
      !identity.guid || identity.guid !== saved.ariveGuid || !first || !last || !loan.propertyAddress) return exact;
  const data = jsonRecord(details);
  const primaryOfficer = normalizeAriveIdentity(loan.loanOfficer.email);
  if (!primaryOfficer || normalizeAriveIdentity(data.loanOriginatorEmail) !== primaryOfficer ||
      !Array.isArray(data.loanBorrowers) || data.loanBorrowers.length !== 1 ||
      (data.subjectTBDIndicator != null && data.subjectTBDIndicator !== false)) return exact;
  const person = jsonRecord(data.loanBorrowers[0]);
  const legalLast = normalizeAriveIdentity(person.lastName);
  if (person.applicantType !== 'Borrower' || normalizeAriveIdentity(person.firstName) !== first ||
      normalizeAriveIdentity(person.middleName) !== last || !legalLast || legalLast === last || !compareContacts(loan, person)) return exact;
  const amount = Number(loan.amount);
  if (!Number.isFinite(amount) || amount <= 0 || projectAriveApplicationSnapshot(data).loan.baseLoanAmount !== amount) return exact;
  const property = jsonRecord(data.subjectProperty);
  const parsed = normalizeProcessingProperty({ street: property.addressLineText, unit: property.addressUnitIdentifier,
    city: property.city, state: property.state, zip: property.postalCode });
  if (!parsed.success || addressKey(parsed.address) !== addressKey(loan.propertyAddress)) return exact;
  return { identity: { ...identity, issues: [] }, expected: first + ' ' + legalLast, middleName: true };
}
