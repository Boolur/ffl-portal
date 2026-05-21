import { Banknote } from 'lucide-react';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { PayrollPortal } from '@/components/payroll/PayrollPortal';
import { getMyPayrollPortalData } from '@/app/actions/payrollActions';
import { authOptions } from '@/lib/auth';
import { canAccessPayrollPortal } from '@/lib/payrollPilot';

export default async function PayrollPage() {
  const session = await getServerSession(authOptions);
  const canAccess = canAccessPayrollPortal({
    role: session?.user?.activeRole || session?.user?.role,
    email: session?.user?.email,
    name: session?.user?.name,
  });
  if (!session?.user?.id) redirect('/login');
  if (!canAccess) redirect('/');

  const data = await getMyPayrollPortalData();
  const user = {
    name: session.user.name || 'User',
    role: session.user.activeRole || session.user.role || 'LOAN_OFFICER',
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
            <p className="text-sm text-slate-500">Submit funded loan compensation requests and track payroll review status.</p>
          </div>
        </div>
      </div>
      <PayrollPortal rows={data.rows} summary={data.summary} />
    </DashboardShell>
  );
}
