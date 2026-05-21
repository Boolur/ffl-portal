import { Banknote, DollarSign, ReceiptText, Users } from 'lucide-react';
import type { getPayrollReport } from '@/app/actions/payrollActions';
import { PayrollRequestTable } from './PayrollRequestTable';
import { formatCurrency } from './payrollFormat';

type Report = Awaited<ReturnType<typeof getPayrollReport>>;

function Kpi({
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
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{title}</p>
          <p className="mt-2 text-2xl font-bold text-slate-950">{value}</p>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        </div>
        <Icon className="h-5 w-5 text-emerald-600" />
      </div>
    </div>
  );
}

export function PayrollReportingPanel({ report }: { report: Report }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Kpi title="Submitted Revenue" value={formatCurrency(report.summary.submittedRevenue)} subtitle={`${report.summary.totalRequests} requests`} Icon={Banknote} />
        <Kpi title="Pending" value={formatCurrency(report.summary.pendingRevenue)} subtitle={`${report.summary.pendingCount} requests`} Icon={ReceiptText} />
        <Kpi title="Approved" value={formatCurrency(report.summary.approvedRevenue)} subtitle={`${report.summary.approvedCount} requests`} Icon={Users} />
        <Kpi title="Paid" value={formatCurrency(report.summary.paidRevenue)} subtitle={`${report.summary.paidCount} requests`} Icon={DollarSign} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="font-bold text-slate-900">By Loan Officer</h2>
            <p className="text-sm text-slate-500">Expected and paid revenue by submitter.</p>
          </div>
          <div className="divide-y divide-slate-100">
            {report.byLoanOfficer.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500">No report data yet.</p>
            ) : report.byLoanOfficer.map((row) => (
              <div key={row.loanOfficerId} className="flex items-center justify-between gap-4 px-5 py-3">
                <div>
                  <p className="font-semibold text-slate-900">{row.loanOfficerName}</p>
                  <p className="text-xs text-slate-500">{row.requestCount} requests · paid {formatCurrency(row.paidRevenue)}</p>
                </div>
                <p className="font-bold text-slate-900">{formatCurrency(row.expectedRevenue)}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="font-bold text-slate-900">By Split Recipient</h2>
            <p className="text-sm text-slate-500">Snapshot payouts across all matching requests.</p>
          </div>
          <div className="divide-y divide-slate-100">
            {report.splitRows.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500">No split data yet.</p>
            ) : report.splitRows.map((row) => (
              <div key={`${row.recipientEmail ?? row.recipientName}:${row.roleLabel}`} className="flex items-center justify-between gap-4 px-5 py-3">
                <div>
                  <p className="font-semibold text-slate-900">{row.recipientName}</p>
                  <p className="text-xs text-slate-500">{row.roleLabel} · {row.requestCount} split rows</p>
                </div>
                <p className="font-bold text-slate-900">{formatCurrency(row.amount)}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">Detailed Requests</h2>
          <p className="text-sm text-slate-500">Full request list included in this report.</p>
        </div>
        <PayrollRequestTable rows={report.detailRows} />
      </section>
    </div>
  );
}
