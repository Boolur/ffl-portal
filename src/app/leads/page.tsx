import React from 'react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { LeadTable } from '@/components/leads/LeadTable';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getLeads } from '@/app/actions/leadActions';
import { canAccessLeadsTab } from '@/lib/leadsPilot';
import { redirect } from 'next/navigation';

export default async function MyLeadsPage() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  const canAccess = canAccessLeadsTab({
    role: session?.user?.activeRole || session?.user?.role,
    email: session?.user?.email,
  });
  if (!canAccess) redirect('/');

  const { leads } = userId
    ? await getLeads({ assignedUserId: userId, take: 200 })
    : { leads: [] };

  const user = {
    name: session?.user?.name || 'User',
    role: session?.user?.activeRole || session?.user?.role || 'LOAN_OFFICER',
  };

  return (
    <DashboardShell user={user}>
      <div className="app-page-header">
        <h1 className="app-page-title">My Leads</h1>
        <p className="app-page-subtitle">
          View and manage leads assigned to you. Click a lead for full details.
        </p>
      </div>
      <LeadTable
        leads={leads.map((l) => ({
          ...l,
          receivedAt: l.receivedAt.toISOString(),
        }))}
      />
    </DashboardShell>
  );
}
