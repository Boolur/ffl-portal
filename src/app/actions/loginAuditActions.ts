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
  city: string | null;
  region: string | null;
  country: string | null;
  createdAt: string;
};

export type LoginLocationGroup = {
  key: string;
  email: string;
  userName: string | null;
  ipAddress: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  loginCount: number;
  lastLoginAt: string;
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
        city: true,
        region: true,
        country: true,
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
      city: row.city,
      region: row.region,
      country: row.country,
      createdAt: row.createdAt.toISOString(),
    })),
    total,
    page,
    pageSize,
  };
}

export async function listLoginLocationGroups(params?: {
  query?: string;
  days?: number | null;
}): Promise<LoginLocationGroup[]> {
  await assertSecurityAuditAdmin();

  const query = params?.query?.trim().slice(0, 320) ?? '';
  const days =
    params?.days === null
      ? null
      : Math.min(Math.max(params?.days ?? 30, 1), 365);
  const createdAt = days
    ? { gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) }
    : undefined;
  const where: Prisma.LoginAuditWhereInput = {
    outcome: 'SUCCESS',
    ...(createdAt ? { createdAt } : {}),
    ...(query
      ? {
          OR: [
            { email: { contains: query, mode: 'insensitive' } },
            { ipAddress: { contains: query, mode: 'insensitive' } },
            { city: { contains: query, mode: 'insensitive' } },
            { region: { contains: query, mode: 'insensitive' } },
            { country: { contains: query, mode: 'insensitive' } },
            { user: { name: { contains: query, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const groups = await prisma.loginAudit.groupBy({
    by: ['userId', 'email', 'ipAddress', 'city', 'region', 'country'],
    where,
    _count: { _all: true },
    _max: { createdAt: true },
    orderBy: { _max: { createdAt: 'desc' } },
    take: 500,
  });
  const userIds = Array.from(
    new Set(
      groups
        .map((group) => group.userId)
        .filter((userId): userId is string => Boolean(userId)),
    ),
  );
  const users =
    userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true },
        })
      : [];
  const namesById = new Map(users.map((user) => [user.id, user.name]));

  return groups.flatMap((group) => {
    if (!group._max.createdAt) return [];
    return [
      {
        key: [
          group.userId ?? group.email,
          group.ipAddress ?? 'unknown',
          group.city ?? '',
          group.region ?? '',
          group.country ?? '',
        ].join('|'),
        email: group.email,
        userName: group.userId ? namesById.get(group.userId) ?? null : null,
        ipAddress: group.ipAddress,
        city: group.city,
        region: group.region,
        country: group.country,
        loginCount: group._count._all,
        lastLoginAt: group._max.createdAt.toISOString(),
      },
    ];
  });
}
