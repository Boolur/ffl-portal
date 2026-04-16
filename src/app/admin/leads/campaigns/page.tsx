import React from 'react';
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
        <h1 className="app-page-title">Lead Campaigns</h1>
        <p className="app-page-subtitle">
          Configure campaigns, assign loan officers, and manage distribution rules.
        </p>
      </div>
      <CampaignManager
        campaigns={campaigns.map((c) => ({
          ...c,
          price: c.price != null ? String(c.price) : null,
        }))}
        vendors={vendors.map((v) => ({ id: v.id, name: v.name, slug: v.slug }))}
        users={users}
      />
    </DashboardShell>
  );
}
