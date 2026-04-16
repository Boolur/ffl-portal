import React from 'react';
import Link from 'next/link';
import { UserCog } from 'lucide-react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { LeadUserManager } from '@/components/admin/leads/LeadUserManager';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getLeadUsers, getAllCampaignsForUserAdd } from '@/app/actions/leadActions';

export default async function LeadUsersPage() {
  const session = await getServerSession(authOptions);
  const [users, campaigns] = await Promise.all([
    getLeadUsers(),
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
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500 shadow-sm">
            <UserCog className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="app-page-title !mb-0">Lead Users</h1>
            <p className="text-sm text-slate-500">
              Manage user lead settings, licensed states, campaign memberships, and quotas.
            </p>
          </div>
        </div>
      </div>
      <LeadUserManager
        users={users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          leadsEnabled: u.leadQuota?.leadsEnabled ?? true,
          licensedStates: u.leadQuota?.licensedStates ?? [],
          globalDailyQuota: u.leadQuota?.globalDailyQuota ?? 0,
          globalWeeklyQuota: u.leadQuota?.globalWeeklyQuota ?? 0,
          globalMonthlyQuota: u.leadQuota?.globalMonthlyQuota ?? 0,
          leadsToday: u._count.leads,
          campaignCount: u.campaignMemberships.length,
          memberships: u.campaignMemberships.map((m) => ({
            id: m.id,
            campaignId: m.campaign.id,
            campaignName: m.campaign.name,
            vendorName: m.campaign.vendor.name,
            dailyQuota: m.dailyQuota,
            weeklyQuota: m.weeklyQuota,
            monthlyQuota: m.monthlyQuota,
            receiveDays: m.receiveDays,
            active: m.active,
            leadsReceivedToday: m.leadsReceivedToday,
          })),
        }))}
        allCampaigns={campaigns.map((c) => ({
          id: c.id,
          name: c.name,
          vendorName: c.vendor.name,
        }))}
      />
    </DashboardShell>
  );
}
