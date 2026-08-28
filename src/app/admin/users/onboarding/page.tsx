import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { DashboardShell } from '@/components/layout/DashboardShell';
import {
  getOnboardingManagementContext,
  listOnboardingCases,
} from '@/app/actions/onboardingActions';
import { OnboardingManagement } from '@/components/admin/users/OnboardingManagement';
import { UserManagementNav } from '@/components/admin/users/UserManagementNav';
import { isOnboardingEnabled } from '@/lib/onboardingFeature';

export default async function OnboardingManagementPage() {
  if (!isOnboardingEnabled()) redirect('/admin/users');
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect('/login');
  const [context, cases] = await Promise.all([
    getOnboardingManagementContext(),
    listOnboardingCases(),
  ]);
  if (!context.authorized) redirect('/');

  return (
    <DashboardShell
      user={{
        name: session.user.name || 'User',
        role: session.user.activeRole || session.user.role || 'MANAGER',
      }}
    >
      <div className="app-page-header">
        <h1 className="app-page-title">Employee Onboarding</h1>
        <p className="app-page-subtitle">
          Invite new hires, coordinate internal setup, and approve portal access.
        </p>
      </div>
      <UserManagementNav />
      <OnboardingManagement
        cases={cases.map((item) => ({
          ...item,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
          startDate: item.profile?.startDate?.toISOString().slice(0, 10) || null,
          jobTitle: item.profile?.jobTitle || null,
          department: item.profile?.department || null,
        }))}
        assignableRoles={context.assignableRoles}
        managers={context.managers}
      />
    </DashboardShell>
  );
}
