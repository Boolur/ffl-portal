'use client';

import React, { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  FileText,
  Home,
  Loader2,
  Mail,
  Phone,
  RefreshCw,
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

type PipelineChecklistStatus =
  | 'GREEN_CHECK'
  | 'RED_X'
  | 'YELLOW'
  | 'ORDERED'
  | 'MISSING_ITEMS'
  | 'COMPLETED'
  | 'NOT_REQUIRED';

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
    column: 'border-emerald-100 bg-white',
    headerIcon: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
    card: 'border-emerald-100 bg-white hover:border-emerald-300 hover:bg-emerald-50/40',
    accent: 'bg-emerald-400',
    glow: 'bg-emerald-100',
  },
  disclosures: {
    column: 'border-blue-100 bg-white',
    headerIcon: 'bg-blue-100 text-blue-700 ring-blue-200',
    card: 'border-blue-100 bg-white hover:border-blue-300 hover:bg-blue-50/40',
    accent: 'bg-blue-400',
    glow: 'bg-blue-100',
  },
  processing: {
    column: 'border-purple-100 bg-white',
    headerIcon: 'bg-purple-100 text-purple-700 ring-purple-200',
    card: 'border-purple-100 bg-white hover:border-purple-300 hover:bg-purple-50/40',
    accent: 'bg-purple-400',
    glow: 'bg-purple-100',
  },
  fundings: {
    column: 'border-amber-100 bg-white',
    headerIcon: 'bg-amber-100 text-amber-700 ring-amber-200',
    card: 'border-amber-100 bg-white hover:border-amber-300 hover:bg-amber-50/40',
    accent: 'bg-amber-400',
    glow: 'bg-amber-100',
  },
};

const BOARD_METRIC_SURFACES: Record<PipelineMilestoneKey, {
  border: string;
  panel: string;
  icon: string;
  label: string;
  value: string;
}> = {
  plusOne: {
    border: 'border-emerald-100',
    panel: 'from-emerald-50/90 via-white to-white',
    icon: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
    label: 'text-emerald-700',
    value: 'text-emerald-950',
  },
  disclosures: {
    border: 'border-blue-100',
    panel: 'from-blue-50/90 via-white to-white',
    icon: 'bg-blue-100 text-blue-700 ring-blue-200',
    label: 'text-blue-700',
    value: 'text-blue-950',
  },
  processing: {
    border: 'border-purple-100',
    panel: 'from-purple-50/90 via-white to-white',
    icon: 'bg-purple-100 text-purple-700 ring-purple-200',
    label: 'text-purple-700',
    value: 'text-purple-950',
  },
  fundings: {
    border: 'border-amber-100',
    panel: 'from-amber-50/90 via-white to-white',
    icon: 'bg-amber-100 text-amber-700 ring-amber-200',
    label: 'text-amber-700',
    value: 'text-amber-950',
  },
};

const REVIEWED_UPDATES_STORAGE_KEY = 'ffl:pipeline-reviewed-updates';
const PORTAL_TIME_ZONE = 'America/Los_Angeles';

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

function dateInputValue(value: string) {
  return value.slice(0, 10);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: PORTAL_TIME_ZONE,
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
    timeZone: PORTAL_TIME_ZONE,
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

function updateSignalClassName(tone: NonNullable<PipelineMilestoneRow['updateSignal']>['tone']) {
  if (tone === 'danger') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (tone === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (tone === 'info') return 'border-blue-200 bg-blue-50 text-blue-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

function checklistStatusClassName(status: PipelineChecklistStatus) {
  if (status === 'RED_X' || status === 'MISSING_ITEMS') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (status === 'YELLOW' || status === 'ORDERED') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (status === 'GREEN_CHECK' || status === 'COMPLETED') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
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
  const [selectedCard, setSelectedCard] = useState<PipelineMilestoneRow | null>(null);
  const [reviewedUpdates, setReviewedUpdates] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setReviewedUpdates(loadReviewedUpdates());
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

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

  const openBorrowerDetails = (row: PipelineMilestoneRow) => {
    markUpdateReviewed(row);
    setSelectedCard(row);
  };

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

      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/70">
        <div className="flex flex-col gap-3 px-1 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-950">Client Pipeline Board</h2>
            <p className="mt-1 text-sm font-medium text-slate-500">
              {formatDate(report.filters.startDate)} - {formatDate(report.filters.endDate)}. Click a client card to view details.
            </p>
          </div>
          <span className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-slate-600">
            {report.filters.loanOfficerId === 'all' ? 'Team pipeline' : 'My visible pipeline'}
          </span>
        </div>

        <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <BoardMetricCard
            stage="plusOne"
            title="+1s"
            Icon={Home}
            count={report.totals.plusOne}
            primaryLabel="Volume"
            primaryValue={formatCurrency(report.boardMetrics.plusOne.volumeTotal)}
            secondaryLabel="Revenue"
            secondaryValue={formatCurrency(report.boardMetrics.plusOne.revenueTotal)}
          />
          <BoardMetricCard
            stage="disclosures"
            title="Disclosures"
            Icon={ClipboardCheck}
            count={report.totals.disclosures}
            primaryLabel="Volume"
            primaryValue={formatCurrency(report.boardMetrics.disclosures.volumeTotal)}
            secondaryLabel="Units"
            secondaryValue={formatNumber(report.boardMetrics.disclosures.units)}
          />
          <BoardMetricCard
            stage="processing"
            title="Submitted to Processing"
            Icon={CheckCircle2}
            count={report.totals.processing}
            primaryLabel="Volume"
            primaryValue={formatCurrency(report.boardMetrics.processing.volumeTotal)}
            secondaryLabel="Units"
            secondaryValue={formatNumber(report.boardMetrics.processing.units)}
          />
          <BoardMetricCard
            stage="fundings"
            title="Fundings"
            Icon={CircleDollarSign}
            count={report.totals.fundings}
            primaryLabel="Volume"
            primaryValue={formatCurrency(report.boardMetrics.fundings.volumeTotal)}
            secondaryLabel="Revenue"
            secondaryValue={formatCurrency(report.boardMetrics.fundings.revenueTotal)}
          />
        </div>

        <div className="grid gap-5 xl:grid-cols-4">
          {BUCKETS.map((bucket) => {
            const rows = report.bucketRows[bucket.key] || [];
            const surface = MILESTONE_SURFACES[bucket.key];
            return (
              <div key={bucket.key} className={cx('flex min-h-[360px] flex-col overflow-hidden rounded-[24px] border shadow-sm', surface.column)}>
                <div className="max-h-[560px] flex-1 space-y-3 overflow-y-auto p-4">
                  {rows.length === 0 ? (
                    <div className="flex min-h-[92px] items-center justify-center rounded-2xl border border-dashed border-white/80 bg-white/70 p-4 text-center text-sm font-medium text-slate-500 shadow-sm">
                      No clients in this bucket for the selected range.
                    </div>
                  ) : (
                    rows.map((row) => (
                      <PipelineCard
                        key={`${row.milestone}-${row.id}`}
                        row={row}
                        surface={surface}
                        signal={visibleUpdateSignal(row, reviewedUpdates)}
                        onSelect={openBorrowerDetails}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
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
                    <tr
                      key={`${row.milestone}-${row.id}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => openBorrowerDetails(row)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openBorrowerDetails(row);
                        }
                      }}
                      className="cursor-pointer transition hover:bg-secondary/40 focus-visible:bg-secondary/50 focus-visible:outline-none"
                      aria-label={`Open details for ${row.borrowerName}`}
                    >
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

function BoardMetricCard({
  stage,
  title,
  Icon,
  count,
  primaryLabel,
  primaryValue,
  secondaryLabel,
  secondaryValue,
}: {
  stage: PipelineMilestoneKey;
  title: string;
  Icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  count: number;
  primaryLabel: string;
  primaryValue: string;
  secondaryLabel: string;
  secondaryValue: string;
}) {
  const surface = BOARD_METRIC_SURFACES[stage];
  return (
    <div className={cx('relative overflow-hidden rounded-[20px] border bg-gradient-to-br px-4 py-3 shadow-sm', surface.border, surface.panel)}>
      <div className="absolute -right-8 -top-10 h-28 w-28 rounded-full bg-white/70 blur-2xl" />
      <span className={cx('absolute right-3 top-3 rounded-full border px-2.5 py-1 text-xs font-bold shadow-sm', MILESTONE_TONES[stage])}>
        {formatNumber(count)}
      </span>
      <div className="relative flex flex-col items-center text-center">
        <div className={cx('flex h-9 w-9 items-center justify-center rounded-xl ring-1 shadow-sm', surface.icon)}>
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        <div className="mt-2 min-w-0">
          <p className={cx('text-lg font-bold leading-snug tracking-tight', surface.value)}>
            {title}
          </p>
        </div>
      </div>
      <div className="relative mx-auto mt-3 grid w-full max-w-[260px] grid-cols-2 items-start gap-4 text-center">
        <div className="flex min-w-0 flex-col items-center">
          <p className={cx('text-2xl font-bold tracking-tight', surface.value)}>
            {primaryValue}
          </p>
          <p className={cx('mt-1 text-[10px] font-bold uppercase tracking-[0.12em]', surface.label)}>
            {primaryLabel}
          </p>
        </div>
        <div className="flex min-w-0 flex-col items-center">
          <p className={cx('text-2xl font-bold tracking-tight', surface.value)}>
            {secondaryValue}
          </p>
          <p className={cx('mt-1 text-[10px] font-bold uppercase tracking-[0.12em]', surface.label)}>
            {secondaryLabel}
          </p>
        </div>
      </div>
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
  const queueStage = row.fileDetails.task?.queueStage || null;
  const teamLabel = row.sharedLoanOfficerNames.length > 0
    ? row.sharedLoanOfficerNames.join(' / ')
    : row.loanOfficerName;
  return (
    <button
      type="button"
      onClick={() => onSelect(row)}
      className="group relative flex h-[154px] w-full flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-3 text-left shadow-sm transition-all hover:border-blue-300 hover:shadow-md hover:ring-1 hover:ring-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
    >
      <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-slate-50 opacity-50 blur-2xl transition-colors group-hover:bg-blue-50" />
      {signal?.tone === 'danger' && (
        <span className="absolute right-3 top-3 z-10 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1.5 text-[10px] font-black leading-none text-white shadow-sm ring-2 ring-white" aria-label="New update">
          1
        </span>
      )}
      <div className="relative flex min-w-0 items-start gap-3">
        <span
          className={cx(
            'mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg shadow-sm ring-1 ring-black/5 transition-all duration-150 group-hover:scale-[1.03]',
            surface.headerIcon
          )}
          aria-hidden
        >
          <FileText className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center text-[11px] font-medium leading-none text-slate-500">
              <CalendarDays className="mr-1 h-3 w-3 text-slate-400" />
              {formatDate(row.occurredAt)}
            </span>
          </div>
          <p className="truncate text-sm font-bold leading-snug text-slate-900">
            {row.borrowerName}
          </p>
          <p className="truncate text-xs font-medium text-slate-500">
            {row.loanNumber}
          </p>
        </div>
      </div>

      <div className="relative mt-3 border-t border-slate-200/80 pt-3">
        <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
          <span className={cx('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', MILESTONE_TONES[row.milestone])}>
            {row.milestoneLabel}
          </span>
          {queueStage && (
            <span className={cx('inline-flex min-w-0 max-w-full items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', updateSignalClassName(queueStage.tone))}>
              <span className="truncate">{queueStage.label}</span>
            </span>
          )}
        </div>

        <div className="mt-2 flex min-w-0 items-center gap-1.5 overflow-hidden">
          <span className="inline-flex shrink-0 items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-700">
            {formatCurrency(row.amount)}
          </span>
          <span className="inline-flex min-w-0 max-w-full items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-700">
            <span className="truncate">{teamLabel}</span>
          </span>
        </div>
      </div>

      <div className="relative mt-auto flex items-center justify-between gap-2 pt-3 text-[11px] font-semibold text-slate-400">
        <span className="truncate">
          Click to open borrower details
        </span>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 transition group-hover:translate-x-0.5" />
      </div>
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
  const taskNotes = row.fileDetails.task?.notes || [];
  const checklistItems = row.fileDetails.task?.checklistItems || [];
  const taskQueueStage = row.fileDetails.task?.queueStage || null;
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

            {(signal || row.fileDetails.task || row.fileDetails.payroll) && (
              <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-slate-950">
                      {row.fileDetails.payroll ? 'Payroll Review' : 'Task Review'}
                    </h3>
                    <p className="mt-1 text-sm font-medium text-slate-500">
                      {row.fileDetails.payroll
                        ? 'Review manager notes, approval, payment, or revision status.'
                        : 'Latest notes and missing items from the Tasks queue.'}
                    </p>
                  </div>
                  {signal && (
                    <span className={cx('inline-flex shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold', updateSignalClassName(signal.tone))}>
                      {signal.label}
                    </span>
                  )}
                </div>

                {taskQueueStage && (
                  <div className={cx('mt-4 rounded-xl border px-3.5 py-3', updateSignalClassName(taskQueueStage.tone))}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-bold">{taskQueueStage.label}</p>
                      <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                        Current Queue
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm font-medium leading-relaxed">
                      {taskQueueStage.description}
                    </p>
                  </div>
                )}

                {checklistItems.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                      Missing / Needed
                    </p>
                    {checklistItems.map((item) => (
                      <div key={`${item.label}-${item.status}`} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-800">{item.label}</span>
                          <span className={cx('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', checklistStatusClassName(item.status))}>
                            {formatStatus(item.status)}
                          </span>
                        </div>
                        {item.note && (
                          <p className="mt-1.5 text-xs font-medium text-slate-600">{item.note}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {taskNotes.length > 0 ? (
                  <div className="mt-4 space-y-3">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                      Task Notes
                    </p>
                    {taskNotes.slice(0, 4).map((note) => (
                      <div key={`${note.date}-${note.author}-${note.message}`} className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-bold text-slate-800">{note.author}</p>
                          <span className="text-[11px] font-semibold text-slate-400">{formatDateTime(note.date)}</span>
                        </div>
                        <p className="mt-2 text-sm font-medium leading-relaxed text-slate-700">{note.message}</p>
                      </div>
                    ))}
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={onReviewUpdate}
                  disabled={!row.fileDetails.task && !row.fileDetails.payroll}
                  className="mt-4 inline-flex h-9 w-full items-center justify-center rounded-lg bg-slate-950 px-3 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {reviewLabel}
                </button>
              </section>
            )}
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

