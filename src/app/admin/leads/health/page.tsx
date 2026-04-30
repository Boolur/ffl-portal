import React from 'react';
import Link from 'next/link';
import { Activity } from 'lucide-react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { LeadHealthPanel } from '@/components/admin/leads/LeadHealthPanel';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export default async function LeadHealthPage() {
  const session = await getServerSession(authOptions);

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
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500 shadow-sm">
            <Activity className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="app-page-title !mb-0">Lead Distribution Health</h1>
            <p className="text-sm text-slate-500">
              Webhook inbox status, mapping audit, and one-click address
              backfill — everything you need to diagnose and fix lead-flow
              issues from a single page.
            </p>
          </div>
        </div>
      </div>
      <LeadHealthPanel />
    </DashboardShell>
  );
}
