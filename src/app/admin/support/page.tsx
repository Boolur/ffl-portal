import React from 'react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { SupportInbox } from '@/components/support/SupportInbox';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export default async function SupportInboxPage() {
  const session = await getServerSession(authOptions);
  const user = {
    name: session?.user?.name || 'Support User',
    role: session?.user?.activeRole || session?.user?.role || 'MANAGER',
  };

  return (
    <DashboardShell user={user}>
      <div className="app-page-header">
        <h1 className="app-page-title">Support Inbox</h1>
        <p className="app-page-subtitle">
          Manage Scenario Desk, Pricing Desk, and Help Desk conversations from Loan Officers.
        </p>
      </div>
      <SupportInbox />
    </DashboardShell>
  );
}
