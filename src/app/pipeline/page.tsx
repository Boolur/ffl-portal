import React from 'react';
import { PipelineWorkspace } from '@/components/pipeline/PipelineWorkspace';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { getServerSession } from 'next-auth';
import { ProcessingPipelineSheet, UserRole } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { canAccessPipelinePortal } from '@/lib/pipelinePilot';
import { getPipelineReport } from '@/app/actions/pipelineReportingActions';
import { getProcessingPipeline } from '@/app/actions/processingPipelineActions';
import { getProcessingPipelineLayouts } from '@/app/actions/processingPipelineLayoutActions';
import { prisma } from '@/lib/prisma';
import { isAdmin } from '@/lib/adminTiers';

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
    role === UserRole.PROCESSOR_JR || role === UserRole.PROCESSOR_SR;
  const canUseSubmissionShortcuts =
    role === UserRole.LOAN_OFFICER ||
    role === UserRole.LOA ||
    role === UserRole.MANAGER ||
    isAdmin(role);
  const [initialProcessing, initialReport, initialLayouts, submissionConfig] = await Promise.all([
    getProcessingPipeline({
      sheet: ProcessingPipelineSheet.PIPELINE,
      sortBy: 'pipelineStatus',
      sortDirection: 'asc',
    }),
    isProcessingRole ? Promise.resolve(null) : getPipelineReport(),
    getProcessingPipelineLayouts(),
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
  if (!initialProcessing.success) redirect('/');
  const user = {
    name: session.user.name || 'User',
    role,
  };

  return (
    <DashboardShell user={user}>
      <PipelineWorkspace
        role={role}
        initialReport={initialReport}
        initialProcessing={initialProcessing}
        initialLayouts={initialLayouts.success ? initialLayouts.layouts : []}
        submissionConfig={submissionConfig}
      />
    </DashboardShell>
  );
}
