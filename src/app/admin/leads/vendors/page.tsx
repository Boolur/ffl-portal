import React from 'react';
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
        <h1 className="app-page-title">Lead Vendors</h1>
        <p className="app-page-subtitle">
          Configure lead vendor webhooks, field mappings, and routing.
        </p>
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
