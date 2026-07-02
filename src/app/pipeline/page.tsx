import React from 'react';
import { PipelinePage } from '@/components/pipeline/PipelinePage';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { canAccessPipelinePortal } from '@/lib/pipelinePilot';
import { getPipelineReport } from '@/app/actions/pipelineReportingActions';

export default async function Pipeline() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect('/login');
  const canAccess = canAccessPipelinePortal({
    role: session.user.activeRole || session.user.role,
    email: session.user.email,
    name: session.user.name,
  });
  if (!canAccess) redirect('/');

  const initialReport = await getPipelineReport();
  const user = {
    name: session.user.name || 'User',
    role: session.user.activeRole || session.user.role || 'LOAN_OFFICER',
  };

  return (
    <DashboardShell user={user}>
      <PipelinePage initialReport={initialReport} />
    </DashboardShell>
  );
}
