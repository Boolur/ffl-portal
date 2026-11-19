import type { Prisma, UserRole } from '@prisma/client';
import { canUseOfficerSubmissionPilot } from './pilotLeadership';

export type OfficerSubmissionTarget = { loanOfficerId: string; arriveLoanNumber: string };

export function officerDocumentAccess(user: {
  id: string; active: boolean; role: UserRole; roles: UserRole[]; loanOfficerPilotEnabled: boolean; loQcSubmissionEnabled: boolean;
}, role: UserRole) {
  return process.env.PILOT_VIEW_ENABLED === 'true' && user.active && user.loanOfficerPilotEnabled && user.loQcSubmissionEnabled &&
    canUseOfficerSubmissionPilot(user.id, role, [user.role, ...user.roles]);
}

/** The LO has to be both the current primary officer and the test's original submitter. */
export function ownsOfficerTestRequest(actorId: string, primaryOfficerId: string | null | undefined, value: unknown) {
  if (!actorId || primaryOfficerId !== actorId || !value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return data.leadershipPilotTest === true && data.leadershipTestSubmitterId === actorId
    && typeof data.processingDocumentTaskId === 'string' && data.processingDocumentTaskId.length > 0;
}

/** A new Arive file may not exist in BISU yet. An existing file must belong to this primary LO. */
export async function ownsOfficerSubmissionTarget(
  db: Pick<Prisma.TransactionClient, 'loan'>, actorId: string, target?: OfficerSubmissionTarget,
) {
  if (target?.loanOfficerId !== actorId || typeof target.arriveLoanNumber !== 'string') return false;
  const number = target.arriveLoanNumber.trim();
  if (!/^\d{1,15}$/.test(number)) return false;
  const otherOwner = await db.loan.findFirst({
    where: { loanNumber: number, loanOfficerId: { not: actorId } }, select: { id: true },
  });
  return !otherOwner;
}
