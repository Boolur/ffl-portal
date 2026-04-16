import React from 'react';
import Link from 'next/link';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { LeadPool } from '@/components/admin/leads/LeadPool';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getLeads, getLeadEligibleUsers } from '@/app/actions/leadActions';

export default async function PoolPage() {
  const session = await getServerSession(authOptions);
  const [{ leads }, users] = await Promise.all([
    getLeads({ status: 'UNASSIGNED' as never, take: 200 }),
    getLeadEligibleUsers(),
  ]);

  const user = {
    name: session?.user?.name || 'Admin',
    role: session?.user?.activeRole || session?.user?.role || 'ADMIN',
  };

  return (
    <DashboardShell user={user}>
      <div className="app-page-header">
        <Link href="/admin/leads" className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors mb-1 inline-block">&larr; Back to Lead Distribution</Link>
        <h1 className="app-page-title">Unassigned Lead Pool</h1>
        <p className="app-page-subtitle">
          Leads waiting for manual assignment. Select leads and assign to a loan officer.
        </p>
      </div>
      <LeadPool
        leads={leads.map((l) => ({
          ...l,
          receivedAt: l.receivedAt.toISOString(),
        }))}
        users={users.map((u) => ({ id: u.id, name: u.name }))}
      />
    </DashboardShell>
  );
}
