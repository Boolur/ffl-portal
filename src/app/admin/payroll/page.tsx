import { Banknote } from 'lucide-react';
import { getServerSession } from 'next-auth';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { PayrollAdminDashboard } from '@/components/admin/payroll/PayrollAdminDashboard';
import { getPayrollAdminDashboardData } from '@/app/actions/payrollActions';
import { authOptions } from '@/lib/auth';

export default async function AdminPayrollPage() {
  const session = await getServerSession(authOptions);
  const data = await getPayrollAdminDashboardData();
  const user = {
    name: session?.user?.name || 'Admin',
    role: session?.user?.activeRole || session?.user?.role || 'ADMIN',
  };

  return (
    <DashboardShell user={user}>
      <div className="app-page-header">
        <div className="mt-1 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 shadow-sm">
            <Banknote className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="app-page-title !mb-0">Payroll</h1>
            <p className="text-sm text-slate-500">Review compensation requests, configure splits, and track payroll payouts.</p>
          </div>
        </div>
      </div>
      <PayrollAdminDashboard {...data} />
    </DashboardShell>
  );
}
