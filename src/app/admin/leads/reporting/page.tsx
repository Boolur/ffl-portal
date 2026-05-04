import React from 'react';
import Link from 'next/link';
import { BarChart3 } from 'lucide-react';
import { getServerSession } from 'next-auth';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { LeadReportingPanel } from '@/components/admin/leads/LeadReportingPanel';
import {
  getLeadReportingFilterOptions,
  getLeadSpendReport,
} from '@/app/actions/leadReportingActions';
import { authOptions } from '@/lib/auth';

function defaultRange() {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

export default async function LeadReportingPage() {
  const session = await getServerSession(authOptions);
  const { start, end } = defaultRange();

  const [options, initialReport] = await Promise.all([
    getLeadReportingFilterOptions(),
    getLeadSpendReport({
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      billingFocus: 'company_paid',
      includeUnassigned: true,
      includeMissingPrice: true,
    }),
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
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 shadow-sm">
            <BarChart3 className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="app-page-title !mb-0">Lead Spend Reporting</h1>
            <p className="text-sm text-slate-500">
              Premium spend analytics for billing loan officers by vendor,
              campaign, and date range.
            </p>
          </div>
        </div>
      </div>

      <LeadReportingPanel options={options} initialReport={initialReport} />
    </DashboardShell>
  );
}
