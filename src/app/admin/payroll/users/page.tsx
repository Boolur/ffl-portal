import Link from 'next/link';
import { UserCog } from 'lucide-react';
import { getServerSession } from 'next-auth';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { PayrollUserSettings } from '@/components/admin/payroll/PayrollUserSettings';
import {
  getPayrollEligibleUsers,
  getPayrollUsersWithPlans,
} from '@/app/actions/payrollActions';
import { getLeadUserTeams } from '@/app/actions/leadActions';
import { authOptions } from '@/lib/auth';

export default async function PayrollUsersPage() {
  const session = await getServerSession(authOptions);
  const [users, eligibleUsers, teams] = await Promise.all([
    getPayrollUsersWithPlans(),
    getPayrollEligibleUsers(),
    getLeadUserTeams(),
  ]);
  const user = {
    name: session?.user?.name || 'Admin',
    role: session?.user?.activeRole || session?.user?.role || 'ADMIN',
  };

  return (
    <DashboardShell user={user}>
      <div className="app-page-header">
        <Link href="/admin/payroll" className="mb-1 inline-block text-sm font-medium text-blue-600 transition-colors hover:text-blue-700">
          &larr; Back to Payroll
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500 shadow-sm">
            <UserCog className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="app-page-title !mb-0">Payroll Users</h1>
            <p className="text-sm text-slate-500">Set loan officer compensation percentages and downstream split recipients.</p>
          </div>
        </div>
      </div>
      <PayrollUserSettings users={users} eligibleUsers={eligibleUsers} teams={teams} />
    </DashboardShell>
  );
}
