import React from 'react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { LeadDashboard } from '@/components/admin/leads/LeadDashboard';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getLeadDashboardStats } from '@/app/actions/leadActions';

export default async function LeadDashboardPage() {
  const session = await getServerSession(authOptions);
  const stats = await getLeadDashboardStats();

  const user = {
    name: session?.user?.name || 'Admin',
    role: session?.user?.activeRole || session?.user?.role || 'ADMIN',
  };

  return (
    <DashboardShell user={user}>
      <div className="app-page-header">
        <h1 className="app-page-title">Lead Distribution</h1>
        <p className="app-page-subtitle">
          Overview of lead intake, vendor performance, and distribution status.
        </p>
      </div>
      <LeadDashboard
        stats={{
          ...stats,
          recentLeads: stats.recentLeads.map((l) => ({
            ...l,
            receivedAt: l.receivedAt.toISOString(),
          })),
        }}
      />
    </DashboardShell>
  );
}
