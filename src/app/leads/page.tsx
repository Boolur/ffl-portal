import React from 'react';
import { Database } from 'lucide-react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { LeadsCRM } from '@/components/admin/leads/LeadsCRM';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  getLeads,
  getLeadVendors,
  getLeadCampaigns,
  getDistinctLeadSources,
  getLeadCrmStats,
  getAllowedIntegrationServicesForUser,
} from '@/app/actions/leadActions';
import { canAccessLeadsTab } from '@/lib/leadsPilot';
import { redirect } from 'next/navigation';

/**
 * LO-facing Leads page. Mounts the same `LeadsCRM` the admin uses on
 * `/admin/leads/all`, but in `mode="lo"` so the admin-only surfaces
 * (CSV upload, unassigned pool, assign controls, bulk delete, assignee
 * column/filter) are hidden. Every data load is scoped to the signed-in
 * user so stats, vendor/campaign breakdowns, and the table itself only
 * show leads they own.
 */
export default async function MyLeadsPage() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  const canAccess = canAccessLeadsTab({
    role: session?.user?.activeRole || session?.user?.role,
    email: session?.user?.email,
  });
  if (!canAccess) redirect('/');
  if (!userId) redirect('/login');

  const [
    { leads, total },
    vendors,
    campaigns,
    sources,
    crmStats,
    services,
  ] = await Promise.all([
    getLeads({ assignedUserId: userId, take: 200, skip: 0 }),
    // Vendor/campaign pickers are just labels used to populate the
    // filter dropdowns; showing every active vendor/campaign is fine
    // because the results list is still server-filtered to the LO's
    // own leads via `assignedUserId`.
    getLeadVendors(true),
    getLeadCampaigns(),
    getDistinctLeadSources({ assignedUserId: userId }),
    getLeadCrmStats({ assignedUserId: userId }),
    getAllowedIntegrationServicesForUser(userId),
  ]);

  const user = {
    name: session?.user?.name || 'User',
    role: session?.user?.activeRole || session?.user?.role || 'LOAN_OFFICER',
  };

  return (
    <DashboardShell user={user}>
      <div className="app-page-header">
        <div className="flex items-center gap-3 mt-1">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 shadow-sm">
            <Database className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="app-page-title !mb-0">My Leads</h1>
            <p className="text-sm text-slate-500">
              Browse, filter, and work the leads assigned to you.
            </p>
          </div>
        </div>
      </div>
      <LeadsCRM
        mode="lo"
        initialLeads={leads.map((l) => ({
          ...l,
          receivedAt: l.receivedAt.toISOString(),
        }))}
        initialTotal={total}
        vendors={vendors.map((v) => ({ id: v.id, name: v.name }))}
        campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
        // Assigned-to filter is hidden in LO mode, so an empty users
        // list is fine here (and saves a pointless DB round-trip).
        users={[]}
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
