import React from 'react';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { LeaderboardPage } from '@/components/leaderboard/LeaderboardPage';
import { getLeaderboardReport } from '@/app/actions/leaderboardActions';
import { authOptions } from '@/lib/auth';
import { canAccessLeaderboardPortal } from '@/lib/leaderboardAccess';

export default async function LeaderboardRoute() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect('/login');

  const role = session.user.activeRole || session.user.role;
  if (
    !canAccessLeaderboardPortal({
      role,
      email: session.user.email,
      name: session.user.name,
    })
  ) {
    redirect('/');
  }

  const initialReport = await getLeaderboardReport();
  const user = {
    name: session.user.name || 'User',
    role: role || 'LOAN_OFFICER',
  };

  return (
    <DashboardShell user={user}>
      <LeaderboardPage initialReport={initialReport} />
    </DashboardShell>
  );
}
