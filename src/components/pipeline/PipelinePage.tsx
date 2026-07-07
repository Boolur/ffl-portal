'use client';

import React, { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  FileText,
  GitBranch,
  Home,
  Loader2,
  Mail,
  Phone,
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
  type PipelineTrendGranularity,
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

const TREND_GRANULARITIES: Array<{ value: PipelineTrendGranularity; label: string }> = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'daily', label: 'Daily' },
];

const BUCKETS: Array<{ key: PipelineMilestoneKey; title: string; helper: string }> = [
  { key: 'plusOne', title: '+1s', helper: 'Submitted +1 loans' },
  { key: 'disclosures', title: 'Disclosures', helper: 'Submitted disclosures' },
  { key: 'processing', title: 'Processing/QC', helper: 'Processing and legacy QC' },
  { key: 'fundings', title: 'Funded', helper: 'Paid payroll requests' },
];

const MILESTONE_TONES: Record<PipelineMilestoneKey, string> = {
  plusOne: 'border-emerald-300 bg-emerald-100 text-emerald-800',
  disclosures: 'border-blue-300 bg-blue-100 text-blue-800',
  processing: 'border-purple-300 bg-purple-100 text-purple-800',
  fundings: 'border-amber-300 bg-amber-100 text-amber-800',
};

const MILESTONE_SURFACES: Record<PipelineMilestoneKey, {
  column: string;
  headerIcon: string;
  card: string;
  accent: string;
  glow: string;
}> = {
  plusOne: {
    column: 'border-emerald-200 bg-emerald-50/70',
    headerIcon: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
    card: 'border-emerald-100 bg-white hover:border-emerald-300 hover:bg-emerald-50/40',
    accent: 'bg-emerald-400',
    glow: 'bg-emerald-100',
  },
  disclosures: {
    column: 'border-blue-200 bg-blue-50/70',
    headerIcon: 'bg-blue-100 text-blue-700 ring-blue-200',
    card: 'border-blue-100 bg-white hover:border-blue-300 hover:bg-blue-50/40',
    accent: 'bg-blue-400',
    glow: 'bg-blue-100',
  },
  processing: {
    column: 'border-purple-200 bg-purple-50/70',
    headerIcon: 'bg-purple-100 text-purple-700 ring-purple-200',
    card: 'border-purple-100 bg-white hover:border-purple-300 hover:bg-purple-50/40',
    accent: 'bg-purple-400',
    glow: 'bg-purple-100',
  },
  fundings: {
    column: 'border-amber-200 bg-amber-50/75',
    headerIcon: 'bg-amber-100 text-amber-700 ring-amber-200',
    card: 'border-amber-100 bg-white hover:border-amber-300 hover:bg-amber-50/40',
    accent: 'bg-amber-400',
    glow: 'bg-amber-100',
  },
};

const REVIEWED_UPDATES_STORAGE_KEY = 'ffl:pipeline-reviewed-updates';

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

function formatDateTime(value: string | null) {
  if (!value) return 'N/A';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatStatus(value: string | null) {
  if (!value) return 'N/A';
  return value.replace(/_/g, ' ');
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'CL';
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

function updateSignalClassName(tone: NonNullable<PipelineMilestoneRow['updateSignal']>['tone']) {
  if (tone === 'danger') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (tone === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (tone === 'info') return 'border-blue-200 bg-blue-50 text-blue-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

function updateSignalKey(row: PipelineMilestoneRow) {
  if (!row.updateSignal) return null;
  return `${row.milestone}:${row.id}:${row.status}:${row.updateSignal.label}`;
}

function visibleUpdateSignal(row: PipelineMilestoneRow, reviewedUpdates: Set<string>) {
  if (!row.updateSignal) return null;
  if (row.milestone === 'plusOne') return null;
  const key = updateSignalKey(row);
  if (key && reviewedUpdates.has(key)) return null;
  return row.updateSignal;
}

function loadReviewedUpdates() {
  if (typeof window === 'undefined') return new Set<string>();
  try {
    const raw = window.localStorage.getItem(REVIEWED_UPDATES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []);
  } catch {
    return new Set<string>();
  }
}

export function PipelinePage({ initialReport }: Props) {
  const router = useRouter();
  const [report, setReport] = useState(initialReport);
  const [preset, setPreset] = useState<PipelineRangePreset>(initialReport.filters.preset);
  const [startDate, setStartDate] = useState(dateInputValue(initialReport.filters.startDate));
  const [endDate, setEndDate] = useState(dateInputValue(initialReport.filters.endDate));
  const [loanOfficerId, setLoanOfficerId] = useState<string>(initialReport.filters.loanOfficerId);
  const [trendGranularity, setTrendGranularity] = useState<PipelineTrendGranularity>(
    initialReport.filters.trendGranularity
  );
  const [selectedCard, setSelectedCard] = useState<PipelineMilestoneRow | null>(null);
  const [reviewedUpdates, setReviewedUpdates] = useState<Set<string>>(() => loadReviewedUpdates());
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const trendMax = useMemo(() => highestTrendValue(report), [report]);

  const markUpdateReviewed = (row: PipelineMilestoneRow) => {
    const key = updateSignalKey(row);
    if (!key) return;
    setReviewedUpdates((current) => {
      const next = new Set(current);
      next.add(key);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(REVIEWED_UPDATES_STORAGE_KEY, JSON.stringify(Array.from(next)));
      }
      return next;
    });
  };

  const reviewUpdate = (row: PipelineMilestoneRow) => {
    markUpdateReviewed(row);
    if (row.fileDetails.payroll) {
      router.push(`/payroll?requestId=${encodeURIComponent(row.id)}`);
      return;
    }
    if (!row.fileDetails.task) return;
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem('ffl:tasks-sync-pending', '1');
      window.sessionStorage.setItem('ffl:tasks-sync-pending-at', String(Date.now()));
    }
    router.push(`/tasks?taskId=${encodeURIComponent(row.id)}`);
  };

  const loadReport = (nextFilters?: Partial<PipelineReportFilters>) => {
    const filters: PipelineReportFilters = {
      preset,
      startDate,
      endDate,
      loanOfficerId,
      trendGranularity,
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
        setTrendGranularity(nextReport.filters.trendGranularity);
        setSelectedCard(null);
      } catch (err) {
        console.error(err);
        setError('Unable to load Pipeline metrics. Please try again.');
      }
    });
  };

  const handleTrendGranularityChange = (nextTrendGranularity: PipelineTrendGranularity) => {
    setTrendGranularity(nextTrendGranularity);
    loadReport({ trendGranularity: nextTrendGranularity });
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

      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-foreground">Milestone Trend</h2>
            <p className="text-sm text-muted-foreground">
              Counts grouped by {trendGranularity === 'weekly' ? 'week' : 'day'} for the selected range.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={trendGranularity}
              onChange={(event) =>
                handleTrendGranularityChange(event.target.value as PipelineTrendGranularity)
              }
              disabled={isPending}
              className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground shadow-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="Milestone trend grouping"
            >
              {TREND_GRANULARITIES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <BarChart3 className="h-5 w-5 text-muted-foreground" />
          </div>
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
                          key === 'plusOne' && 'bg-emerald-500',
                          key === 'disclosures' && 'bg-blue-500',
                          key === 'processing' && 'bg-purple-500',
                          key === 'fundings' && 'bg-amber-500'
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
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-1">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Pull-through</p>
              <p className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
                {formatPercent(report.pullThroughRate)}
              </p>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-700 ring-1 ring-slate-200">
              <TrendingUp className="h-5 w-5" />
            </div>
          </div>
          <p className="mt-3 text-sm text-slate-500">
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
            const Icon = metricIcon(bucket.key);
            const surface = MILESTONE_SURFACES[bucket.key];
            return (
              <div key={bucket.key} className={cx('flex min-h-[360px] flex-col rounded-2xl border', surface.column)}>
                <div className="border-b border-white/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className={cx('flex h-10 w-10 items-center justify-center rounded-xl ring-1', surface.headerIcon)}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-bold text-foreground">{bucket.title}</h3>
                        <p className="text-xs text-muted-foreground">{bucket.helper}</p>
                      </div>
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
                      <PipelineCard
                        key={`${row.milestone}-${row.id}`}
                        row={row}
                        surface={surface}
                        signal={visibleUpdateSignal(row, reviewedUpdates)}
                        onSelect={setSelectedCard}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
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
        <ClientDetailsModal
          row={selectedCard}
          signal={visibleUpdateSignal(selectedCard, reviewedUpdates)}
          onReviewUpdate={() => reviewUpdate(selectedCard)}
          onClose={() => setSelectedCard(null)}
        />
      )}
    </div>
  );
}

function PipelineCard({
  row,
  surface,
  signal,
  onSelect,
}: {
  row: PipelineMilestoneRow;
  surface: (typeof MILESTONE_SURFACES)[PipelineMilestoneKey];
  signal: PipelineMilestoneRow['updateSignal'];
  onSelect: (row: PipelineMilestoneRow) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(row)}
      className={cx(
        'group relative w-full overflow-hidden rounded-2xl border p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
        surface.card
      )}
    >
      <div className={cx('absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-60 blur-2xl transition group-hover:opacity-90', surface.glow)} />
      <div className={cx('absolute inset-y-3 left-0 w-1 rounded-r-full', surface.accent)} />
      {signal?.tone === 'danger' && (
        <span className="absolute right-3 top-3 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1.5 text-[10px] font-black leading-none text-white shadow-sm ring-2 ring-white" aria-label="New update">
          1
        </span>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="relative min-w-0 pl-2">
          <div className="flex items-center gap-2">
            <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-black ring-1', MILESTONE_TONES[row.milestone])}>
              {initials(row.borrowerName)}
            </span>
            <p className="truncate font-bold text-foreground">{row.borrowerName}</p>
          </div>
          <p className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            ARIVE #{row.loanNumber}
          </p>
        </div>
      </div>
      <div className="relative mt-3 flex flex-wrap gap-2 pl-2 text-xs text-muted-foreground">
        <span className="rounded-full bg-secondary px-2 py-1">
          {formatDate(row.occurredAt)}
        </span>
        <span className="rounded-full bg-secondary px-2 py-1">
          {formatCurrency(row.amount)}
        </span>
        {signal && (
          <span className={cx('rounded-full border px-2 py-1 font-bold', updateSignalClassName(signal.tone))}>
            {signal.label}
          </span>
        )}
      </div>
      <p className="relative mt-3 truncate pl-2 text-xs text-muted-foreground">
        {row.sharedLoanOfficerNames.length > 0
          ? row.sharedLoanOfficerNames.join(' / ')
          : row.loanOfficerName}
      </p>
    </button>
  );
}

function ClientDetailsModal({
  row,
  signal,
  onReviewUpdate,
  onClose,
}: {
  row: PipelineMilestoneRow;
  signal: PipelineMilestoneRow['updateSignal'];
  onReviewUpdate: () => void;
  onClose: () => void;
}) {
  const submittedFields = row.fileDetails.task?.submittedFields || [];
  const reviewLabel = row.fileDetails.payroll ? 'Review Payroll' : 'Review Task';
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/45 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-5xl overflow-y-auto overflow-x-hidden rounded-[24px] border border-slate-200/70 bg-slate-50 p-6 shadow-2xl sm:p-8"
        style={{ scrollbarGutter: 'stable' }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-6 border-b border-slate-200/70 pb-6">
          <div className="flex min-w-0 items-center gap-5">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 text-xl font-bold text-white shadow-lg shadow-blue-600/20 ring-4 ring-white">
              {initials(row.borrowerName)}
            </div>
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h2 className="text-2xl font-extrabold tracking-tight text-slate-950">
                  {row.borrowerName}
                </h2>
                <span className="inline-flex items-center rounded-md bg-white px-2.5 py-1 font-mono text-sm font-bold text-slate-600 shadow-sm ring-1 ring-inset ring-slate-200">
                  {row.loanNumber}
                </span>
              </div>
              <span className={cx('inline-flex rounded-full border px-2.5 py-1 text-xs font-bold', MILESTONE_TONES[row.milestone])}>
                {row.milestoneLabel}
              </span>
              {signal && (
                <span className={cx('ml-2 inline-flex rounded-full border px-2.5 py-1 text-xs font-bold', updateSignalClassName(signal.tone))}>
                  {signal.label}
                </span>
              )}
              <p className="mt-2 text-sm font-medium text-slate-500">
                {row.sharedLoanOfficerNames.join(' / ') || row.loanOfficerName}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 transition hover:bg-slate-50 hover:text-slate-600 hover:shadow-sm"
            aria-label="Close client details"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {signal && (
          <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-800 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-bold">{signal.label}</p>
              <p className="mt-1 text-sm text-rose-700">
                {row.fileDetails.payroll
                  ? 'Open the related Payroll request to view manager review notes, approval, payment, or revision status.'
                  : 'Open the related Tasks item to respond, complete, or clear the underlying queue status.'}
              </p>
            </div>
            <button
              type="button"
              onClick={onReviewUpdate}
              disabled={!row.fileDetails.task && !row.fileDetails.payroll}
              className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-white px-3 text-sm font-bold text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-100"
            >
              {reviewLabel}
            </button>
          </div>
        )}

        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-5">
            <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
              <div className="mb-5 flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-700 ring-1 ring-blue-100">
                  <FileText className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-950">File Overview</h3>
                  <p className="text-sm text-slate-500">Core details currently captured in the portal.</p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <InfoItem label="ARIVE Loan Number" value={row.loanNumber} />
                <InfoItem label="Milestone Status" value={formatStatus(row.status)} />
                <InfoItem label="Loan Amount / Revenue" value={formatCurrency(row.amount)} />
                <InfoItem label="Milestone Date" value={formatDateTime(row.occurredAt)} />
                <InfoItem label="Loan Program" value={row.fileDetails.loan.program || 'N/A'} />
                <InfoItem label="Loan Stage" value={formatStatus(row.fileDetails.loan.stage)} />
                <InfoItem label="Created In Portal" value={formatDateTime(row.fileDetails.loan.createdAt)} />
                <InfoItem label="Last Updated" value={formatDateTime(row.fileDetails.loan.updatedAt)} />
              </div>
            </section>

            {submittedFields.length > 0 && (
              <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
                <div className="mb-5 flex items-center gap-3 border-b border-slate-100 pb-4">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-50 text-violet-700 ring-1 ring-violet-100">
                    <ClipboardCheck className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-950">
                      {row.fileDetails.task?.title || 'Submitted File Details'}
                    </h3>
                    <p className="text-sm text-slate-500">Fields submitted with this milestone request.</p>
                  </div>
                </div>
                <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
                  {submittedFields.map((field) => (
                    <InfoItem key={`${field.label}-${field.value}`} label={field.label} value={field.value} />
                  ))}
                </div>
              </section>
            )}

            {row.fileDetails.payroll && (
              <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
                <div className="mb-5 flex items-center gap-3 border-b border-slate-100 pb-4">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                    <CircleDollarSign className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-950">Funding / Payroll Details</h3>
                    <p className="text-sm text-slate-500">Compensation request data tied to this funding.</p>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <InfoItem label="Lender" value={row.fileDetails.payroll.lender || 'N/A'} />
                  <InfoItem label="Loan Type" value={row.fileDetails.payroll.loanType || 'N/A'} />
                  <InfoItem label="Channel" value={formatStatus(row.fileDetails.payroll.loanChannel)} />
                  <InfoItem label="Processing Type" value={formatStatus(row.fileDetails.payroll.processingType)} />
                  <InfoItem label="Expected Revenue" value={formatCurrency(row.fileDetails.payroll.expectedRevenue)} />
                  <InfoItem label="Paid At" value={formatDateTime(row.fileDetails.payroll.paidAt)} />
                </div>
              </section>
            )}
          </div>

          <aside className="space-y-5">
            <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
              <h3 className="font-bold text-slate-950">Client Contact</h3>
              <div className="mt-4 space-y-3">
                <ContactRow icon={Phone} label="Phone" value={row.fileDetails.loan.borrowerPhone || 'N/A'} />
                <ContactRow icon={Mail} label="Email" value={row.fileDetails.loan.borrowerEmail || 'N/A'} />
                <ContactRow icon={Home} label="Property" value={row.fileDetails.loan.propertyAddress || 'N/A'} />
              </div>
            </section>

            <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
              <h3 className="font-bold text-slate-950">Assigned Team</h3>
              <div className="mt-4 space-y-2">
                {(row.sharedLoanOfficerNames.length > 0
                  ? row.sharedLoanOfficerNames
                  : [row.loanOfficerName]
                ).map((name) => (
                  <div key={name} className="rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-100">
                    {name}
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-500">
              This modal is using the same centered detail pattern as Tasks. Next we can add notes, documents, timeline history, and editable custom Pipeline stages here.
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="mb-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-400">
        {label}
      </span>
      <span className="break-words text-[15px] font-semibold text-slate-900">
        {value || 'N/A'}
      </span>
    </div>
  );
}

function ContactRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-slate-500 ring-1 ring-slate-200">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
        <p className="mt-1 break-words text-sm font-semibold text-slate-800">{value || 'N/A'}</p>
      </div>
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
