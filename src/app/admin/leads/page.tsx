import React from 'react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { LeadDashboard } from '@/components/admin/leads/LeadDashboard';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  getLeadDashboardStats,
  getSavedCsvMappings,
  getLeadEligibleUsers,
} from '@/app/actions/leadActions';

export default async function LeadDashboardPage() {
  const session = await getServerSession(authOptions);
  const [stats, csvMappings, eligibleUsers] = await Promise.all([
    getLeadDashboardStats(),
    getSavedCsvMappings(),
    getLeadEligibleUsers(),
  ]);

  const user = {
    name: session?.user?.name || 'Admin',
    role: session?.user?.activeRole || session?.user?.role || 'ADMIN',
  };

  return (
    <DashboardShell user={user}>
      <div className="app-page-header">
        <h1 className="app-page-title">Lead Distribution</h1>
        <p className="app-page-subtitle">
          Manage your lead pipeline, vendor sources, campaign rules, and team
          assignments.
        </p>
      </div>
      <LeadDashboard
        stats={{
          ...stats,
          recentLeads: stats.recentLeads.map((l) => ({
            ...l,
            receivedAt: l.receivedAt.toISOString(),
          })),
        }}
        csvMappings={csvMappings.map((m) => ({
          csvHeader: m.csvHeader,
          ourField: m.ourField,
          usageCount: m.usageCount,
        }))}
        eligibleUsers={eligibleUsers.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
        }))}
      />
    </DashboardShell>
  );
}
