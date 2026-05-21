import Link from 'next/link';
import { Banknote, CalendarDays, DollarSign, Landmark, PieChart, ReceiptText, Users } from 'lucide-react';
import type { getPayrollReport } from '@/app/actions/payrollActions';
import { formatCurrency, loanChannelLabel } from './payrollFormat';

type Report = Awaited<ReturnType<typeof getPayrollReport>>;
type BreakdownRow = Report['byLender'][number];

const chartColors = [
  '#059669',
  '#2563eb',
  '#f59e0b',
  '#dc2626',
  '#7c3aed',
  '#0891b2',
  '#65a30d',
  '#db2777',
];

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

function buildPieSegments(rows: BreakdownRow[]) {
  const total = rows.reduce((sum, row) => sum + row.expectedRevenue, 0);
  let cursor = 0;
  return rows.slice(0, 8).map((row, index) => {
    const percent = total > 0 ? (row.expectedRevenue / total) * 100 : 0;
    const segment = `${chartColors[index % chartColors.length]} ${cursor}% ${cursor + percent}%`;
    cursor += percent;
    return { ...row, percent, color: chartColors[index % chartColors.length], segment };
  });
}

function ChartCard({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle: string;
  rows: BreakdownRow[];
}) {
  const segments = buildPieSegments(rows);
  const total = rows.reduce((sum, row) => sum + row.expectedRevenue, 0);
  const background = segments.length > 0 ? `conic-gradient(${segments.map((segment) => segment.segment).join(', ')})` : '#f1f5f9';

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-gradient-to-br from-slate-50 to-white px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-bold text-slate-900">{title}</h2>
            <p className="text-sm text-slate-500">{subtitle}</p>
          </div>
          <PieChart className="h-5 w-5 text-emerald-600" />
        </div>
      </div>
      <div className="grid gap-5 p-5 lg:grid-cols-[180px_1fr]">
        <div className="flex items-center justify-center">
          <div className="relative h-40 w-40 rounded-full shadow-inner" style={{ background }}>
            <div className="absolute inset-5 flex flex-col items-center justify-center rounded-full bg-white text-center shadow-sm">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total</p>
              <p className="text-lg font-bold text-slate-950">{formatCurrency(total)}</p>
            </div>
          </div>
        </div>
        <div className="space-y-3">
          {segments.length === 0 ? (
            <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">No data for this time period.</p>
          ) : segments.map((row) => (
            <div key={row.label} className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
                  <p className="truncate text-sm font-semibold text-slate-900">{row.label}</p>
                </div>
                <p className="text-sm font-bold text-slate-950">{formatCurrency(row.expectedRevenue)}</p>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
                <div className="h-full rounded-full" style={{ width: `${row.percent}%`, backgroundColor: row.color }} />
              </div>
              <p className="mt-1 text-xs text-slate-500">{row.requestCount} requests · {row.percent.toFixed(1)}%</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Leaderboard({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle: string;
  rows: Array<{ key: string; name: string; detail: string; value: number }>;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="font-bold text-slate-900">{title}</h2>
        <p className="text-sm text-slate-500">{subtitle}</p>
      </div>
      <div className="divide-y divide-slate-100">
        {rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">No report data yet.</p>
        ) : rows.slice(0, 10).map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-4 px-5 py-3">
            <div className="min-w-0">
              <p className="truncate font-semibold text-slate-900">{row.name}</p>
              <p className="text-xs text-slate-500">{row.detail}</p>
            </div>
            <p className="shrink-0 font-bold text-slate-900">{formatCurrency(row.value)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function PayrollReportingPanel({
  report,
  filters,
}: {
  report: Report;
  filters: { startDate: string; endDate: string };
}) {
  const channelRows = report.byChannel.map((row) => ({
    ...row,
    label: loanChannelLabel(row.label),
  }));

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-950 via-emerald-800 to-slate-900 p-6 text-white shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-emerald-100 ring-1 ring-white/10">
              <CalendarDays className="h-3.5 w-3.5" />
              Payroll Reporting
            </div>
            <h2 className="text-2xl font-bold">Revenue breakdowns by time period</h2>
            <p className="mt-2 max-w-2xl text-sm text-emerald-50/80">
              Filter the reporting view by date range, then review where funded-loan revenue is coming from across lenders, loan types, and broker/correspondent channels.
            </p>
          </div>
          <form className="grid gap-3 rounded-2xl bg-white/10 p-4 ring-1 ring-white/15 sm:grid-cols-[1fr_1fr_auto]">
            <label className="block">
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-100">Start</span>
              <input
                type="date"
                name="startDate"
                defaultValue={filters.startDate}
                className="mt-1 w-full rounded-lg border border-white/20 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-300/30"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-100">End</span>
              <input
                type="date"
                name="endDate"
                defaultValue={filters.endDate}
                className="mt-1 w-full rounded-lg border border-white/20 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-300/30"
              />
            </label>
            <button type="submit" className="self-end rounded-lg bg-emerald-400 px-4 py-2 text-sm font-bold text-emerald-950 transition hover:bg-emerald-300">
              Apply Filter
            </button>
          </form>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Kpi title="Submitted Revenue" value={formatCurrency(report.summary.submittedRevenue)} subtitle={`${report.summary.totalRequests} requests`} Icon={Banknote} />
        <Kpi title="Pending" value={formatCurrency(report.summary.pendingRevenue)} subtitle={`${report.summary.pendingCount} requests`} Icon={ReceiptText} />
        <Kpi title="Approved" value={formatCurrency(report.summary.approvedRevenue)} subtitle={`${report.summary.approvedCount} requests`} Icon={Users} />
        <Kpi title="Paid" value={formatCurrency(report.summary.paidRevenue)} subtitle={`${report.summary.paidCount} requests`} Icon={DollarSign} />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <ChartCard title="Per Lender" subtitle="Expected revenue by lender for the selected period." rows={report.byLender} />
        <ChartCard title="Per Loan Type" subtitle="Expected revenue by submitted loan type." rows={report.byLoanType} />
        <ChartCard title="Per Broker / Correspondent" subtitle="Broker vs non-delegated revenue mix." rows={channelRows} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Leaderboard
          title="Top Loan Officers"
          subtitle="Expected and paid revenue by submitter."
          rows={report.byLoanOfficer.map((row) => ({
            key: row.loanOfficerId,
            name: row.loanOfficerName,
            detail: `${row.requestCount} requests · paid ${formatCurrency(row.paidRevenue)}`,
            value: row.expectedRevenue,
          }))}
        />
        <Leaderboard
          title="Top Split Recipients"
          subtitle="Snapshot payouts across all matching requests."
          rows={report.splitRows.map((row) => ({
            key: `${row.recipientEmail ?? row.recipientName}:${row.roleLabel}`,
            name: row.recipientName,
            detail: `${row.roleLabel} · ${row.requestCount} split rows`,
            value: row.amount,
          }))}
        />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600 shadow-sm">
        Need to approve, reject, edit, or mark a request paid? Use the{' '}
        <Link href="/admin/payroll/requests" className="font-semibold text-emerald-700 hover:text-emerald-800">
          Payroll Requests
        </Link>{' '}
        tab. This reporting screen is read-only.
      </div>
    </div>
  );
}
