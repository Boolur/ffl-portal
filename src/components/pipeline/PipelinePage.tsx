'use client';

import React, { useMemo, useState, useTransition } from 'react';
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  FileText,
  GitBranch,
  Loader2,
  RefreshCw,
  TrendingUp,
  UserRound,
  X,
} from 'lucide-react';
import {
  getPipelineReport,
  type PipelineMilestoneKey,
  type PipelineMilestoneRow,
  type PipelineReport,
  type PipelineReportFilters,
  type PipelineRangePreset,
} from '@/app/actions/pipelineReportingActions';

type Props = {
  initialReport: PipelineReport;
};

const PRESETS: Array<{ value: PipelineRangePreset; label: string }> = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'ytd', label: 'YTD' },
  { value: 'allTime', label: 'All Time' },
  { value: 'custom', label: 'Date Range' },
];

const BUCKETS: Array<{ key: PipelineMilestoneKey; title: string; helper: string }> = [
  { key: 'plusOne', title: '+1s', helper: 'Submitted +1 loans' },
  { key: 'disclosures', title: 'Disclosures', helper: 'Submitted disclosures' },
  { key: 'processing', title: 'Processing/QC', helper: 'Processing and legacy QC' },
  { key: 'fundings', title: 'Funded', helper: 'Paid payroll requests' },
];

const MILESTONE_TONES: Record<PipelineMilestoneKey, string> = {
  plusOne: 'border-blue-200 bg-blue-50 text-blue-700',
  disclosures: 'border-violet-200 bg-violet-50 text-violet-700',
  processing: 'border-amber-200 bg-amber-50 text-amber-700',
  fundings: 'border-emerald-200 bg-emerald-50 text-emerald-700',
};

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatCurrency(value: number | null) {
  if (value === null) return 'N/A';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number | null) {
  return value === null ? 'N/A' : `${value.toFixed(1)}%`;
}

function dateInputValue(value: string) {
  return value.slice(0, 10);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function highestTrendValue(report: PipelineReport) {
  return Math.max(
    1,
    ...report.trend.flatMap((bucket) => [
      bucket.plusOne,
      bucket.disclosures,
      bucket.processing,
      bucket.fundings,
    ])
  );
}

function metricIcon(key: PipelineMilestoneKey) {
  if (key === 'plusOne') return GitBranch;
  if (key === 'disclosures') return ClipboardCheck;
  if (key === 'processing') return CheckCircle2;
  return CircleDollarSign;
}

export function PipelinePage({ initialReport }: Props) {
  const [report, setReport] = useState(initialReport);
  const [preset, setPreset] = useState<PipelineRangePreset>(initialReport.filters.preset);
  const [startDate, setStartDate] = useState(dateInputValue(initialReport.filters.startDate));
  const [endDate, setEndDate] = useState(dateInputValue(initialReport.filters.endDate));
  const [loanOfficerId, setLoanOfficerId] = useState<string>(initialReport.filters.loanOfficerId);
  const [selectedCard, setSelectedCard] = useState<PipelineMilestoneRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const trendMax = useMemo(() => highestTrendValue(report), [report]);

  const loadReport = (nextFilters?: Partial<PipelineReportFilters>) => {
    const filters: PipelineReportFilters = {
      preset,
      startDate,
      endDate,
      loanOfficerId,
      ...nextFilters,
    };

    startTransition(async () => {
      setError(null);
      try {
        const nextReport = await getPipelineReport(filters);
        setReport(nextReport);
        setPreset(nextReport.filters.preset);
        setStartDate(dateInputValue(nextReport.filters.startDate));
        setEndDate(dateInputValue(nextReport.filters.endDate));
        setLoanOfficerId(nextReport.filters.loanOfficerId);
        setSelectedCard(null);
      } catch (err) {
        console.error(err);
        setError('Unable to load Pipeline metrics. Please try again.');
      }
    });
  };

  const handlePresetChange = (nextPreset: PipelineRangePreset) => {
    setPreset(nextPreset);
    if (nextPreset !== 'custom') {
      loadReport({ preset: nextPreset });
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6">
      <div className="app-page-header flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-blue-700">
            Pilot
          </div>
          <h1 className="app-page-title mt-3">Pipeline</h1>
          <p className="app-page-subtitle max-w-3xl">
            Track clients by active pipeline milestone. Shared loans appear for both assigned LOs, while edits continue to live on the same underlying loan/task record.
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-3 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handlePresetChange(option.value)}
                  className={cx(
                    'rounded-full px-3 py-1.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
                    preset === option.value
                      ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-200'
                      : 'text-muted-foreground hover:bg-secondary'
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {preset === 'custom' && (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <span className="text-xs font-semibold text-muted-foreground">to</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            )}
            {report.canViewAll && (
              <select
                value={loanOfficerId}
                onChange={(event) => {
                  const nextLoanOfficerId = event.target.value;
                  setLoanOfficerId(nextLoanOfficerId);
                  loadReport({ loanOfficerId: nextLoanOfficerId });
                }}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="all">All loan officers</option>
                {report.loanOfficers.map((officer) => (
                  <option key={officer.id} value={officer.id}>
                    {officer.name}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={() => loadReport()}
              disabled={isPending}
              className="app-btn-primary"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Apply
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-2 px-1 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground">Client Pipeline Board</h2>
            <p className="text-sm text-muted-foreground">
              {formatDate(report.filters.startDate)} - {formatDate(report.filters.endDate)}. Click a client card to view details.
            </p>
          </div>
          <span className="app-count-badge">
            {report.filters.loanOfficerId === 'all' ? 'Team pipeline' : 'My visible pipeline'}
          </span>
        </div>

        <div className="grid gap-4 xl:grid-cols-4">
          {BUCKETS.map((bucket) => {
            const rows = report.bucketRows[bucket.key] || [];
            return (
              <div key={bucket.key} className="flex min-h-[360px] flex-col rounded-2xl border border-border bg-secondary/50">
                <div className="border-b border-border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-bold text-foreground">{bucket.title}</h3>
                      <p className="text-xs text-muted-foreground">{bucket.helper}</p>
                    </div>
                    <span className={cx('rounded-full border px-2.5 py-1 text-xs font-bold', MILESTONE_TONES[bucket.key])}>
                      {formatNumber(rows.length)}
                    </span>
                  </div>
                </div>
                <div className="max-h-[560px] flex-1 space-y-3 overflow-y-auto p-3">
                  {rows.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
                      No clients in this bucket for the selected range.
                    </div>
                  ) : (
                    rows.map((row) => (
                      <button
                        key={`${row.milestone}-${row.id}`}
                        type="button"
                        onClick={() => setSelectedCard(row)}
                        className="w-full rounded-xl border border-border bg-card p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/30 hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-bold text-foreground">{row.borrowerName}</p>
                            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                              ARIVE #{row.loanNumber}
                            </p>
                          </div>
                          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span className="rounded-full bg-secondary px-2 py-1">
                            {formatDate(row.occurredAt)}
                          </span>
                          <span className="rounded-full bg-secondary px-2 py-1">
                            {formatCurrency(row.amount)}
                          </span>
                        </div>
                        <p className="mt-3 truncate text-xs text-muted-foreground">
                          {row.sharedLoanOfficerNames.length > 0
                            ? row.sharedLoanOfficerNames.join(' / ')
                            : row.loanOfficerName}
                        </p>
                      </button>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-foreground">Milestone Trend</h2>
            <p className="text-sm text-muted-foreground">Counts by period for the selected range.</p>
          </div>
          <BarChart3 className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="mt-5 grid gap-3">
          {report.trend.map((bucket) => (
            <div key={bucket.startDate} className="grid gap-2 rounded-xl border border-border bg-background p-3 md:grid-cols-[96px_1fr] md:items-center">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">{bucket.label}</p>
              <div className="grid gap-2 sm:grid-cols-4">
                {BUCKETS.map(({ key }) => (
                  <div key={key}>
                    <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground">
                      <span>{key === 'plusOne' ? '+1' : key === 'fundings' ? 'Funded' : key}</span>
                      <span>{bucket[key]}</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-secondary">
                      <div
                        className={cx(
                          'h-full rounded-full',
                          key === 'plusOne' && 'bg-blue-500',
                          key === 'disclosures' && 'bg-violet-500',
                          key === 'processing' && 'bg-amber-500',
                          key === 'fundings' && 'bg-emerald-500'
                        )}
                        style={{ width: `${Math.max(4, (bucket[key] / trendMax) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 shadow-sm xl:col-span-1">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-blue-700">Pull-through</p>
              <p className="mt-2 text-3xl font-bold tracking-tight text-blue-950">
                {formatPercent(report.pullThroughRate)}
              </p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-blue-700 ring-1 ring-blue-100">
              <TrendingUp className="h-5 w-5" />
            </div>
          </div>
          <p className="mt-3 text-sm text-blue-700">
            Fundings divided by +1 submissions for the selected range.
          </p>
        </div>

        {report.summary.map((metric) => {
          const Icon = metricIcon(metric.key);
          return (
            <div key={metric.key} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                    {metric.label}
                  </p>
                  <p className="mt-2 text-3xl font-bold tracking-tight text-foreground">
                    {formatNumber(metric.count)}
                  </p>
                </div>
                <div className={cx('flex h-10 w-10 items-center justify-center rounded-xl border', MILESTONE_TONES[metric.key])}>
                  <Icon className="h-5 w-5" />
                </div>
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                {metric.priorCount === null
                  ? 'Starting milestone for this dashboard.'
                  : `${formatPercent(metric.conversionRate)} from ${formatNumber(metric.priorCount)} prior milestone.`}
              </p>
            </div>
          );
        })}
      </section>

      <section className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="rounded-2xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-5 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-foreground">LO Performance</h2>
                <p className="text-sm text-muted-foreground">
                  Co-LO files count for each assigned officer without duplicating the source record.
                </p>
              </div>
              <UserRound className="h-5 w-5 text-muted-foreground" />
            </div>
          </div>
          <div className="divide-y divide-border">
            {report.teamRows.length === 0 ? (
              <div className="p-5 text-sm text-muted-foreground">No officer activity in this range yet.</div>
            ) : (
              report.teamRows.slice(0, 8).map((row) => (
                <div key={row.loanOfficerId} className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-foreground">{row.loanOfficerName}</p>
                    <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-bold text-muted-foreground">
                      {formatPercent(row.pullThroughRate)}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
                    <MiniCount label="+1" value={row.plusOne} />
                    <MiniCount label="Disc" value={row.disclosures} />
                    <MiniCount label="Proc" value={row.processing} />
                    <MiniCount label="Fund" value={row.fundings} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-foreground">Recent Pipeline Activity</h2>
                <p className="text-sm text-muted-foreground">Newest submitted milestones and fundings.</p>
              </div>
              <span className="app-count-badge">{report.recentRows.length}</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-secondary/70 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-bold">Milestone</th>
                  <th className="px-5 py-3 font-bold">Borrower</th>
                  <th className="px-5 py-3 font-bold">Loan</th>
                  <th className="px-5 py-3 font-bold">Assigned LOs</th>
                  <th className="px-5 py-3 font-bold">Amount</th>
                  <th className="px-5 py-3 font-bold">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.recentRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">
                      No pipeline activity in this range yet.
                    </td>
                  </tr>
                ) : (
                  report.recentRows.map((row) => (
                    <tr key={`${row.milestone}-${row.id}`} className="hover:bg-secondary/40">
                      <td className="px-5 py-3">
                        <span className={cx('inline-flex rounded-full border px-2.5 py-1 text-xs font-bold', MILESTONE_TONES[row.milestone])}>
                          {row.milestoneLabel}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-semibold text-foreground">{row.borrowerName}</td>
                      <td className="px-5 py-3 text-muted-foreground">{row.loanNumber}</td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {row.sharedLoanOfficerNames.length > 0
                          ? row.sharedLoanOfficerNames.join(' / ')
                          : row.loanOfficerName}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{formatCurrency(row.amount)}</td>
                      <td className="px-5 py-3 text-muted-foreground">{formatDate(row.occurredAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <div className="rounded-2xl border border-dashed border-border bg-card p-5 text-sm text-muted-foreground">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <CalendarDays className="mt-0.5 h-5 w-5 text-muted-foreground" />
            <div className="space-y-1">
              <p>
                Disclosure, Processing, and legacy QC history is pulled from shared task records tied to each loan.
              </p>
              <p>
                Lead records are not part of this v1 dashboard. The future Leads-to-Pipeline workflow will let LOs deliberately assign selected leads into pipeline stages.
              </p>
            </div>
          </div>
          <div className="hidden items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground md:flex">
            Leads
            <ArrowRight className="h-3.5 w-3.5" />
            Pipeline
          </div>
        </div>
      </div>

      {selectedCard && (
        <ClientDetailsDrawer row={selectedCard} onClose={() => setSelectedCard(null)} />
      )}
    </div>
  );
}

function ClientDetailsDrawer({
  row,
  onClose,
}: {
  row: PipelineMilestoneRow;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-slate-900/30 backdrop-blur-[1px]">
      <button
        type="button"
        aria-label="Close client details"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <aside className="relative flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-xl">
        <div className="border-b border-border p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className={cx('inline-flex rounded-full border px-2.5 py-1 text-xs font-bold', MILESTONE_TONES[row.milestone])}>
                {row.milestoneLabel}
              </span>
              <h2 className="mt-3 text-xl font-bold text-foreground">{row.borrowerName}</h2>
              <p className="mt-1 text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                ARIVE #{row.loanNumber}
              </p>
            </div>
            <button type="button" onClick={onClose} className="app-icon-btn" aria-label="Close details">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <DetailBlock label="Assigned loan officers" value={row.sharedLoanOfficerNames.join(' / ') || row.loanOfficerName} />
          <DetailBlock label="Milestone date" value={formatDate(row.occurredAt)} />
          <DetailBlock label="Amount" value={formatCurrency(row.amount)} />
          <DetailBlock label="Status" value={row.status.replace(/_/g, ' ')} />
          {row.lender && <DetailBlock label="Lender" value={row.lender} />}
          <div className="rounded-2xl border border-dashed border-border bg-secondary/40 p-4 text-sm text-muted-foreground">
            This drawer is the first pass at client details. The next version can connect this card to full loan history, notes, documents, and custom Pipeline stage controls.
          </div>
        </div>
      </aside>
    </div>
  );
}

function DetailBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-sm font-semibold text-foreground">{value || 'N/A'}</p>
    </div>
  );
}

function MiniCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-secondary px-2 py-2">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-bold text-foreground">{formatNumber(value)}</p>
    </div>
  );
}
