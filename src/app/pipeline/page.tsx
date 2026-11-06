import React from 'react';
import Link from 'next/link';
import { PipelineWorkspace } from '@/components/pipeline/PipelineWorkspace';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { getServerSession } from 'next-auth';
import { UserRole } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { canAccessPipelinePortal } from '@/lib/pipelinePilot';
import { getPipelineReport } from '@/app/actions/pipelineReportingActions';
import { getProcessingPipelineWorkspace } from '@/app/actions/pipelineWorkspaceActions';
import { prisma } from '@/lib/prisma';
import { isAdmin, isAdminIII } from '@/lib/adminTiers';

export const dynamic = 'force-dynamic';

export default async function Pipeline() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect('/login');
  const canAccess = canAccessPipelinePortal({
    role: session.user.activeRole || session.user.role,
  });
  if (!canAccess) redirect('/');

  const role = (session.user.activeRole || session.user.role) as UserRole;
  const isProcessingRole =
    role === UserRole.PROCESSOR_JR ||
    role === UserRole.PROCESSOR_SR ||
    role === UserRole.PROCESSING_MANAGER;
  const canUseSubmissionShortcuts =
    role === UserRole.LOAN_OFFICER ||
    role === UserRole.LOA ||
    role === UserRole.MANAGER ||
    isAdmin(role);
  const [initialWorkspace, initialReport, submissionConfig] = await Promise.all([
    isProcessingRole ? getProcessingPipelineWorkspace() : Promise.resolve(null),
    isProcessingRole ? Promise.resolve(null) : getPipelineReport(),
    canUseSubmissionShortcuts
      ? Promise.all([
          prisma.user.findUnique({
            where: { id: session.user.id },
            select: {
              loDisclosureSubmissionEnabled: true,
              loQcSubmissionEnabled: true,
            },
          }),
          prisma.user.findMany({
            where: {
              active: true,
              OR: [
                { role: UserRole.LOAN_OFFICER },
                { roles: { has: UserRole.LOAN_OFFICER } },
              ],
            },
            orderBy: { name: 'asc' },
            select: { id: true, name: true },
          }),
        ]).then(([actor, loanOfficerOptions]) => ({
          disclosureEnabled:
            role === UserRole.LOAN_OFFICER
              ? actor?.loDisclosureSubmissionEnabled ?? false
              : true,
          qcEnabled:
            role === UserRole.LOAN_OFFICER
              ? actor?.loQcSubmissionEnabled ?? false
              : true,
          loanOfficerOptions,
        }))
      : Promise.resolve(null),
  ]);
  if (initialWorkspace && !initialWorkspace.success) redirect('/');
  const user = {
    name: session.user.name || 'User',
    role,
  };

  return (
    <DashboardShell user={user}>
      {isAdminIII(role) && (
        <div className="mb-4"><Link className="app-btn-secondary" href="/admin/arive">Arive integration settings</Link></div>
      )}
      <PipelineWorkspace
        cacheScope={JSON.stringify([session.user.id, role, [...(session.user.roles || [role])].sort()])}
        role={role}
        initialReport={initialReport}
        initialWorkspace={initialWorkspace?.success ? initialWorkspace : null}
        submissionConfig={submissionConfig}
      />
    </DashboardShell>
  );
}
