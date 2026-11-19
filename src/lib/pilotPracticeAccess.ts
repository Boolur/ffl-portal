import 'server-only';
import { getServerSession } from 'next-auth';
import { Prisma, UserRole } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canLoanOfficerViewLoan } from './loanOfficerVisibility';
import { buildProcessingPipelineScopeWhere, getProcessingPipelineAccess } from './processingPipeline';
import { canUseOfficerSubmissionPilot, isPilotLeadershipRole } from './pilotLeadership';

const adminRoles: UserRole[] = [UserRole.ADMIN_I, UserRole.ADMIN_II, UserRole.ADMIN_III];
export const pilotViewAvailable = () => process.env.PILOT_VIEW_ENABLED === 'true';
export const pilotPracticeAvailable = () => pilotViewAvailable() && process.env.PILOT_PRACTICE_ENABLED === 'true';
async function getPilotIdentity() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new Error('Sign in with an account that can access this practice workspace.');
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, active: true, name: true, role: true, roles: true, processingAssignmentGroups: true, pilotViewEnabled: true, loanOfficerPilotEnabled: true, loQcSubmissionEnabled: true } });
  const role = (session.user.activeRole || session.user.role) as UserRole;
  if (!user?.active || (role !== user.role && !user.roles.includes(role))) throw new Error('Your account or selected role is unavailable.');
  return { ...user, role, assignedRoles: [user.role, ...user.roles], admin: adminRoles.includes(role) };
}

export async function getPilotPreferenceActor() {
  const actor = await getPilotIdentity();
  if (!isPilotLeadershipRole(actor.role) && !canUseOfficerSubmissionPilot(actor.id, actor.role, actor.assignedRoles)) {
    throw new Error('Pilot mode is unavailable in this role.');
  }
  return actor;
}

/** Only authorizes the submission form. Desk, reviewer and collector permissions are separate. */
export async function getSubmissionPilotActor() {
  const actor = await getPilotPreferenceActor();
  const enabled = actor.role === 'LOAN_OFFICER'
    ? actor.loanOfficerPilotEnabled && actor.loQcSubmissionEnabled : actor.pilotViewEnabled;
  if (!pilotViewAvailable() || !enabled) throw new Error('Open Submit for Processing with Pilot turned on in your current role.');
  return actor;
}

export async function getPilotActor(requirePractice = true) {
  const actor = await getPilotIdentity();
  if (!isPilotLeadershipRole(actor.role)) throw new Error('Pilot view requires an active leadership role.');
  if (requirePractice && (!pilotPracticeAvailable() || !actor.pilotViewEnabled)) throw new Error('Practice workspace requires Pilot mode.');
  return actor;
}
export type PilotPracticeActor = Awaited<ReturnType<typeof getPilotActor>>;
export const practiceLoanSelect = { id: true, loanNumber: true, borrowerName: true, loanOfficerId: true, secondaryLoanOfficerId: true, visibilitySubmitterUserId: true, updatedAt: true, amount: true, program: true, propertyAddress: true, borrowerEmail: true, borrowerPhone: true } satisfies Prisma.LoanSelect;
const practicePipelineSelect = { id: true, version: true, updatedAt: true, sheet: true, pipelineStatus: true, lender: true, loanType: true, propertyState: true, processingMethod: true, titleStatus: true, hoiStatus: true, payoffStatus: true, appraisalNeeded: true } satisfies Prisma.ProcessingPipelineLoanSelect;
type Db = Prisma.TransactionClient;

export async function authorizePracticeSource(actor: PilotPracticeActor, source: { sourceTaskId: string | null; sourceLoanId: string | null }, db: Db = prisma) {
  if (source.sourceTaskId) {
    const task = await db.task.findUnique({ where: { id: source.sourceTaskId }, include: { loan: { select: practiceLoanSelect } } });
    if (!task || (source.sourceLoanId && task.loanId !== source.sourceLoanId)) throw new Error('The original task is no longer available to this account.');
    const owner = actor.role === UserRole.LOAN_OFFICER && canLoanOfficerViewLoan(task.loan, actor.id);
    const roleMatches = task.assignedRole === actor.role || (actor.role === UserRole.PROCESSOR_JR && (task.assignedRole === UserRole.VA_HOI || task.kind === 'VA_HOI'));
    const assigned = roleMatches && (!task.assignedUserId || task.assignedUserId === actor.id);
    const activeTaskRole = ['LOAN_OFFICER', 'LOA', 'PROCESSOR_JR', 'PROCESSOR_SR', 'PROCESSING_MANAGER', 'MANAGER', 'DISCLOSURE_SPECIALIST'].includes(actor.role);
    if (!actor.admin && (!activeTaskRole || (actor.role === UserRole.LOAN_OFFICER ? !owner : !assigned && actor.role !== UserRole.MANAGER))) throw new Error('The original task is no longer available to this account.');
    const pipeline = getProcessingPipelineAccess(actor.role).canView ? await db.processingPipelineLoan.findFirst({ where: { AND: [{ loanId: task.loanId }, buildProcessingPipelineScopeWhere(actor)] }, select: practicePipelineSelect }) : null;
    return { task, loan: task.loan, pipeline };
  }
  if (source.sourceLoanId) {
    const loan = await db.loan.findUnique({ where: { id: source.sourceLoanId }, select: practiceLoanSelect });
    if (!loan) throw new Error('The original loan is no longer available to this account.');
    if (!getProcessingPipelineAccess(actor.role).canView) throw new Error('The original loan is no longer available to this account.');
    const pipeline = await db.processingPipelineLoan.findFirst({ where: { AND: [{ loanId: loan.id }, buildProcessingPipelineScopeWhere(actor)] }, select: practicePipelineSelect });
    if (!pipeline) throw new Error('The original loan is no longer available to this account.');
    return { task: null, loan, pipeline };
  }
  return null;
}

export async function getAuthorizedPracticeTask(id: string, actor: PilotPracticeActor, db: Db = prisma) {
  if (typeof id !== 'string' || !id || id.length > 100) throw new Error('Practice task not found.');
  const task = await db.pilotPracticeTask.findUnique({ where: { id }, include: { package: { include: { files: { orderBy: { createdAt: 'asc' } } } } } });
  if (!task || (task.ownerId !== actor.id && !actor.admin)) throw new Error('Practice task not found.');
  await authorizePracticeSource(actor, task, db);
  if (!task.package) throw new Error('Practice checklist not found.');
  return task as typeof task & { package: NonNullable<typeof task.package> };
}

export async function practiceResult<T>(work: () => Promise<T>) {
  try { return { success: true as const, data: await work() }; }
  catch (error) {
    // Only intentional validation messages leave the server; storage/database details never do.
    const message = error instanceof Error && !('code' in error) && !('statusCode' in error) && !/https?:\/\/|prisma|supabase|postgres|\n/i.test(error.message)
      ? error.message : 'Unable to complete this practice action. Please try again.';
    return { success: false as const, error: message };
  }
}
