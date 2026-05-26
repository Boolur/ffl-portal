import Link from 'next/link';
import { Banknote, CheckCircle2, Clock, Database, DollarSign, Users } from 'lucide-react';
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

function MiniStatsPanel({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle: string;
  rows: Array<{ label: string; count: number }>;
}) {
  const maxCount = Math.max(...rows.map((row) => row.count), 1);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="font-bold text-slate-900">{title}</h2>
        <p className="text-sm text-slate-500">{subtitle}</p>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-slate-500">No pending data yet.</p>
      ) : (
        <div className="space-y-3 p-5">
          {rows.map((row) => (
            <div key={row.label} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-semibold text-slate-800">{row.label}</span>
                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700">{row.count}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{ width: `${Math.max((row.count / maxCount) * 100, 8)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function PayrollAdminDashboard({ summary, pendingRequests, recentRequests }: Props) {
  const reviewRows = pendingRequests.length > 0 ? pendingRequests : recentRequests;
  const lenderStats = Array.from(
    reviewRows.reduce((map, row) => {
      const lender = row.lender.trim() || 'Unknown Lender';
      map.set(lender, (map.get(lender) ?? 0) + 1);
      return map;
    }, new Map<string, number>())
  )
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const loanTypeStats = Array.from(
    reviewRows.reduce((map, row) => {
      const loanType = row.loanType.trim() || 'Unknown Loan Type';
      map.set(loanType, (map.get(loanType) ?? 0) + 1);
      return map;
    }, new Map<string, number>())
  )
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Pending Review" value={String(summary.pendingCount)} subtitle={formatCurrency(summary.pendingRevenue)} Icon={Clock} />
        <KpiCard title="Approved" value={String(summary.approvedCount)} subtitle={formatCurrency(summary.approvedRevenue)} Icon={CheckCircle2} />
        <KpiCard title="Paid" value={String(summary.paidCount)} subtitle={formatCurrency(summary.paidRevenue)} Icon={DollarSign} />
        <KpiCard title="Submitted Revenue" value={formatCurrency(summary.submittedRevenue)} subtitle={`${summary.totalRequests} total requests`} Icon={Banknote} />
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
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
        <Link href="/admin/payroll/settings" className="group rounded-2xl border border-purple-200 bg-white p-5 shadow-sm transition hover:border-purple-300 hover:shadow-md">
          <Database className="h-8 w-8 rounded-xl bg-purple-600 p-1.5 text-white" />
          <h2 className="mt-4 text-base font-bold text-slate-900">Payroll Settings & Database</h2>
          <p className="mt-1 text-sm text-slate-500">Manage lender fees, required checks, and calculation rules.</p>
          <span className="mt-4 inline-flex rounded-xl bg-purple-50 px-3 py-2 text-sm font-semibold text-purple-700 group-hover:bg-purple-600 group-hover:text-white">Manage Rules</span>
        </Link>
      </div>

      <section className="grid items-start gap-5 xl:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="font-bold text-slate-900">Pending Review Queue</h2>
              <p className="text-sm text-slate-500">Newest compensation requests awaiting payroll approval.</p>
            </div>
            <Link href="/admin/payroll/requests" className="text-sm font-semibold text-blue-600 hover:text-blue-700">View all</Link>
          </div>
          <PayrollRequestTable rows={reviewRows} compact embedded />
        </div>
        <div className="grid gap-5">
          <MiniStatsPanel title="Lender Stats" subtitle="Pending/recent loans by lender" rows={lenderStats} />
          <MiniStatsPanel title="Loan Type Stats" subtitle="Pending/recent loans by loan type" rows={loanTypeStats} />
        </div>
      </section>
    </div>
  );
}
