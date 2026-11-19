import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ actor: vi.fn(), read: vi.fn(), available: vi.fn(), verify: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./pilotPracticeAccess', () => ({ getPilotActor: m.actor, pilotViewAvailable: m.available }));
vi.mock('./ariveClient', () => ({ ariveReadOnlySession: async () => m.read }));
vi.mock('./ariveRollout', () => ({ verifyAriveRolloutIdentity: m.verify }));
import { projectSharedTestTasks, sameLeadershipTestProperty, verifyLeadershipSubmissionLoan } from './leadershipTestSubmission';
import { canAccessLeadershipRequest, leadershipOfficerScope, leadershipRequestScope } from './pilotLeadership';

const loan = { id: 'local', loanNumber: '90001', borrowerName: 'Avery Example', borrowerFirstName: 'Avery', borrowerLastName: 'Example', loanOfficer: { email: 'officer@example.test' }, secondaryLoanOfficer: null };
const address = '1 Demo Road, Unit 42, Example, CA 90210';
const details = { sysGUID: 'guid', ariveLoanId: loan.loanNumber, loanBorrowers: [{ firstName: 'Avery', lastName: 'Example', applicantType: 'Borrower' }], subjectProperty: { addressLineText: '1 Demo Rd', addressUnitIdentifier: 'Unit 42', city: 'Example', state: 'CA', postalCode: '90210-1234' } };
const data = { leadershipPilotTest: true, leadershipTestSubmitterId: 'other', processingDocumentTaskId: 'private-doc-task', notes: 'ordinary conversation' };
beforeEach(() => { vi.resetAllMocks(); m.available.mockReturnValue(true); m.verify.mockReturnValue({ guid: 'guid' }); });
describe('shared test identification and visibility', () => {
  it('verifies the exact source file, primary applicant and complete property including unit', async () => {
    const search = { count: 1, rows: [{ ariveLoanId: loan.loanNumber, sysGUID: 'guid' }] };
    m.read.mockResolvedValueOnce(search).mockResolvedValueOnce(details);
    expect(await verifyLeadershipSubmissionLoan({ ...loan, secondaryLoanOfficer: { email: 'secondary@example.test' } }, address)).toEqual({ guid: 'guid' });
    expect(m.verify).toHaveBeenCalledWith(details, loan, { ariveGuid: 'guid' });
    for (const mismatch of [ { ...details, loanBorrowers: [{ ...details.loanBorrowers[0], applicantType: 'CoBorrower' }] }, { ...details, subjectProperty: { ...details.subjectProperty, addressUnitIdentifier: 'Unit 43' } }, { ...details, subjectProperty: {} } ]) {
      m.read.mockResolvedValueOnce(search).mockResolvedValueOnce(mismatch);
      await expect(verifyLeadershipSubmissionLoan(loan, address)).rejects.toThrow();
    }
    expect(sameLeadershipTestProperty('1 Demo Rd, Unit 42, Different City, CA 90210', address)).toBe(false);
    expect(sameLeadershipTestProperty('1 Demo Rd, Example, CA 90210', address)).toBe(false);
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
