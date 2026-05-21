import Link from 'next/link';
import { Banknote, CheckCircle2, Clock, DollarSign, Users } from 'lucide-react';
import type { getPayrollAdminDashboardData } from '@/app/actions/payrollActions';
import { formatCurrency } from './payrollFormat';
import { PayrollRequestTable } from './PayrollRequestTable';

type Props = Awaited<ReturnType<typeof getPayrollAdminDashboardData>>;

function KpiCard({
  title,
  value,
  subtitle,
  Icon,
}: {
  title: string;
  value: string;
  subtitle: string;
  Icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">{title}</p>
          <p className="mt-2 text-2xl font-bold text-slate-950">{value}</p>
          <p className="mt-1 text-sm text-emerald-700/80">{subtitle}</p>
        </div>
        <div className="rounded-xl bg-white p-2.5 text-emerald-600 shadow-sm ring-1 ring-emerald-100">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

export function PayrollAdminDashboard({ summary, pendingRequests, recentRequests }: Props) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Pending Review" value={String(summary.pendingCount)} subtitle={formatCurrency(summary.pendingRevenue)} Icon={Clock} />
        <KpiCard title="Approved" value={String(summary.approvedCount)} subtitle={formatCurrency(summary.approvedRevenue)} Icon={CheckCircle2} />
        <KpiCard title="Paid" value={String(summary.paidCount)} subtitle={formatCurrency(summary.paidRevenue)} Icon={DollarSign} />
        <KpiCard title="Submitted Revenue" value={formatCurrency(summary.submittedRevenue)} subtitle={`${summary.totalRequests} total requests`} Icon={Banknote} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Link href="/admin/payroll/users" className="group rounded-2xl border border-orange-200 bg-white p-5 shadow-sm transition hover:border-orange-300 hover:shadow-md">
          <Users className="h-8 w-8 rounded-xl bg-orange-500 p-1.5 text-white" />
          <h2 className="mt-4 text-base font-bold text-slate-900">User Split Settings</h2>
          <p className="mt-1 text-sm text-slate-500">Configure LO compensation splits and recipients.</p>
          <span className="mt-4 inline-flex rounded-xl bg-orange-50 px-3 py-2 text-sm font-semibold text-orange-700 group-hover:bg-orange-500 group-hover:text-white">Manage Users</span>
        </Link>
        <Link href="/admin/payroll/requests" className="group rounded-2xl border border-blue-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow-md">
          <Clock className="h-8 w-8 rounded-xl bg-blue-600 p-1.5 text-white" />
          <h2 className="mt-4 text-base font-bold text-slate-900">Request Review</h2>
          <p className="mt-1 text-sm text-slate-500">Approve, reject, reopen, and mark payroll paid.</p>
          <span className="mt-4 inline-flex rounded-xl bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 group-hover:bg-blue-600 group-hover:text-white">Review Requests</span>
        </Link>
        <Link href="/admin/payroll/reporting" className="group rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm transition hover:border-emerald-300 hover:shadow-md">
          <DollarSign className="h-8 w-8 rounded-xl bg-emerald-600 p-1.5 text-white" />
          <h2 className="mt-4 text-base font-bold text-slate-900">Payroll Reporting</h2>
          <p className="mt-1 text-sm text-slate-500">Summarize revenue and payout splits by user.</p>
          <span className="mt-4 inline-flex rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 group-hover:bg-emerald-600 group-hover:text-white">View Reports</span>
        </Link>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Pending Review Queue</h2>
            <p className="text-sm text-slate-500">Newest compensation requests awaiting payroll approval.</p>
          </div>
          <Link href="/admin/payroll/requests" className="text-sm font-semibold text-blue-600 hover:text-blue-700">View all</Link>
        </div>
        <PayrollRequestTable rows={pendingRequests.length > 0 ? pendingRequests : recentRequests} compact />
      </section>
    </div>
  );
}
