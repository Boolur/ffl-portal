import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ actor: vi.fn(), submissionActor: vi.fn(), read: vi.fn(), available: vi.fn(), verify: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./pilotPracticeAccess', () => ({ getPilotActor: m.actor, getSubmissionPilotActor: m.submissionActor, pilotViewAvailable: m.available }));
vi.mock('./ariveClient', () => ({ ariveReadOnlySession: async () => m.read, AriveError: class extends Error {} }));
vi.mock('./ariveRollout', () => ({ verifyAriveRolloutIdentity: m.verify }));
import { projectSharedTestTasks, sameLeadershipTestProperty, submissionVerificationMessage, verifyLeadershipSubmissionLoan } from './leadershipTestSubmission';
import { canAccessLeadershipRequest, leadershipOfficerScope, leadershipRequestScope } from './pilotLeadership';

const loan = { id: 'local', loanNumber: '90001', borrowerName: 'Avery Example', borrowerFirstName: 'Avery', borrowerLastName: 'Example', loanOfficer: { email: 'officer@example.test' }, secondaryLoanOfficer: null };
const address = '1 Demo Road, Unit 42, Example, CA 90210';
const details = { sysGUID: 'guid', ariveLoanId: loan.loanNumber, loanBorrowers: [{ firstName: 'Avery', lastName: 'Example', applicantType: 'Borrower' }], subjectProperty: { addressLineText: '1 Demo Rd', addressUnitIdentifier: 'Unit 42', city: 'Example', state: 'CA', postalCode: '90210-1234' } };
const data = { leadershipPilotTest: true, leadershipTestSubmitterId: 'other', processingDocumentTaskId: 'private-doc-task', notes: 'ordinary conversation' };
beforeEach(() => { vi.resetAllMocks(); m.available.mockReturnValue(true); m.verify.mockReturnValue({ guid: 'guid' }); });
describe('shared test identification and visibility', () => {
  it('requires the actual LO to be the primary originator in the verified Arive response', async () => {
    const search = { count: 1, rows: [{ ariveLoanId: loan.loanNumber, sysGUID: 'guid' }] };
    for (const originator of ['another@example.test', undefined]) {
      m.read.mockResolvedValueOnce(search).mockResolvedValueOnce({ ...details, loanOriginatorEmail: originator,
        loanTeam: [{ loanRole: 'Originator', emailAddressText: loan.loanOfficer.email }] });
      await expect(verifyLeadershipSubmissionLoan(loan, address, undefined, true)).rejects.toThrow('primary originator');
    }
    m.read.mockResolvedValueOnce(search).mockResolvedValueOnce({ ...details, loanOriginatorEmail: loan.loanOfficer.email.toUpperCase() });
    await expect(verifyLeadershipSubmissionLoan(loan, address, undefined, true)).resolves.toMatchObject({ guid: 'guid' });
  });
  it('compares the imported ARIVE UUID with the exact search result and the retrieved file', async () => {
    const guid = '139a20ca-49d4-4af7-8ed3-c76767a1908a';
    const anotherGuid = '631fd0ce-6599-4691-b692-15fe3809b695';
    const search = (id: string) => ({ count: 1, rows: [{ ariveLoanId: loan.loanNumber, sysGUID: id }] });
    await expect(verifyLeadershipSubmissionLoan(loan, address, 'invalid')).rejects.toThrow('MISMO file ID is invalid');
    expect(m.read).not.toHaveBeenCalled();
    m.read.mockResolvedValueOnce(search(anotherGuid));
    await expect(verifyLeadershipSubmissionLoan(loan, address, guid)).rejects.toThrow('differs from the ARIVE API file ID');
    expect(m.read).toHaveBeenCalledTimes(1);
    m.read.mockResolvedValueOnce(search(guid)).mockResolvedValueOnce({ ...details, sysGUID: anotherGuid });
    await expect(verifyLeadershipSubmissionLoan(loan, address, guid)).rejects.toThrow('differs from the ARIVE API file ID');
    expect(m.verify).not.toHaveBeenCalled();
    m.read.mockResolvedValueOnce(search(guid)).mockResolvedValueOnce({ ...details, sysGUID: guid });
    m.verify.mockReturnValueOnce({ guid });
    await expect(verifyLeadershipSubmissionLoan(loan, address, guid.toUpperCase())).resolves.toMatchObject({ guid });
    expect(m.verify).toHaveBeenCalledWith(expect.objectContaining({ sysGUID: guid }), loan, { ariveGuid: guid });
  });
  it('verifies the exact source file, primary applicant and complete property including unit', async () => {
    const search = { count: 1, rows: [{ ariveLoanId: loan.loanNumber, sysGUID: 'guid' }] };
    m.read.mockResolvedValueOnce(search).mockResolvedValueOnce(details);
    expect(await verifyLeadershipSubmissionLoan({ ...loan, secondaryLoanOfficer: { email: 'secondary@example.test' } }, address)).toMatchObject({ guid: 'guid' });
    expect(m.verify).toHaveBeenCalledWith(details, loan, { ariveGuid: 'guid' });
    for (const mismatch of [ { ...details, loanBorrowers: [{ ...details.loanBorrowers[0], applicantType: 'CoBorrower' }] }, { ...details, subjectProperty: { ...details.subjectProperty, addressUnitIdentifier: 'Unit 43' } }, { ...details, subjectProperty: {} } ]) {
      m.read.mockResolvedValueOnce(search).mockResolvedValueOnce(mismatch);
      await expect(verifyLeadershipSubmissionLoan(loan, address)).rejects.toThrow();
    }
    expect(sameLeadershipTestProperty('1 Demo Rd, Unit 42, Different City, CA 90210', address)).toBe(false);
    expect(sameLeadershipTestProperty('1 Demo Rd, Example, CA 90210', address)).toBe(false);
  });
  it.each([
    [{ currentLoanStatus: { status: 'PREAPPROVED' } }, true, 'Preapproved'],
    [{ currentLoanStatus: { status: 'UNDERWRITING_SUBMITTED' } }, true, 'Submitted to underwriting'],
    [{ currentLoanStatus: { status: 'APPLICATION_INTAKE' }, loanStatusHistory: [{ status: 'PREAPPROVED' }] }, false, 'Application intake'],
    [{ currentLoanStatus: { status: 'LOAN_FUNDED' } }, false, 'Funded'],
    [{ currentLoanStatus: { status: 'SUSPENDED' } }, false, 'Suspended'],
    [{ currentLoanStatus: { status: 'SUBBED_TO_UW' } }, false, 'Unrecognized or missing status'],
    [{}, false, 'Unrecognized or missing status'],
    [{ currentLoanStatus: { status: 'PREAPPROVED', adverseReason: 'APP_WITHDRAWN_BY_BORROWER' } }, false, 'Adverse action'],
    [{ archiveIndicator: true, currentLoanStatus: { status: 'UNDERWRITING_SUBMITTED' } }, false, 'Archived'],
    [{ archiveIndicator: 'true', currentLoanStatus: { status: 'PREAPPROVED' } }, false, 'Unknown archive status'],
  ] as const)('uses only the verified details for stage %j', async (state, eligible, stageLabel) => {
    m.read.mockResolvedValueOnce({ count: 1, rows: [{ ariveLoanId: loan.loanNumber, sysGUID: 'guid', currentLoanStatus: { status: 'PREAPPROVED' } }] })
      .mockResolvedValueOnce({ ...details, ...state });
    const result = await verifyLeadershipSubmissionLoan(loan, address);
    expect(result.stage).toMatchObject({ eligible, stageLabel, checkedAt: expect.any(String) });
  });
  it('never exposes unexpected database or transport error details to the submission form', () => {
    expect(submissionVerificationMessage(new Error('private diagnostic details'))).toBe('BISU could not verify the current Arive status. Check again before continuing.');
  });
  it('projects ordinary parent and child task data in Standard and exposes documents only for the active Pilot leadership viewer', async () => {
    const row = { submissionData: data, parentTask: { submissionData: data } };
    const staffRow = { submissionData: { notes: data.notes }, parentTask: { submissionData: { notes: data.notes } } };
    expect(await projectSharedTestTasks([row], 'PROCESSOR_JR')).toEqual([staffRow]); expect(m.actor).not.toHaveBeenCalled();
    m.actor.mockResolvedValue({ role: 'MANAGER', pilotViewEnabled: false });
    expect(await projectSharedTestTasks([row], 'MANAGER')).toEqual([staffRow]);
    m.actor.mockResolvedValue({ role: 'MANAGER', pilotViewEnabled: true });
    expect(await projectSharedTestTasks([row], 'MANAGER')).toEqual([row]);
    expect(await projectSharedTestTasks([row], 'ADMIN_III')).toEqual([staffRow]);
    expect(row.submissionData.processingDocumentTaskId).toBe('private-doc-task');
  });
  it('only projects an opted-in officer’s own labeled request and assigned correction in Tasks', async () => {
    const loan = { loanOfficerId: 'other' };
    const request = { kind: 'SUBMIT_PROCESSING', submissionData: data, loan };
    const correction = { ...request, kind: 'LO_NEEDS_INFO', assignedUser: { id: 'other' }, parentTask: request };
    m.submissionActor.mockResolvedValue({ id: 'other', role: 'LOAN_OFFICER' });
    const results = await projectSharedTestTasks([request, correction, { ...request, loan: { loanOfficerId: 'reassigned' } },
      { ...request, submissionData: { ...data, leadershipTestSubmitterId: 'someone-else' } },
      { ...correction, assignedUser: { id: 'another-officer' } }], 'LOAN_OFFICER');
    expect(results.slice(0, 2)).toEqual([request, correction]);
    for (const row of results.slice(2)) expect(row.submissionData).not.toHaveProperty('processingDocumentTaskId');
    m.submissionActor.mockRejectedValue(new Error('Pilot disabled'));
    expect((await projectSharedTestTasks([request], 'LOAN_OFFICER'))[0].submissionData).toEqual({ notes: data.notes });
  });
  it('scopes processing managers by assignment or ownership of a deliberately created test and limits their officer directory', async () => {
    const actor = { id: 'pm', role: 'PROCESSING_MANAGER' as const, pilotViewEnabled: true };
    m.actor.mockResolvedValue(actor);
    const foreign = { assignedRole: 'PROCESSOR_JR', assignedUserId: 'someone-else', submissionData: data };
    const assigned = { ...foreign, assignedUserId: actor.id };
    const own = { ...foreign, submissionData: { ...data, leadershipTestSubmitterId: actor.id } };
    expect(canAccessLeadershipRequest(actor, foreign)).toBe(false);
    expect(canAccessLeadershipRequest(actor, assigned)).toBe(true);
    expect(canAccessLeadershipRequest(actor, own)).toBe(true);
    expect(canAccessLeadershipRequest(actor, { ...own, submissionData: { leadershipTestSubmitterId: actor.id } })).toBe(false);
    expect(leadershipRequestScope(actor)).toMatchObject({ OR: [{ assignedRole: actor.role }, { assignedUserId: actor.id }, { AND: expect.any(Array) }] });
    expect(leadershipOfficerScope(actor)).toMatchObject({ AND: [expect.objectContaining({ active: true }), { OR: [{ loansAsLO: expect.anything() }, { loansAsSecondaryLO: expect.anything() }] }] });
    const result = await projectSharedTestTasks([foreign, assigned, own], actor.role);
    expect(result[0].submissionData).toEqual({ notes: data.notes }); expect(result.slice(1)).toEqual([assigned, own]);
  });
});
