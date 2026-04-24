import React from 'react';
import Link from 'next/link';
import { Inbox } from 'lucide-react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { LeadPool } from '@/components/admin/leads/LeadPool';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  getLeads,
  getLeadEligibleUsers,
  getAllCampaignsForUserAdd,
} from '@/app/actions/leadActions';

export default async function PoolPage() {
  const session = await getServerSession(authOptions);
  const [{ leads }, users, campaigns] = await Promise.all([
    getLeads({ status: 'UNASSIGNED' as never, take: 200 }),
    getLeadEligibleUsers(),
    getAllCampaignsForUserAdd(),
  ]);

  const user = {
    name: session?.user?.name || 'Admin',
    role: session?.user?.activeRole || session?.user?.role || 'ADMIN',
  };

  return (
    <DashboardShell user={user}>
      <div className="app-page-header">
        <Link href="/admin/leads" className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors mb-1 inline-block">&larr; Back to Lead Distribution</Link>
        <div className="flex items-center gap-3 mt-1">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500 shadow-sm">
            <Inbox className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="app-page-title !mb-0">Unassigned Lead Pool</h1>
            <p className="text-sm text-slate-500">
              Leads waiting for manual assignment. Select leads and assign to a loan officer.
            </p>
          </div>
        </div>
      </div>
      <LeadPool
        leads={leads.map((l) => ({
          ...l,
          receivedAt: l.receivedAt.toISOString(),
        }))}
        users={users.map((u) => ({ id: u.id, name: u.name }))}
        campaigns={campaigns.map((c) => ({
          id: c.id,
          name: c.name,
          vendorName: c.vendor.name,
        }))}
      />
    </DashboardShell>
  );
}
