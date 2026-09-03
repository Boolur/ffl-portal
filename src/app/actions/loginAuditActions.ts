'use server';

import { Prisma, UserRole } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { highestAdminTier } from '@/lib/adminTiers';
import { prisma } from '@/lib/prisma';
import type { LoginAuditOutcome } from '@/lib/loginAudit';

export type LoginAuditListItem = {
  id: string;
  email: string;
  userName: string | null;
  outcome: LoginAuditOutcome;
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
};

async function assertSecurityAuditAdmin(): Promise<void> {
  const session = await getServerSession(authOptions);
  const fallbackRole = session?.user?.role as UserRole | undefined;
  const roles =
    (session?.user?.roles as UserRole[] | undefined) ??
    (fallbackRole ? [fallbackRole] : []);

  if (!session?.user?.id || highestAdminTier(roles) !== 3) {
    throw new Error('Unauthorized');
  }
}

export async function listLoginAuditEvents(params?: {
  query?: string;
  outcome?: LoginAuditOutcome | 'ALL';
  days?: number | null;
  page?: number;
  pageSize?: number;
}): Promise<{
  items: LoginAuditListItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  await assertSecurityAuditAdmin();

  const query = params?.query?.trim().slice(0, 320) ?? '';
  const outcome = params?.outcome ?? 'ALL';
  const pageSize = Math.min(Math.max(params?.pageSize ?? 50, 1), 100);
  const page = Math.max(params?.page ?? 1, 1);
  const days =
    params?.days === null
      ? null
      : Math.min(Math.max(params?.days ?? 30, 1), 365);
  const createdAt = days
    ? { gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) }
    : undefined;

  const where: Prisma.LoginAuditWhereInput = {
    ...(outcome === 'ALL' ? {} : { outcome }),
    ...(createdAt ? { createdAt } : {}),
    ...(query
      ? {
          OR: [
            { email: { contains: query, mode: 'insensitive' } },
            { ipAddress: { contains: query, mode: 'insensitive' } },
            { user: { name: { contains: query, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.loginAudit.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        email: true,
        outcome: true,
        reason: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        user: { select: { name: true } },
      },
    }),
    prisma.loginAudit.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      email: row.email,
      userName: row.user?.name ?? null,
      outcome: row.outcome === 'SUCCESS' ? 'SUCCESS' : 'FAILURE',
      reason: row.reason,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      createdAt: row.createdAt.toISOString(),
    })),
    total,
    page,
    pageSize,
  };
}
