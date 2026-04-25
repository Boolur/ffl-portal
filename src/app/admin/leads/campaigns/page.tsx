import React from 'react';
import Link from 'next/link';
import { Megaphone } from 'lucide-react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { CampaignsPageClient } from '@/components/admin/leads/CampaignsPageClient';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  getLeadCampaigns,
  getLeadVendors,
  getLeadEligibleUsers,
  getLeadCampaignGroups,
  getCampaignNextUpRoster,
  getLeadUserTeams,
} from '@/app/actions/leadActions';

export default async function CampaignsPage() {
  const session = await getServerSession(authOptions);
  const [campaigns, vendors, users, groups, nextUpRoster, teams] =
    await Promise.all([
      getLeadCampaigns(),
      getLeadVendors(),
      getLeadEligibleUsers(),
      getLeadCampaignGroups(),
      getCampaignNextUpRoster(),
      getLeadUserTeams(),
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
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 shadow-sm">
            <Megaphone className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="app-page-title !mb-0">Lead Campaigns</h1>
            <p className="text-sm text-slate-500">
              Configure campaigns, assign loan officers, and manage distribution rules.
            </p>
          </div>
        </div>
      </div>
      <CampaignsPageClient
        campaigns={campaigns.map((c) => ({ ...c }))}
        vendors={vendors.map((v) => ({ id: v.id, name: v.name, slug: v.slug }))}
        users={users}
        groups={groups}
        nextUpRoster={nextUpRoster}
        teams={teams}
      />
    </DashboardShell>
  );
}
