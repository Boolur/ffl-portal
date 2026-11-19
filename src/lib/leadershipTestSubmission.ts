import 'server-only';
import { getPilotActor, pilotViewAvailable } from './pilotPracticeAccess';
import { ariveReadOnlySession } from './ariveClient';
import { verifyAriveRolloutIdentity, type AriveRolloutLoanIdentity } from './ariveRollout';
import { Prisma } from '@prisma/client';
import { canAccessLeadershipRequest, isPilotLeadershipRole, standardSharedTestData } from './pilotLeadership';
import { normalizeAriveIdentity } from './ariveIdentity';
import { projectAriveApplicationSnapshot } from './ariveApplicationSnapshot';
import { normalizeProcessingProperty } from './processingBorrowerDetails';

export async function requireLeadershipPilot() {
  const actor = await getPilotActor(false);
  if (!pilotViewAvailable() || !actor.pilotViewEnabled) throw new Error('Turn on Pilot in a leadership role to open this workspace.');
  return actor;
}

export function isLeadershipTestRequest(data: unknown) {
  return !!data && typeof data === 'object' && 'leadershipPilotTest' in data && data.leadershipPilotTest === true;
}

export async function leadershipTestViewer(data: unknown, role: unknown) {
  if (!isLeadershipTestRequest(data) || !isPilotLeadershipRole(role)) return false;
  try { return (await requireLeadershipPilot()).role === role; }
  catch { return false; }
}

export async function projectSharedTestTasks<T extends { submissionData: Prisma.JsonValue | null; parentTask?: { submissionData: Prisma.JsonValue | null } | null }>(
  tasks: T[], role: unknown,
): Promise<T[]> {
  const anyTest = tasks.find(task => isLeadershipTestRequest(task.submissionData) || isLeadershipTestRequest(task.parentTask?.submissionData));
  if (!anyTest) return tasks;
  const actor = isPilotLeadershipRole(role) ? await requireLeadershipPilot().catch(() => null) : null;
  if (actor && actor.role === role && role !== 'PROCESSING_MANAGER') return tasks;
  return tasks.map(task => {
    if (actor && actor.role === role && canAccessLeadershipRequest(actor, task.parentTask ?? task)) return task;
    return { ...task, submissionData: standardSharedTestData(task.submissionData),
      ...(task.parentTask ? { parentTask: { ...task.parentTask, submissionData: standardSharedTestData(task.parentTask.submissionData) } } : {}) };
  });
}

const addressWords: Record<string, string> = { street: 'st', road: 'rd', drive: 'dr', avenue: 'ave', lane: 'ln', boulevard: 'blvd', court: 'ct', apartment: 'unit', apt: 'unit' };
export function sameLeadershipTestProperty(left: string | null, right: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/[,.]/g, ' ').replace(/#/g, ' unit ').replace(/\b(\d{5})-\d{4}\b/g, '$1').trim().split(/\s+/).map(word => addressWords[word] ?? word).join(' ');
  return Boolean(left?.trim() && right.trim() && normalize(left) === normalize(right));
}

export async function verifyLeadershipSubmissionLoan(loan: AriveRolloutLoanIdentity, expectedAddress: string) {
  if (!/^\d{1,15}$/.test(loan.loanNumber)) throw new Error('Import the numeric Arive loan number from the MISMO.');
  const read = await ariveReadOnlySession();
  const search = await read('/loans?searchField=DISPLAY_ID&searchValue=' + encodeURIComponent(loan.loanNumber) + '&limit=100&offset=0');
  const matches = Array.isArray(search.rows) ? search.rows.filter((row: { ariveLoanId?: unknown }) => String(row?.ariveLoanId) === loan.loanNumber) : [];
  if (search.count !== search.rows?.length || matches.length !== 1 || typeof matches[0]?.sysGUID !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(matches[0].sysGUID)) {
    throw new Error('The MISMO number does not identify one accessible Arive file.');
  }
  const details = await read('/loans/' + encodeURIComponent(matches[0].sysGUID));
  // A secondary officer alone cannot establish the selected primary LO on a shared submission.
  const match = verifyAriveRolloutIdentity(details, { ...loan, secondaryLoanOfficer: null }, { ariveGuid: matches[0].sysGUID });
  const application = projectAriveApplicationSnapshot(details);
  const primary = application.applicants.some(person => person.role === 'Borrower' && normalizeAriveIdentity(person.firstName) === normalizeAriveIdentity(loan.borrowerFirstName) && normalizeAriveIdentity(person.lastName) === normalizeAriveIdentity(loan.borrowerLastName));
  if (!application.property) throw new Error('Arive did not return the subject property for this submission.');
  const { street, unit, city, state, postalCode } = application.property;
  const property = normalizeProcessingProperty({ street, unit, city, state, zip: postalCode });
  if (!primary || !property.success || !sameLeadershipTestProperty(property.address, expectedAddress)) throw new Error('The primary borrower or subject property in Arive differs from this submission.');
  return match;
}
