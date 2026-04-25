import React from 'react';
import Link from 'next/link';
import { Zap } from 'lucide-react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { IntegrationServiceManager } from '@/components/admin/leads/IntegrationServiceManager';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getIntegrationServices } from '@/app/actions/leadActions';

export default async function ServicesPage() {
  const session = await getServerSession(authOptions);
  const services = await getIntegrationServices();

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
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 shadow-sm">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="app-page-title !mb-0">Integration Services</h1>
            <p className="text-sm text-slate-500">
              Outbound push targets (like Bonzo). Enabled services appear in
              the Push to Service picker on the Leads screen.
            </p>
          </div>
        </div>
      </div>
      <IntegrationServiceManager services={services} />
    </DashboardShell>
  );
}
