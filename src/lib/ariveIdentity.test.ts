import { describe, expect, it } from 'vitest';
import { inspectAriveLoanIdentity, withAriveDetailTeamEvidence, type AriveLoanIdentity } from './ariveIdentity';

const loan: AriveLoanIdentity = { id: 'synthetic-loan', loanNumber: '99000001', borrowerName: 'Synthetic Borrower', borrowerFirstName: 'Synthetic', borrowerLastName: 'Borrower', loanOfficer: { email: 'owner@example.test' }, secondaryLoanOfficer: { email: 'secondary@example.test' } };
const details = () => ({ ariveLoanId: 99000001, sysGUID: 'exact-guid', loanOriginatorEmail: 'branch-primary@example.test',
  loanBorrowers: [{ applicantType: 'Borrower', firstName: 'Synthetic', lastName: 'Borrower' }],
  loanTeam: [{ loanRole: 'Originator', emailAddressText: 'owner@example.test', primary: false }] });
const saved = { ariveGuid: 'exact-guid', verifiedOriginatorEmail: 'owner@example.test' };

describe('shared exact Arive identity', () => {
  it('matches an expected portal LO explicitly listed as an Originator without replacing that portal assignment', () => {
    const source = details(); const copy = structuredClone(source);
    expect(inspectAriveLoanIdentity(source, loan, saved)).toEqual({ guid: 'exact-guid', originatorEmail: 'owner@example.test', issues: [] });
    expect(source).toEqual(copy); expect(loan.loanOfficer.email).toBe('owner@example.test');
  });

  it.each(['owner@example.test', 'secondary@example.test'])('accepts the existing top-level originator mapping for %s', email => {
    const source = { ...details(), loanOriginatorEmail: email, loanTeam: [] };
    expect(inspectAriveLoanIdentity(source, loan)).toMatchObject({ originatorEmail: email, issues: [] });
  });

  it('normalizes exact email/name spelling and accepts a secondary portal LO only with an explicit Originator role', () => {
    const source = details(); source.loanTeam = [{ loanRole: ' Originator ', emailAddressText: ' Secondary@Example.Test ', primary: false }];
    source.loanBorrowers = [{ applicantType: 'CoBorrower', firstName: ' synthetic ', lastName: ' BORROWER ' }];
    expect(inspectAriveLoanIdentity(source, loan)).toMatchObject({ originatorEmail: 'secondary@example.test', issues: [] });
  });

  it.each(['Processor', 'Loan Officer', 'Assistant', 'Administrator', '', 'OriginatorAssistant'])('rejects an expected email attached only to the unsupported %s role', loanRole => {
    const source = details(); source.loanTeam[0].loanRole = loanRole; source.loanTeam[0].primary = true;
    expect(inspectAriveLoanIdentity(source, loan, saved).issues).toEqual(['ORIGINATOR', 'SAVED_ORIGINATOR']);
  });

  it.each(['not-owner@example.test', 'owner@example.test.attacker', 'owner+alias@example.test'])('does not fuzzy-match the team email %s', emailAddressText => {
    const source = details(); source.loanTeam[0].emailAddressText = emailAddressText;
    expect(inspectAriveLoanIdentity(source, loan).issues).toContain('ORIGINATOR');
  });

  it.each(['Borrower', 'CoBorrower'])('accepts an exact %s name even when another applicant is first', applicantType => {
    const source = details(); source.loanBorrowers = [{ applicantType: 'Borrower', firstName: 'Another', lastName: 'Person' }, { applicantType, firstName: 'Synthetic', lastName: 'Borrower' }];
    expect(inspectAriveLoanIdentity(source, loan, saved).issues).toEqual([]);
  });

  it.each(['Guarantor', 'NonBorrowingSpouse', 'Dependent', '', 'coborrower'])('does not accept the same name in unsupported applicant role %s', applicantType => {
    const source = details(); source.loanBorrowers[0].applicantType = applicantType;
    expect(inspectAriveLoanIdentity(source, loan, saved).issues).toEqual(['BORROWER_NAME']);
  });

  it('keeps exact borrower spelling rather than using a name-only candidate, suffix, or partial name', () => {
    const source = details(); source.loanBorrowers[0].lastName = 'Borrower Jr';
    expect(inspectAriveLoanIdentity(source, loan, saved).issues).toEqual(['BORROWER_NAME']);
    source.loanBorrowers[0].lastName = 'Borrower'; source.ariveLoanId = 99000002;
    expect(inspectAriveLoanIdentity(source, loan, saved).issues).toEqual(['LOAN_NUMBER']);
  });

  it.each(['other-guid', '', '../not-a-guid'])('rejects a different or invalid permanent ID %s even when LO and borrower match', sysGUID => {
    expect(inspectAriveLoanIdentity({ ...details(), sysGUID }, loan, saved).issues).toContain('GUID');
  });

  it('pins the verified LO and rejects their removal or loss of portal eligibility', () => {
    const source = details(); source.loanTeam.push({ loanRole: 'Originator', emailAddressText: 'secondary@example.test', primary: false });
    expect(inspectAriveLoanIdentity(source, loan, { ...saved, verifiedOriginatorEmail: 'secondary@example.test' })).toMatchObject({ originatorEmail: 'secondary@example.test', issues: [] });
    expect(inspectAriveLoanIdentity(source, { ...loan, secondaryLoanOfficer: null }, { ...saved, verifiedOriginatorEmail: 'secondary@example.test' }).issues).toEqual(['SAVED_ORIGINATOR']);
    source.loanTeam.splice(0, 1);
    expect(inspectAriveLoanIdentity(source, loan, saved).issues).toEqual(['SAVED_ORIGINATOR']);
  });

  it('does not accept malformed team data or identity fields', () => {
    const source = { ...details(), loanOriginatorEmail: null, loanTeam: [{ loanRole: 'Originator', emailAddressText: 123 }] };
    expect(inspectAriveLoanIdentity(source, loan).issues).toEqual(['ORIGINATOR']);
    expect(inspectAriveLoanIdentity(null, loan).issues).toEqual(['LOAN_NUMBER', 'GUID', 'ORIGINATOR', 'BORROWER_NAME']);
  });
});

describe('exact-file search summary team evidence', () => {
  it.each([undefined, null])('uses full detail team evidence only when the summary omits it (%s)', loanTeam => {
    const summary = { ...details(), loanTeam }; const original = structuredClone(summary);
    const merged = withAriveDetailTeamEvidence(summary, details());
    expect(inspectAriveLoanIdentity(summary, loan, saved).issues).toContain('ORIGINATOR');
    expect(inspectAriveLoanIdentity(merged, loan, saved).issues).toEqual([]);
    expect(summary).toEqual(original);
  });

  it.each(['loan number', 'GUID', 'originator', 'missing originator', 'explicit empty team', 'malformed team'])('refuses to borrow detail team evidence across %s differences', scenario => {
    const summary: Record<string, unknown> = { ...details(), loanTeam: undefined };
    if (scenario === 'loan number') summary.ariveLoanId = 99000002;
    if (scenario === 'GUID') summary.sysGUID = 'different-guid';
    if (scenario === 'originator') summary.loanOriginatorEmail = 'someoneelse@example.test';
    if (scenario === 'missing originator') delete summary.loanOriginatorEmail;
    if (scenario === 'explicit empty team') summary.loanTeam = [];
    if (scenario === 'malformed team') summary.loanTeam = 'not-a-team';
    expect(withAriveDetailTeamEvidence(summary, details())).toBe(summary);
  });
});
