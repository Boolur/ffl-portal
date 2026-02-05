import React from 'react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { prisma } from '@/lib/prisma';
import { LeadMailboxMappingManager } from '@/components/admin/LeadMailboxMappingManager';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

async function getMappings() {
  return prisma.externalUser.findMany({
    where: { provider: 'LEAD_MAILBOX' },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

async function getUsers() {
  return prisma.user.findMany({
    where: { active: true },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: 'asc' },
  });
}

export default async function LeadMailboxAdminPage() {
  const session = await getServerSession(authOptions);
  const [mappings, users] = await Promise.all([getMappings(), getUsers()]);

  const user = {
    name: session?.user?.name || 'Admin User',
    role: session?.user?.role || 'ADMIN',
  };

  return (
    <DashboardShell user={user}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Lead Mailbox Mappings</h1>
        <p className="text-sm text-slate-500">
          Manage external user IDs for Lead Mailbox webhooks.
        </p>
      </div>
      <LeadMailboxMappingManager users={users} mappings={mappings} />
    </DashboardShell>
  );
}
