import React from 'react';
import Link from 'next/link';
import { Database } from 'lucide-react';
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
  getLeadCrmStats,
  getIntegrationServices,
} from '@/app/actions/leadActions';

export default async function AllLeadsPage() {
  const session = await getServerSession(authOptions);

  const [
    { leads, total },
    vendors,
    campaigns,
    eligibleUsers,
    sources,
    crmStats,
    services,
  ] = await Promise.all([
    getLeads({ take: 200, skip: 0 }),
    getLeadVendors(true),
    getLeadCampaigns(),
    getLeadEligibleUsers(),
    getDistinctLeadSources(),
    getLeadCrmStats(),
    getIntegrationServices({ activeOnly: true }),
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
        <div className="flex items-center gap-3 mt-1">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 shadow-sm">
            <Database className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="app-page-title !mb-0">All Leads</h1>
            <p className="text-sm text-slate-500">
              Browse, filter, and manage your entire lead database.
            </p>
          </div>
        </div>
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
        stats={crmStats}
        services={services.map((s) => ({
          id: s.id,
          slug: s.slug,
          name: s.name,
          description: s.description,
          type: s.type,
        }))}
      />
    </DashboardShell>
  );
}
