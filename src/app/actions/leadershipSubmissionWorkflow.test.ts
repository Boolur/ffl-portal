import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialPilotPackage } from '../../lib/submissionPilot';

// Exercise the same server actions as the submission popup and desk. External
// identity, storage, delivery, and database calls are isolated for this suite.
const m = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(), $queryRaw: vi.fn(), user: { findUnique: vi.fn() },
    loan: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() }, payrollCompRequest: { count: vi.fn() },
    task: { findFirst: vi.fn(), create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    arivePracticeLoan: { findMany: vi.fn(), upsert: vi.fn() }, auditLog: { create: vi.fn() },
  };
  const db = { $transaction: vi.fn(), $queryRaw: vi.fn(), user: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() }, loan: { findFirst: vi.fn() }, task: { findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() }, taskAttachment: { findMany: vi.fn() }, notificationOutbox: { create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() } };
  return { db, tx, session: vi.fn(), requirePilot: vi.fn(), viewer: vi.fn(), docs: vi.fn(), verify: vi.fn() };
});
vi.mock('next-auth', () => ({ getServerSession: m.session }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: m.db }));
vi.mock('@/lib/leadershipTestSubmission', () => ({
  getSubmissionPilotActor: m.requirePilot, verifyLeadershipSubmissionLoan: m.verify, leadershipTestViewer: m.viewer,
  submissionVerificationMessage: (error: Error) => error.message,
  isLeadershipTestRequest: (data: { leadershipPilotTest?: boolean } | null) => data?.leadershipPilotTest === true,
  sameLeadershipTestProperty: (a: string, b: string) => !!a && a === b,
}));
vi.mock('@/lib/processingSubmissionDocuments', () => ({ verifyProcessingSubmissionDocuments: m.docs }));
vi.mock('@/lib/submissionPilot', async () => import('../../lib/submissionPilot'));
vi.mock('@/lib/pilotLeadership', async () => import('../../lib/pilotLeadership'));
vi.mock('@/lib/pilotReviewChecklist', async () => import('../../lib/pilotReviewChecklist'));
vi.mock('@/lib/processingBorrowerDetails', async () => import('../../lib/processingBorrowerDetails'));
vi.mock('@/lib/processingRouting', async () => import('../../lib/processingRouting'));
vi.mock('@/lib/adminTiers', async () => import('../../lib/adminTiers'));
vi.mock('@/lib/taskLifecycleTimeline', async () => import('../../lib/taskLifecycleTimeline'));
vi.mock('@/lib/roleLabels', async () => import('../../lib/roleLabels'));
vi.mock('@/lib/email', () => ({}));
vi.mock('@/lib/emailRouting', () => ({}));
vi.mock('@/lib/emailPreferences', () => ({}));
vi.mock('@/lib/perf', () => ({ recordPerfMetric: vi.fn() }));
vi.mock('@/lib/taskPermissions', () => ({}));
vi.mock('@/lib/loanOfficerVisibility', () => ({}));
vi.mock('@/lib/payrollLenderOptions', () => ({ PAYROLL_LENDER_OPTIONS: [] }));
vi.mock('@/lib/taskBucketQueries', () => ({}));
vi.mock('@/lib/processingPipelineService', () => ({ lockProcessingPipelineForTask: vi.fn() }));
vi.mock('@/lib/leadPipelineSync', () => ({ leadStatusForTaskKind: () => null }));
vi.mock('@/lib/pipelineSubmissionShortcuts', () => ({}));
vi.mock('@/lib/processingManagerNotifications', () => ({}));

import { checkLeadershipSubmissionStage, createLeadershipTestSubmission, createSubmissionTask, requestInfoFromLoanOfficer, resolveLeadershipMismoOfficer, respondToDisclosureRequest, startQcRequest } from './taskActions';

const leader = { id: 'manager', name: 'Example Leader', role: 'MANAGER', roles: ['MANAGER'], active: true, pilotViewEnabled: true };
const officer = { id: 'lo', name: 'Example Originator', email: 'lo@example.test', role: 'LOAN_OFFICER', roles: ['LOAN_OFFICER'] };
const loan = { id: 'loan', loanOfficerId: officer.id, secondaryLoanOfficerId: null, borrowerName: 'Test Applicant', loanNumber: '90001', stage: 'INTAKE', propertyAddress: '1 Example Street, Example, VA 22201' };
const payload = {
  submissionType: 'QC' as const, loanOfficerId: officer.id, secondaryLoanOfficerId: null,
  borrowerFirstName: 'Test', borrowerLastName: 'Applicant', borrowerPhone: '2025550182', borrowerEmail: 'applicant@example.test', arriveLoanNumber: loan.loanNumber, loanAmount: '100000',
  submissionData: { leadSource: 'Referral', investor: 'UWM', propertyStreet: '1 Example Street', propertyCity: 'Example', propertyState: 'VA', propertyZip: '22201', appraisalNeeded: 'Yes', appraisalNotes: 'Test', cashBack: '0', projectedRevenue: '3000', processingMethod: 'IN_HOUSE', processingAssignmentGroup: 'KATHY_BUI' },
  processingDocuments: [],
};
const request = { id: 'request', title: 'Test - Submit for Processing', loanId: 'loan', loan, kind: 'SUBMIT_PROCESSING', assignedRole: 'PROCESSOR_JR', status: 'PENDING', workflowState: 'NONE', assignedUserId: null, updatedAt: new Date(), submissionData: { leadershipPilotTest: true, processingDocumentTaskId: 'package' } };
const stageInput = { ...payload.submissionData, arriveLoanNumber: loan.loanNumber, borrowerFirstName: 'Test', borrowerLastName: 'Applicant', loanOfficerId: officer.id };
const preapproved = { eligible: true, code: 'PREAPPROVED', stageLabel: 'Preapproved', checkedAt: '2026-01-01T12:00:00.000Z' };
const intake = { ...preapproved, eligible: false, code: 'APPLICATION_INTAKE', stageLabel: 'Application intake' };

beforeEach(() => {
  vi.resetAllMocks();
  m.session.mockResolvedValue({ user: leader });
  m.requirePilot.mockResolvedValue(leader);
  m.viewer.mockResolvedValue(true);
  m.verify.mockResolvedValue({ guid: 'verified-guid', stage: preapproved });
  m.db.user.findMany.mockResolvedValue([officer]);
  const pkg = initialPilotPackage(); pkg.state = 'REVIEW'; m.docs.mockResolvedValue(pkg);
  m.db.user.findUnique.mockImplementation(async q => q.where.id === officer.id ? officer : leader);
  m.tx.user.findUnique.mockResolvedValue(leader);
  m.tx.loan.create.mockResolvedValue(loan);
  m.tx.arivePracticeLoan.findMany.mockResolvedValue([]);
  m.tx.task.create.mockImplementation(async q => ({ ...q.data, id: q.data.kind ? 'request' : 'package' }));
  m.db.$transaction.mockImplementation(async run => run(m.tx));
  m.db.notificationOutbox.findMany.mockResolvedValue([]); m.db.$queryRaw.mockResolvedValue([]);
  m.db.taskAttachment.findMany.mockResolvedValue([]);
});

describe('shared leadership submission workflow', () => {
  it('keeps the opted-in officer’s own corrections in the document form when a stale standard response is sent', async () => {
    vi.stubEnv('PILOT_VIEW_ENABLED', 'true');
    try {
      m.session.mockResolvedValue({ user: { id: officer.id, role: 'MANAGER', activeRole: 'LOAN_OFFICER' } });
      m.db.user.findUnique.mockResolvedValue({ ...officer, active: true, roles: ['LOAN_OFFICER', 'MANAGER'],
        loanOfficerPilotEnabled: true, loQcSubmissionEnabled: true });
      m.db.task.findUnique.mockResolvedValueOnce({ id: 'correction', kind: 'LO_NEEDS_INFO', parentTaskId: 'request',
        status: 'PENDING', loan: { loanOfficerId: officer.id }, assignedUserId: officer.id })
        .mockResolvedValueOnce({ ...request, submissionData: { ...request.submissionData, leadershipTestSubmitterId: officer.id } });
      expect(await respondToDisclosureRequest('correction', 'Done')).toMatchObject({ success: false, error: expect.stringContaining('submission checklist') });
      expect(m.db.$transaction).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });
  it('checks and submits the signed-in pilot officer’s own file with an active secondary officer', async () => {
    const actor = { ...officer, active: true, roles: ['MANAGER', 'LOAN_OFFICER'], loanOfficerPilotEnabled: true, pilotViewEnabled: false, loQcSubmissionEnabled: true };
    const secondary = { ...officer, id: 'secondary', email: 'secondary@example.test' };
    m.session.mockResolvedValue({ user: actor }); m.requirePilot.mockResolvedValue(actor);
    m.db.user.findUnique.mockImplementation(async q => q.where.id === secondary.id ? secondary : actor);
    m.db.user.findMany.mockResolvedValueOnce([actor]).mockResolvedValueOnce([actor, secondary]);
    m.tx.user.findUnique.mockResolvedValue(actor);
    expect(await checkLeadershipSubmissionStage(stageInput)).toMatchObject({ success: true, eligible: true });
    expect(m.verify).toHaveBeenCalledWith(expect.objectContaining({ loanOfficer: actor }), expect.any(String), undefined, true);
    expect(await createLeadershipTestSubmission({ ...payload, secondaryLoanOfficerId: secondary.id })).toMatchObject({ success: true, taskId: 'request' });
    expect(m.tx.task.create.mock.calls[1][0].data.submissionData).toMatchObject({ leadershipPilotTest: true, leadershipTestSubmitterId: actor.id });
  });

  it('rejects an impersonated primary, a file with a different owner, and a disabled LO Pilot', async () => {
    const actor = { ...officer, active: true, roles: ['LOAN_OFFICER', 'ADMIN_I'], loanOfficerPilotEnabled: true, loQcSubmissionEnabled: true };
    m.session.mockResolvedValue({ user: actor }); m.requirePilot.mockResolvedValue(actor);
    m.db.user.findUnique.mockResolvedValue(actor);
    expect(await checkLeadershipSubmissionStage({ ...stageInput, loanOfficerId: 'another' })).toMatchObject({ success: false });
    m.db.user.findUnique.mockImplementation(async q => q.where.id === actor.id ? actor : { ...officer, id: 'another' });
    expect(await createLeadershipTestSubmission({ ...payload, loanOfficerId: 'another' })).toMatchObject({ success: false });
    expect(m.docs).not.toHaveBeenCalled(); expect(m.db.$transaction).not.toHaveBeenCalled();
    m.db.loan.findFirst.mockResolvedValueOnce({ id: 'another-owners-file' });
    expect(await checkLeadershipSubmissionStage(stageInput)).toMatchObject({ success: false });
    expect(m.verify).not.toHaveBeenCalled();
    m.tx.user.findUnique.mockResolvedValue({ ...actor, loanOfficerPilotEnabled: false });
    expect(await createLeadershipTestSubmission(payload)).toMatchObject({ success: false });
    expect(m.tx.task.create).not.toHaveBeenCalled();
    m.tx.user.findUnique.mockResolvedValue({ ...actor, loQcSubmissionEnabled: false });
    expect(await createLeadershipTestSubmission(payload)).toMatchObject({ success: false });
    expect(m.tx.task.create).not.toHaveBeenCalled();
    m.requirePilot.mockRejectedValueOnce(new Error('Pilot is off'));
    expect(await checkLeadershipSubmissionStage(stageInput)).toMatchObject({ success: false });
  });

  it('only offers the acting LO’s own portal identity as the imported primary officer', async () => {
    m.requirePilot.mockResolvedValue(officer);
    m.db.user.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: officer.id }]);
    expect(await resolveLeadershipMismoOfficer('another@example.test')).toBeNull();
    expect(await resolveLeadershipMismoOfficer(officer.email)).toBe(officer.id);
    expect(m.db.user.findMany).toHaveBeenCalledWith({ where: { AND: [
      { id: officer.id, active: true }, { email: { equals: officer.email, mode: 'insensitive' } },
    ] }, select: { id: true }, take: 2 });
  });
  it('returns a read-only stage result and verifies it again if the file moves back to intake before submission', async () => {
    m.verify.mockResolvedValueOnce({ guid: 'verified-guid', stage: preapproved }).mockResolvedValueOnce({ guid: 'verified-guid', stage: intake });
    expect(await checkLeadershipSubmissionStage(stageInput)).toEqual({ success: true, eligible: true, stageLabel: 'Preapproved', checkedAt: preapproved.checkedAt });
    const response = await createLeadershipTestSubmission({ ...payload, submissionData: { ...payload.submissionData, preApproved: 'Yes', qualificationStatus: 'Preapproved' } });
    expect(response).toMatchObject({ success: false, stageCheckFailed: true, error: expect.stringContaining('Application intake') });
    expect(m.verify).toHaveBeenCalledTimes(2);
    expect(m.docs).not.toHaveBeenCalled(); expect(m.db.$transaction).not.toHaveBeenCalled();
    expect(m.db.notificationOutbox.create).not.toHaveBeenCalled();
  });
  it('blocks checks for Standard, an unavailable loan, an out-of-scope officer or a changed Pilot session', async () => {
    m.requirePilot.mockRejectedValueOnce(new Error('Pilot is off'));
    expect(await checkLeadershipSubmissionStage(stageInput)).toMatchObject({ success: false });
    const pm = { ...leader, role: 'PROCESSING_MANAGER' };
    m.requirePilot.mockResolvedValue(pm); m.db.loan.findFirst.mockResolvedValueOnce({ id: 'hidden' });
    expect(await checkLeadershipSubmissionStage(stageInput)).toMatchObject({ success: false });
    expect(m.db.loan.findFirst).toHaveBeenCalledWith({ where: { loanNumber: loan.loanNumber, NOT: { OR: expect.any(Array) } }, select: { id: true } });
    m.db.user.findMany.mockResolvedValueOnce([]);
    expect(await checkLeadershipSubmissionStage(stageInput)).toMatchObject({ success: false });
    expect(m.verify).not.toHaveBeenCalled();
    m.requirePilot.mockResolvedValueOnce(pm).mockResolvedValueOnce(leader);
    expect(await checkLeadershipSubmissionStage(stageInput)).toMatchObject({ success: false });
    expect(m.verify).toHaveBeenCalledTimes(1);
    expect(m.db.$transaction).not.toHaveBeenCalled();
  });
  it('records the fresh underwriting decision even if the submitted details claim pre-approval', async () => {
    m.verify.mockResolvedValueOnce({ guid: 'verified-guid', stage: { ...preapproved, code: 'UNDERWRITING_SUBMITTED', stageLabel: 'Submitted to underwriting' } });
    expect(await createLeadershipTestSubmission({ ...payload, submissionData: { ...payload.submissionData, preApproved: 'Yes', qualificationStatus: 'invented' } })).toMatchObject({ success: true });
    const saved = m.tx.task.create.mock.calls[1][0].data.submissionData;
    expect(saved.qualificationStatus).toBe('Submitted to underwriting'); expect(saved).not.toHaveProperty('preApproved');
  });
  it('resolves exactly one active officer in the current Pilot scope and only returns their option ID', async () => {
    m.requirePilot.mockResolvedValue({ ...leader, role: 'PROCESSING_MANAGER' });
    m.db.user.findMany.mockResolvedValueOnce([{ id: 'choice' }]).mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]).mockResolvedValueOnce([]);
    expect(await resolveLeadershipMismoOfficer(' owner@example.test ')).toBe('choice');
    expect(m.db.user.findMany).toHaveBeenCalledWith({ where: { AND: [
      expect.objectContaining({ AND: [expect.objectContaining({ active: true }), expect.objectContaining({ OR: expect.any(Array) })] }),
      { email: { equals: 'owner@example.test', mode: 'insensitive' } },
    ] }, select: { id: true }, take: 2 });
    expect(await resolveLeadershipMismoOfficer('shared@example.test')).toBeNull();
    expect(await resolveLeadershipMismoOfficer('unknown@example.test')).toBeNull();
    m.requirePilot.mockRejectedValueOnce(new Error('Pilot required'));
    await expect(resolveLeadershipMismoOfficer('owner@example.test')).rejects.toThrow('Pilot required');
    expect(m.db.user.findMany).toHaveBeenCalledTimes(3);
  });
  it('passes the exported UUID to identity verification and stops before packaging or saving after a mismatch', async () => {
    const guid = '193f5f19-26a9-4b35-b27b-e2ee339e15d5';
    const message = 'The MISMO file ID differs from the ARIVE API file ID.';
    m.verify.mockRejectedValueOnce(new Error(message));
    expect(await createLeadershipTestSubmission({ ...payload, leadershipExportGuid: guid })).toMatchObject({
      success: false, error: expect.stringContaining(message),
    });
    expect(m.verify).toHaveBeenCalledWith(expect.objectContaining({ loanNumber: payload.arriveLoanNumber }), expect.any(String), guid, false);
    expect(m.docs).not.toHaveBeenCalled();
    expect(m.db.$transaction).not.toHaveBeenCalled();
  });
  it('creates the registered test, package, and standard desk request under one transaction', async () => {
    expect(await createLeadershipTestSubmission(payload)).toMatchObject({ success: true, taskId: 'request' });
    expect(m.docs).toHaveBeenCalledWith(payload.processingDocuments, leader.id);
    expect(m.db.$transaction).toHaveBeenCalledTimes(1);
    expect(m.tx.arivePracticeLoan.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ ariveLoanId: loan.loanNumber, ariveGuid: 'verified-guid' }) }));
    expect(m.tx.task.create.mock.calls.map(([q]) => q.data)).toMatchObject([
      { submissionData: { submissionPilot: { leadershipTest: true, leadershipSubmitterId: leader.id } } },
      { kind: 'SUBMIT_PROCESSING', assignedRole: 'PROCESSOR_JR', status: 'PENDING', submissionData: request.submissionData },
    ]);
    expect(m.db.notificationOutbox.create.mock.calls[0][0].data.payload.eventLabel).toBe('New Request Submitted');
  });
  it('refuses documents through Standard, and an existing real loan through a Pilot test submission', async () => {
    expect(await createSubmissionTask(payload)).toMatchObject({ success: false });
    expect(m.docs).not.toHaveBeenCalled();
    m.tx.loan.findFirst.mockResolvedValue(loan);
    m.tx.loan.findUnique.mockResolvedValue({ processingPipeline: { id: 'active-pipeline' }, _count: { tasks: 1 } });
    expect(await createLeadershipTestSubmission(payload)).toMatchObject({ success: false });
    expect(m.tx.task.create).not.toHaveBeenCalled(); expect(m.tx.arivePracticeLoan.upsert).not.toHaveBeenCalled();
  });
  it('does not create a second document package or notify the desk for a duplicate request', async () => {
    m.tx.loan.findFirst.mockResolvedValue(loan);
    m.tx.arivePracticeLoan.findMany.mockResolvedValue([{ enabled: true, ariveLoanId: loan.loanNumber, ariveGuid: 'verified-guid' }]);
    m.tx.task.findFirst.mockResolvedValue(request);
    expect(await createLeadershipTestSubmission(payload)).toMatchObject({ success: false });
    expect(m.tx.task.create).not.toHaveBeenCalled(); expect(m.db.notificationOutbox.create).not.toHaveBeenCalled();
  });
  it('links an explicitly designated, exact, unused existing intake without changing its loan or registering it as synthetic', async () => {
    m.tx.loan.findFirst.mockResolvedValue(loan);
    m.tx.loan.findUnique.mockResolvedValue({ processingPipeline: null, _count: { tasks: 0 } });
    m.tx.payrollCompRequest.count.mockResolvedValue(0);
    expect(await createLeadershipTestSubmission(payload)).toMatchObject({ success: true, loanId: loan.id });
    expect(m.tx.loan.create).not.toHaveBeenCalled(); expect(m.tx.arivePracticeLoan.upsert).not.toHaveBeenCalled();
    expect(m.tx.task.create).toHaveBeenCalledTimes(2);
  });
  it.each([{ enabled: false, ariveLoanId: '90001', ariveGuid: 'verified-guid' }, { enabled: true, ariveLoanId: '90001', ariveGuid: 'different-guid' }, { enabled: true, ariveLoanId: '90002', ariveGuid: 'verified-guid' }])('rejects conflicting registrations before any write', async registration => {
    m.tx.arivePracticeLoan.findMany.mockResolvedValue([registration]);
    expect(await createLeadershipTestSubmission(payload)).toMatchObject({ success: false });
    expect(m.tx.loan.create).not.toHaveBeenCalled(); expect(m.tx.task.create).not.toHaveBeenCalled(); expect(m.tx.arivePracticeLoan.upsert).not.toHaveBeenCalled();
  });
  it('requires Start under the leadership test form and returns the request to a real LO correction task', async () => {
    const input = { reason: 'MISSING_ITEMS' as const, message: 'Please update the statement.', leadershipReview: true };
    const pkg = initialPilotPackage(); pkg.leadershipTest = true; pkg.leadershipSubmitterId = leader.id; pkg.state = 'REVIEW';
    pkg.items[0].review = 'CHANGES'; pkg.items[0].feedback = 'Statement';
    const packageTask = { id: 'package', loanId: 'loan', updatedAt: new Date(), submissionData: { submissionPilot: pkg } };
    m.db.task.findUnique.mockImplementation(async q => q.where.id === 'package' ? packageTask : request);
    expect(await requestInfoFromLoanOfficer(request.id, input)).toMatchObject({ success: false });
    expect(m.tx.task.update).not.toHaveBeenCalled();
    m.db.task.updateMany.mockResolvedValue({ count: 1 });
    expect(await startQcRequest(request.id)).toMatchObject({ success: true });
    const started = { ...request, ...m.db.task.updateMany.mock.calls[0][0].data };
    m.db.task.findUnique.mockImplementation(async q => q.where.id === 'package' ? packageTask : started);
    m.tx.task.findUnique.mockResolvedValueOnce({ ...started, updatedAt: new Date(started.updatedAt.getTime() + 10) });
    expect(await requestInfoFromLoanOfficer(request.id, input)).toMatchObject({ success: false });
    expect(m.tx.task.updateMany).not.toHaveBeenCalled(); expect(m.tx.task.create).not.toHaveBeenCalled();
    m.tx.task.findUnique.mockResolvedValue(started);
    m.tx.user.findUnique.mockResolvedValueOnce({ ...leader, pilotViewEnabled: false });
    expect(await requestInfoFromLoanOfficer(request.id, input)).toMatchObject({ success: false });
    expect(m.tx.task.updateMany).not.toHaveBeenCalled(); expect(m.tx.task.create).not.toHaveBeenCalled();
    m.tx.task.updateMany.mockResolvedValue({ count: 1 });
    expect(await requestInfoFromLoanOfficer(request.id, input)).toMatchObject({ success: true });
    expect(m.tx.task.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: request.id }, data: expect.objectContaining({ status: 'BLOCKED', workflowState: 'WAITING_ON_LO' }) }));
    expect(m.tx.task.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: 'LO_NEEDS_INFO', parentTaskId: request.id, assignedUserId: officer.id }) }));
    expect(m.db.notificationOutbox.create.mock.calls.map(([q]) => q.data.payload.eventLabel)).toEqual(['Processing Request Started', 'Sent to Loan Officer']);
    m.viewer.mockResolvedValue(false);
    expect(await requestInfoFromLoanOfficer(request.id, input)).toMatchObject({ success: false });
  });
  it('refuses direct Start and review of another manager’s request and out-of-scope officer selections', async () => {
    const pm = { ...leader, role: 'PROCESSING_MANAGER' };
    m.session.mockResolvedValue({ user: pm }); m.requirePilot.mockResolvedValue(pm);
    m.db.task.findUnique.mockResolvedValue(request);
    expect(await startQcRequest(request.id)).toMatchObject({ success: false });
    expect(await requestInfoFromLoanOfficer(request.id, { reason: 'MISSING_ITEMS', message: 'Review', leadershipReview: true })).toMatchObject({ success: false });
    m.db.user.findMany.mockResolvedValue([]);
    expect(await createLeadershipTestSubmission(payload)).toMatchObject({ success: false });
    expect(m.verify).not.toHaveBeenCalled(); expect(m.db.task.updateMany).not.toHaveBeenCalled(); expect(m.tx.task.create).not.toHaveBeenCalled();
  });
});
