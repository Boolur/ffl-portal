import React from 'react';
import { PipelinePage } from '@/components/pipeline/PipelinePage';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export default async function Pipeline() {
  const session = await getServerSession(authOptions);
  const user = {
    name: session?.user?.name || 'User',
    role: session?.user?.role || 'LOAN_OFFICER',
  };

  return (
    <DashboardShell user={user}>
      <PipelinePage />
    </DashboardShell>
  );
}
