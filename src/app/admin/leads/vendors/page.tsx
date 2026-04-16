import React from 'react';
import Link from 'next/link';
import { Globe } from 'lucide-react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { VendorManager } from '@/components/admin/leads/VendorManager';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getLeadVendors } from '@/app/actions/leadActions';

export default async function VendorsPage() {
  const session = await getServerSession(authOptions);
  const vendors = await getLeadVendors();

  const user = {
    name: session?.user?.name || 'Admin',
    role: session?.user?.activeRole || session?.user?.role || 'ADMIN',
  };

  return (
    <DashboardShell user={user}>
      <div className="app-page-header">
        <Link href="/admin/leads" className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors mb-1 inline-block">&larr; Back to Lead Distribution</Link>
        <div className="flex items-center gap-3 mt-1">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 shadow-sm">
            <Globe className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="app-page-title !mb-0">Lead Vendors</h1>
            <p className="text-sm text-slate-500">
              Configure lead vendor webhooks, field mappings, and routing.
            </p>
          </div>
        </div>
      </div>
      <VendorManager
        vendors={vendors.map((v) => ({
          ...v,
          fieldMapping: (v.fieldMapping as Record<string, string>) || {},
        }))}
      />
    </DashboardShell>
  );
}
