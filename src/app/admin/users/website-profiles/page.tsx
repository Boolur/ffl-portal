import { getServerSession } from 'next-auth';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { authOptions } from '@/lib/auth';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { WebsiteLoanOfficerProfiles } from '@/components/admin/WebsiteLoanOfficerProfiles';
import { listWebsiteLoanOfficerProfiles } from '@/app/actions/websiteLoanOfficerProfileActions';
import { UserManagementNav } from '@/components/admin/users/UserManagementNav';
import { UserRole } from '@prisma/client';
import { highestAdminTier } from '@/lib/adminTiers';

export default async function WebsiteLoanOfficerProfilesPage() {
  const session = await getServerSession(authOptions);
  const profiles = await listWebsiteLoanOfficerProfiles();

  const user = {
    name: session?.user?.name || 'Admin User',
    role: session?.user?.activeRole || session?.user?.role || 'ADMIN_III',
  };

  return (
    <DashboardShell user={user}>
      <div className="app-page-header">
        <Link href="/admin/users" className="app-btn-secondary mb-4 w-fit">
          <ArrowLeft className="h-4 w-4" />
          User management
        </Link>
        <h1 className="app-page-title">Website Loan Officer Profiles</h1>
        <p className="app-page-subtitle">
          Complete and publish the profiles shown on the BISU Home Loans website.
        </p>
      </div>
      <UserManagementNav
        showSignInActivity={
          highestAdminTier(
            (session?.user?.roles as UserRole[] | undefined) ??
              (session?.user?.role ? [session.user.role as UserRole] : []),
          ) === 3
        }
      />
      <WebsiteLoanOfficerProfiles
        profiles={profiles.map((profile) => ({
          ...profile,
          websiteLoanOfficerProfile: profile.websiteLoanOfficerProfile
            ? {
                ...profile.websiteLoanOfficerProfile,
                publishedAt:
                  profile.websiteLoanOfficerProfile.publishedAt?.toISOString() ?? null,
              }
            : null,
        }))}
      />
    </DashboardShell>
  );
}
