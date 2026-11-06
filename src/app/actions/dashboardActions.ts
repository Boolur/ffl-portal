'use server';

import { getServerSession } from 'next-auth';
import { UserRole } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { getDashboardSummary, getRecentDashboardRequests } from '@/lib/dashboardQueries';
import type { DashboardRequestCursor } from '@/lib/dashboardSummary';

export async function loadRecentDashboardRequests(cursor: DashboardRequestCursor) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return { success: false as const, error: 'Please sign in again.' };
  const role = (session.user.activeRole || session.user.role) as UserRole;
  if (role !== UserRole.LOAN_OFFICER && role !== UserRole.LOA) return { success: false as const, error: 'Not authorized.' };
  try {
    const page = await getRecentDashboardRequests({ id: session.user.id, role, name: session.user.name || 'User' }, cursor);
    return { success: true as const, page };
  } catch {
    return { success: false as const, error: 'Unable to load more requests. Please try again.' };
  }
}

export async function loadDashboardSnapshot() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new Error('Please sign in again.');
  const role = (session.user.activeRole || session.user.role) as UserRole;
  if (!Object.values(UserRole).includes(role) || role === UserRole.ONBOARDING) throw new Error('Not authorized.');
  const actor = { id: session.user.id, role, name: session.user.name || 'User' };
  const [summary, recentRequests] = await Promise.all([getDashboardSummary(actor), getRecentDashboardRequests(actor)]);
  return { summary, recentRequests, userId: actor.id, role };
}
