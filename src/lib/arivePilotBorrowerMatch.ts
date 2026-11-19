import { inspectAriveLoanIdentity, normalizeAriveIdentity, type AriveSavedIdentity } from './ariveIdentity';
import type { AriveOneTimeLoan } from './ariveOneTimeReconciliation';
import { jsonRecord } from './ariveSyncState';
import { normalizeProcessingProperty } from './processingBorrowerDetails';
import { projectAriveApplicationSnapshot } from './ariveApplicationSnapshot';
import { createHash } from 'node:crypto';
import { corroboratedPilotIdentityHash } from './ariveLeadershipPilotIdentity';
import { missingAriveMiddleName, type PilotReportedBorrower } from './arivePilotAttestationTypes';

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

function contactIssues(loan: AriveOneTimeLoan, borrower: Record<string, unknown>) {
  const email = normalizeAriveIdentity(loan.borrowerEmail);
  const sourceEmail = normalizeAriveIdentity(borrower.emailAddressText);
  const phone = phoneNumber(loan.borrowerPhone);
  const phones = [borrower.mobilePhone10digit, borrower.homePhone, borrower.homePhone10digit, borrower.workPhone].map(phoneNumber).filter(Boolean);
  const emailAvailable = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !/^(no[-_.]?email|no[-_.]?reply|unknown|none|n\.?a)@/.test(email) && !!sourceEmail;
  const phoneAvailable = !!phone && phones.length > 0;
  if (!emailAvailable && !phoneAvailable) return ['no comparable primary email or phone'];
  return [...(emailAvailable && email !== sourceEmail ? ['primary email differs'] : []),
    ...(phoneAvailable && !phones.includes(phone) ? ['primary phone differs'] : [])];
}

/** Strict exception for a BISU surname imported from ARIVE's middle-name field.
 * All corroboration is rechecked on every Pilot read. Standard matching never calls this helper. */
function inspectSource(details: unknown, loan: AriveOneTimeLoan, saved: AriveSavedIdentity) {
  const identity = inspectAriveLoanIdentity(details, loan, saved);
  const first = normalizeAriveIdentity(loan.borrowerFirstName);
  const last = normalizeAriveIdentity(loan.borrowerLastName);
  const expected = first && last ? first + ' ' + last : normalizeAriveIdentity(loan.borrowerName);
  const evidenceIssues: string[] = [];
  const exact = { identity, expected, middleName: false, evidenceIssues };
  if (identity.issues.length !== 1 || identity.issues[0] !== 'BORROWER_NAME') return exact;
  if (!saved.ariveGuid || !identity.guid || identity.guid !== saved.ariveGuid) evidenceIssues.push('permanent file ID unconfirmed');
  if (!first || !last) evidenceIssues.push('BISU borrower name incomplete');
  const data = jsonRecord(details);
  const primaryOfficer = normalizeAriveIdentity(loan.loanOfficer.email);
  if (!primaryOfficer || normalizeAriveIdentity(data.loanOriginatorEmail) !== primaryOfficer) evidenceIssues.push('primary loan officer differs');
  if (data.subjectTBDIndicator != null && data.subjectTBDIndicator !== false) evidenceIssues.push('subject property marked TBD or unconfirmed');
  const solelyNamed = Array.isArray(data.loanBorrowers) && data.loanBorrowers.length === 1 ? jsonRecord(data.loanBorrowers[0]) : {};
  const legalLast = normalizeAriveIdentity(solelyNamed.lastName);
  if (solelyNamed.applicantType !== 'Borrower') evidenceIssues.push('no single primary applicant');
  else {
    if (normalizeAriveIdentity(solelyNamed.firstName) !== first) evidenceIssues.push('primary given name differs');
    const middle = normalizeAriveIdentity(solelyNamed.middleName);
    if (!middle) evidenceIssues.push(missingAriveMiddleName);
    else if (middle !== last) evidenceIssues.push('Arive middle name differs from the BISU surname');
    if (!legalLast || legalLast === last) evidenceIssues.push('a distinct Arive surname is unconfirmed');
    evidenceIssues.push(...contactIssues(loan, solelyNamed));
  }
  const amount = Number(loan.amount);
  const ariveAmount = projectAriveApplicationSnapshot(data).loan.baseLoanAmount;
  if (ariveAmount === null) evidenceIssues.push('Arive API omitted the base loan amount');
  else if (!Number.isFinite(amount) || amount <= 0 || ariveAmount !== amount) evidenceIssues.push('base loan amount differs');
  const property = jsonRecord(data.subjectProperty);
  const parsed = normalizeProcessingProperty({ street: property.addressLineText, unit: property.addressUnitIdentifier,
    city: property.city, state: property.state, zip: property.postalCode });
  if (!parsed.success) evidenceIssues.push('Arive API returned an incomplete subject address');
  else if (!loan.propertyAddress || addressKey(parsed.address) !== addressKey(loan.propertyAddress)) evidenceIssues.push('full subject address differs');
  return evidenceIssues.length ? exact : { identity: { ...identity, issues: [] }, expected: first + ' ' + legalLast, middleName: true, evidenceIssues };
}

type Scope = { pipelineId: string; revision: Date };
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Bind the exact facts that established the exception. Stage, notes and ordinary
// servicing changes intentionally do not invalidate the approval.
function borrowerEvidence(details: unknown, loan: AriveOneTimeLoan, scope: Scope) {
  const data = jsonRecord(details);
  const borrower = jsonRecord(Array.isArray(data.loanBorrowers) ? data.loanBorrowers[0] : null);
  const property = jsonRecord(data.subjectProperty);
  const names = [borrower.firstName, loan.borrowerLastName, borrower.lastName].map(normalizeAriveIdentity);
  const fields = [data.sysGUID, String(data.ariveLoanId), String(data.orgUnitId ?? ''), normalizeAriveIdentity(data.orgUnitDisplayName), normalizeAriveIdentity(data.loanOriginatorEmail),
    ...names, normalizeAriveIdentity(borrower.emailAddressText),
    ...[borrower.mobilePhone10digit, borrower.homePhone, borrower.homePhone10digit, borrower.workPhone].map(phoneNumber),
    ...[property.addressLineText, property.addressUnitIdentifier, property.city, property.state, property.postalCode].map(normalizeAriveIdentity),
    projectAriveApplicationSnapshot(data).loan.baseLoanAmount];
  return { names, hash: digest(['pilot-middle-name-v1', 'company', scope.pipelineId, scope.revision.toISOString(),
    corroboratedPilotIdentityHash(loan), ...fields]) };
}

export function makePilotBorrowerAttestation(details: unknown, loan: AriveOneTimeLoan, saved: AriveSavedIdentity,
  scope: Scope, report: PilotReportedBorrower, operatorId: string, now: Date) {
  const inspected = inspectSource(details, loan, saved);
  if (inspected.identity.issues.join() !== 'BORROWER_NAME' || inspected.evidenceIssues.length !== 1 ||
      inspected.evidenceIssues[0] !== missingAriveMiddleName || !operatorId || !saved.ariveGuid) return null;
  const { names, hash } = borrowerEvidence(details, loan, scope);
  const sourceBranch = normalizeAriveIdentity(jsonRecord(details).orgUnitDisplayName);
  if (report.number !== loan.loanNumber || !sourceBranch || normalizeAriveIdentity(report.branch) !== sourceBranch || normalizeAriveIdentity(report.name) !== names.join(' ') ||
      normalizeAriveIdentity(report.officerEmail) !== normalizeAriveIdentity(loan.loanOfficer.email)) return null;
  return { version: 1, basis: 'ARIVE_BRANCH_REPORT_AND_BORROWER_SCREEN', boundEvidence: hash,
    branchReportDigest: digest([report.number, ...[report.name, report.officerEmail, report.branch].map(normalizeAriveIdentity)]),
    ariveGuid: saved.ariveGuid, operatorId, approvedAt: now.toISOString() };
}

export function inspectPilotBorrower(details: unknown, loan: AriveOneTimeLoan, saved: AriveSavedIdentity,
  attestation?: { record: unknown; scope: Scope }) {
  const result = inspectSource(details, loan, saved);
  if (attestation?.record == null) return result;
  const record = jsonRecord(attestation.record);
  const proof = borrowerEvidence(details, loan, attestation.scope);
  const sameEvidence = record.version === 1 && record.basis === 'ARIVE_BRANCH_REPORT_AND_BORROWER_SCREEN' &&
    record.ariveGuid === saved.ariveGuid && record.boundEvidence === proof.hash &&
    typeof record.operatorId === 'string' && !!record.operatorId && typeof record.approvedAt === 'string' &&
    typeof record.branchReportDigest === 'string' && /^[a-f0-9]{64}$/.test(record.branchReportDigest);
  if (sameEvidence && result.middleName) return result;
  if (sameEvidence && result.identity.issues.join() === 'BORROWER_NAME' && result.evidenceIssues.length === 1 &&
      result.evidenceIssues[0] === missingAriveMiddleName) {
    return { ...result, identity: { ...result.identity, issues: [] }, expected: [proof.names[0], proof.names[2]].join(' '),
      middleName: true, evidenceIssues: [] };
  }
  return { ...result, middleName: false, identity: { ...result.identity,
    issues: result.identity.issues.length ? result.identity.issues : ['BORROWER_NAME' as const] },
    evidenceIssues: [...result.evidenceIssues, 'the previously approved Pilot identity evidence changed'] };
}
