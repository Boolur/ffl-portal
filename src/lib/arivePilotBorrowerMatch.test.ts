import { describe, expect, it } from 'vitest';
import { inspectPilotBorrower, makePilotBorrowerAttestation } from './arivePilotBorrowerMatch';
import { inspectAriveLoanIdentity } from './ariveIdentity';
import { corroboratedPilotIdentityHash, pilotIdentityMatches } from './ariveLeadershipPilotIdentity';

const loan = { id: 'local', loanNumber: '8001', borrowerName: 'Example Stub', borrowerFirstName: 'Example', borrowerLastName: 'Stub',
  borrowerPhone: '202-555-0142', borrowerEmail: 'submission@example.test', amount: 150000, propertyAddress: '1 Example St, Unit 2, Example City, CA 90000',
  program: null, loanOfficer: { email: 'officer@example.test' }, secondaryLoanOfficer: null };
const borrower = { applicantType: 'Borrower', firstName: 'Example', middleName: 'Stub', lastName: 'Sample', emailAddressText: loan.borrowerEmail,
  mobilePhone10digit: '+1 (202) 555-0142' };
const property = { addressLineText: '1 Example Street', addressUnitIdentifier: 'Unit 2', city: 'Example City', state: 'CA', postalCode: '90000-9000' };
const details = { ariveLoanId: 8001, sysGUID: 'test-guid', loanOriginatorEmail: loan.loanOfficer.email, loanBorrowers: [borrower],
  baseLoanAmount: '150000.00', subjectProperty: property };
const saved = { ariveGuid: 'test-guid' };

describe('corroborating an imported middle name exclusively in the Pilot', () => {
  it('admits only the attested missing field and invalidates cross-file, cross-branch and stale evidence', () => {
    const source = {...details, orgUnitDisplayName: 'Example branch', orgUnitId: 'branch-test', loanBorrowers: [{ ...borrower, middleName: undefined }]};
    const scope = {pipelineId:'test-file', revision:new Date('2026-05-01')};
    const report = {number:loan.loanNumber, name:'Example Stub Sample', officerEmail:loan.loanOfficer.email, branch:'Example branch'};
    const approve = (r = report) => makePilotBorrowerAttestation(source, loan, saved, scope, r, 'admin', scope.revision);
    const record = approve();
    expect(record).toBeTruthy();
    expect(JSON.stringify(record)).not.toContain('Example Stub');
    for (const r of [{...report,number:'999'},{...report,branch:'Other'},{...report,name:'Example Random Sample'},{...report,officerEmail:'other@example.test'}])
      expect(approve(r)).toBeNull();
    const checked = (patch = {}, borrowerChange = {}, context = scope, base = loan) => inspectPilotBorrower(
      {...source, loanBorrowers:[{...source.loanBorrowers[0], ...borrowerChange}], ...patch}, base, saved, {record,scope:context});
    expect(checked().identity.issues).toEqual([]);
    expect(checked({}, {middleName:'Stub'}).identity.issues).toEqual([]);
    for (const result of [checked({}, {middleName:'Wrong'}),checked({}, {lastName:'Another'}),checked({}, {lastName:'Stub'}),
      checked({}, {emailAddressText: null}),checked({orgUnitId:'new'}),checked({baseLoanAmount:1}),checked({loanBorrowers:[borrower,borrower]}),
      checked({}, {}, {...scope,pipelineId:'other'}),checked({}, {}, {...scope,revision:new Date('2026-05-02')}),
      checked({}, {}, scope, {...loan,borrowerName:'Other'}),checked({sysGUID:'other'})]) expect(result.identity.issues.length).toBeGreaterThan(0);
  });
  it('requires a unique primary and matches actual contact, amount and full subject property', () => {
    expect(inspectAriveLoanIdentity(details, loan, saved).issues).toEqual(['BORROWER_NAME']);
    expect(inspectPilotBorrower(details, loan, saved)).toMatchObject({ middleName: true, expected: 'example sample', identity: { issues: [] } });
    expect(inspectPilotBorrower(details, { ...loan, borrowerEmail: null }, saved).middleName).toBe(true);
    expect(inspectPilotBorrower(details, { ...loan, borrowerPhone: null }, saved).middleName).toBe(true);
    const homePhoneOnly = { ...borrower, mobilePhone10digit: undefined, emailAddressText: undefined, homePhone: loan.borrowerPhone };
    expect(inspectPilotBorrower({ ...details, loanBorrowers: [homePhoneOnly] }, { ...loan, borrowerEmail: null }, saved).middleName).toBe(true);
  });

  it.each([
    { ariveLoanId: 8002 }, { sysGUID: 'different' }, { loanOriginatorEmail: 'different@example.test', loanTeam: [{loanRole:'Originator',emailAddressText:loan.loanOfficer.email}] },
    { loanBorrowers: [borrower, { ...borrower, applicantType: 'CoBorrower' }] }, { loanBorrowers: [{ ...borrower, middleName: null }] },
    { loanBorrowers: [{ ...borrower, middleName: 'St.' }] }, { loanBorrowers: [{ ...borrower, firstName:'Changed' }] },
    { loanBorrowers: [{ ...borrower, emailAddressText: null, mobilePhone10digit: '' }] },
    { loanBorrowers: [{ ...borrower, emailAddressText: 'another@example.test' }] }, { loanBorrowers: [{ ...borrower, mobilePhone10digit: '2025550110' }] },
    { baseLoanAmount: null }, { baseLoanAmount: 149999 }, { subjectTBDIndicator: true },
    { subjectProperty: { ...property, addressUnitIdentifier: null } }, { subjectProperty: { ...property, city: 'Other' } },
  ])('fails closed when an independent source contradicts or cannot prove the identity', patch => {
    expect(inspectPilotBorrower({ ...details, ...patch }, loan, saved).identity.issues.length).toBeGreaterThan(0);
  });

  it('requires a pinned permanent ID and invalidates saved access if any source proof changes', () => {
    expect(inspectPilotBorrower(details, loan, {}).middleName).toBe(false);
    const hash = corroboratedPilotIdentityHash(loan);
    expect(pilotIdentityMatches(loan, hash)).toBe(true);
    for (const change of [{ borrowerPhone: null }, { borrowerEmail: null }, { amount: 153000 }, { propertyAddress: null }, { loanNumber: '8002' }])
      expect(pilotIdentityMatches({ ...loan, ...change }, hash)).toBe(false);
  });

  it('identifies missing and conflicting proof without returning private source values or relaxing admission', () => {
    const result = inspectPilotBorrower({ ...details, baseLoanAmount: null, loanBorrowers: [{
      ...borrower, middleName: undefined, emailAddressText: 'different@example.test',
    }], subjectProperty: { ...property, postalCode: undefined } }, loan, saved);
    expect(result.middleName).toBe(false);
    expect(result.evidenceIssues).toEqual(['Arive API omitted the primary middle name', 'primary email differs',
      'Arive API omitted the base loan amount', 'Arive API returned an incomplete subject address']);
    expect(result.identity.issues).toEqual(['BORROWER_NAME']);
  });
});
