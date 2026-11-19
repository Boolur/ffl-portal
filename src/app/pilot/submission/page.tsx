import { redirect } from 'next/navigation';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { LeadershipSubmissionDesk } from '@/components/tasks/LeadershipSubmissionDesk';
import { requireLeadershipPilot } from '@/lib/leadershipTestSubmission';
import { leadershipOfficerScope, leadershipRequestScope } from '@/lib/pilotLeadership';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export default async function PilotSubmissionPage() {
  const actor = await requireLeadershipPilot().catch(() => null);
  if (!actor) redirect('/tasks');
  const [officers, tasks] = await Promise.all([
    prisma.user.findMany({ where: leadershipOfficerScope(actor),
      select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.task.findMany({
      where: { submissionData: { path: ['leadershipPilotTest'], equals: true }, OR: [
        { kind: 'SUBMIT_PROCESSING', ...leadershipRequestScope(actor) },
        { kind: 'LO_NEEDS_INFO', parentTask: { is: { kind: 'SUBMIT_PROCESSING', ...leadershipRequestScope(actor) } } },
      ] },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: 100,
      include: { loan: { select: { loanNumber: true, borrowerName: true, loanOfficer: { select: { name: true } } } },
        assignedUser: { select: { id: true, name: true } }, parentTask: { select: { kind: true, title: true, assignedRole: true, submissionData: true } } },
    }),
  ]);
  return <DashboardShell user={{ name: actor.name, role: actor.role }}>
    <LeadershipSubmissionDesk officers={officers} tasks={tasks} role={actor.role} userId={actor.id} />
  </DashboardShell>;
}
