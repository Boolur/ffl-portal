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
  const [initialProcessing, initialReport] = await Promise.all([
    getProcessingPipeline({
      sheet: ProcessingPipelineSheet.PIPELINE,
      page: 1,
      pageSize: 50,
    }),
    isProcessingRole ? Promise.resolve(null) : getPipelineReport(),
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
      />
    </DashboardShell>
  );
}
