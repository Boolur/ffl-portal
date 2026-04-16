import React from 'react';
import Link from 'next/link';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { LeadsCRM } from '@/components/admin/leads/LeadsCRM';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  getLeads,
  getLeadVendors,
  getLeadCampaigns,
  getLeadEligibleUsers,
  getDistinctLeadSources,
} from '@/app/actions/leadActions';

export default async function AllLeadsPage() {
  const session = await getServerSession(authOptions);

  const [{ leads, total }, vendors, campaigns, eligibleUsers, sources] =
    await Promise.all([
      getLeads({ take: 200, skip: 0 }),
      getLeadVendors(),
      getLeadCampaigns(),
      getLeadEligibleUsers(),
      getDistinctLeadSources(),
    ]);

  const user = {
    name: session?.user?.name || 'Admin',
    role: session?.user?.activeRole || session?.user?.role || 'ADMIN',
  };

  return (
    <DashboardShell user={user}>
      <div className="app-page-header">
        <Link
          href="/admin/leads"
          className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors mb-1 inline-block"
        >
          &larr; Back to Lead Distribution
        </Link>
        <h1 className="app-page-title">All Leads</h1>
        <p className="app-page-subtitle">
          Browse, filter, and manage your entire lead database. Click a lead to
          view details.
        </p>
      </div>
      <LeadsCRM
        initialLeads={leads.map((l) => ({
          ...l,
          receivedAt: l.receivedAt.toISOString(),
        }))}
        initialTotal={total}
        vendors={vendors.map((v) => ({ id: v.id, name: v.name }))}
        campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
        users={eligibleUsers.map((u) => ({ id: u.id, name: u.name }))}
        sources={sources}
      />
    </DashboardShell>
  );
}
