import React from 'react';
import Link from 'next/link';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { CampaignManager } from '@/components/admin/leads/CampaignManager';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getLeadCampaigns, getLeadVendors, getLeadEligibleUsers } from '@/app/actions/leadActions';

export default async function CampaignsPage() {
  const session = await getServerSession(authOptions);
  const [campaigns, vendors, users] = await Promise.all([
    getLeadCampaigns(),
    getLeadVendors(),
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
        <h1 className="app-page-title">Lead Campaigns</h1>
        <p className="app-page-subtitle">
          Configure campaigns, assign loan officers, and manage distribution rules.
        </p>
      </div>
      <CampaignManager
        campaigns={campaigns.map((c) => ({
          ...c,
        }))}
        vendors={vendors.map((v) => ({ id: v.id, name: v.name, slug: v.slug }))}
        users={users}
      />
    </DashboardShell>
  );
}
