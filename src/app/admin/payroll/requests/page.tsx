import Link from 'next/link';
import { ClipboardCheck } from 'lucide-react';
import { getServerSession } from 'next-auth';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { PayrollRequestsPage } from '@/components/admin/payroll/PayrollRequestsPage';
import { getPayrollRequests } from '@/app/actions/payrollActions';
import { authOptions } from '@/lib/auth';

export default async function PayrollRequestsRoute() {
  const session = await getServerSession(authOptions);
  const rows = await getPayrollRequests();
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
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 shadow-sm">
            <ClipboardCheck className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="app-page-title !mb-0">Payroll Requests</h1>
            <p className="text-sm text-slate-500">Review submitted compensation requests and move them through payroll.</p>
          </div>
        </div>
      </div>
      <PayrollRequestsPage rows={rows} />
    </DashboardShell>
  );
}
