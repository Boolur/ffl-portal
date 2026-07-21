'use client';

import React, { useMemo, useState, useTransition } from 'react';
import {
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  ClipboardCheck,
  FileText,
  Home,
  Loader2,
  Medal,
  RefreshCw,
  RotateCcw,
  Trophy,
  X,
} from 'lucide-react';
import {
  getLeaderboardReport,
  type LeaderboardDetailRow,
  type LeaderboardOfficerRow,
  type LeaderboardRangePreset,
  type LeaderboardReport,
  type LeaderboardReportFilters,
} from '@/app/actions/leaderboardActions';
import {
  ResizeHandle,
  useColumnWidths,
} from '@/components/admin/leads/shared/columnCustomization';

type Props = {
  initialReport: LeaderboardReport;
};

type SortDirection = 'asc' | 'desc';
type SortKey =
  | 'loanOfficerName'
  | 'plusOne.volume'
  | 'plusOne.units'
  | 'plusOne.revenue'
  | 'disclosures.volume'
  | 'disclosures.units'
  | 'processing.volume'
  | 'processing.units'
  | 'processing.revenue'
  | 'fundings.volume'
  | 'fundings.units'
  | 'fundings.revenue';
type LeaderboardColumnId = SortKey;

const PRESETS: Array<{ value: LeaderboardRangePreset; label: string }> = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'ytd', label: 'YTD' },
  { value: 'allTime', label: 'All Time' },
  { value: 'custom', label: 'Date Range' },
];

const LEADERBOARD_COLUMNS: Array<{
  id: LeaderboardColumnId;
  label: string;
  defaultWidth: number;
  minWidth: number;
  align: 'left' | 'right';
}> = [
  { id: 'loanOfficerName', label: 'Loan Officer', defaultWidth: 290, minWidth: 220, align: 'left' },
  { id: 'plusOne.volume', label: 'Volume', defaultWidth: 140, minWidth: 118, align: 'right' },
  { id: 'plusOne.units', label: 'Units', defaultWidth: 86, minWidth: 74, align: 'right' },
  { id: 'plusOne.revenue', label: 'Revenue', defaultWidth: 128, minWidth: 112, align: 'right' },
  { id: 'disclosures.volume', label: 'Volume', defaultWidth: 140, minWidth: 118, align: 'right' },
  { id: 'disclosures.units', label: 'Units', defaultWidth: 86, minWidth: 74, align: 'right' },
  { id: 'processing.volume', label: 'Volume', defaultWidth: 150, minWidth: 122, align: 'right' },
  { id: 'processing.units', label: 'Units', defaultWidth: 86, minWidth: 74, align: 'right' },
  { id: 'processing.revenue', label: 'Revenue', defaultWidth: 128, minWidth: 112, align: 'right' },
  { id: 'fundings.volume', label: 'Volume', defaultWidth: 140, minWidth: 118, align: 'right' },
  { id: 'fundings.units', label: 'Units', defaultWidth: 86, minWidth: 74, align: 'right' },
  { id: 'fundings.revenue', label: 'Revenue', defaultWidth: 128, minWidth: 112, align: 'right' },
];

const LEADERBOARD_COLUMN_WIDTHS_KEY = 'ffl:leaderboard-column-widths:v1';
const PORTAL_TIME_ZONE = 'America/Los_Angeles';

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function dateInputValue(value: string) {
  return value.slice(0, 10);
}

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

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: PORTAL_TIME_ZONE,
  }).format(new Date(value));
}

function formatDateTime(value: string) {
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
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'LO'
  );
}

function compareText(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

function sortMultiplier(direction: SortDirection) {
  return direction === 'asc' ? 1 : -1;
}

function sortValue(row: LeaderboardOfficerRow, key: SortKey) {
  if (key === 'loanOfficerName') return row.loanOfficerName;
  const [milestone, field] = key.split('.') as [
    'plusOne' | 'disclosures' | 'processing' | 'fundings',
    'volume' | 'units' | 'revenue',
  ];
  return row[milestone][field];
}

function activityTotal(row: LeaderboardOfficerRow) {
  return row.plusOne.units + row.disclosures.units + row.processing.units + row.fundings.units;
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  direction,
  align = 'right',
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  direction: SortDirection;
  align?: 'left' | 'right';
  onSort: (key: SortKey) => void;
}) {
  const active = sortKey === activeKey;

  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={cx(
        'inline-flex items-center gap-1 rounded-md px-1 py-0.5 font-bold transition hover:bg-slate-100 hover:text-slate-700',
        align === 'right' && 'ml-auto',
        active ? 'text-slate-900' : 'text-slate-500'
      )}
      aria-label={`Sort by ${label}`}
    >
      {label}
      <ChevronDown
        className={cx(
          'h-3 w-3 transition',
          active ? 'opacity-100' : 'opacity-0',
          active && direction === 'asc' && 'rotate-180'
        )}
      />
    </button>
  );
}

function ResizableHeaderCell({
  column,
  activeKey,
  direction,
  onSort,
  onStartResize,
  isResizing,
  rowSpan,
  groupStart = false,
}: {
  column: (typeof LEADERBOARD_COLUMNS)[number];
  activeKey: SortKey;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
  onStartResize: (event: React.MouseEvent) => void;
  isResizing: boolean;
  rowSpan?: number;
  groupStart?: boolean;
}) {
  return (
    <th
      rowSpan={rowSpan}
      className={cx(
        'relative overflow-hidden px-4 py-3 align-bottom',
        column.align === 'right' ? 'text-right' : 'text-left',
        groupStart && 'border-l border-slate-200'
      )}
    >
      <SortHeader
        label={column.label}
        sortKey={column.id}
        activeKey={activeKey}
        direction={direction}
        align={column.align}
        onSort={onSort}
      />
      <ResizeHandle
        label={column.label}
        onStartResize={onStartResize}
        isResizing={isResizing}
      />
    </th>
  );
}

function KpiCard({
  title,
  value,
  subtitle,
  tone,
  Icon,
}: {
  title: string;
  value: string;
  subtitle: string;
  tone: 'emerald' | 'blue' | 'purple' | 'amber';
  Icon: React.ComponentType<{ className?: string }>;
}) {
  const tones = {
    emerald: 'border-emerald-100 from-emerald-50/90 text-emerald-950',
    blue: 'border-blue-100 from-blue-50/90 text-blue-950',
    purple: 'border-purple-100 from-purple-50/90 text-purple-950',
    amber: 'border-amber-100 from-amber-50/90 text-amber-950',
  };
  const iconTones = {
    emerald: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
    blue: 'bg-blue-100 text-blue-700 ring-blue-200',
    purple: 'bg-purple-100 text-purple-700 ring-purple-200',
    amber: 'bg-amber-100 text-amber-700 ring-amber-200',
  };

  return (
    <div className={cx('rounded-2xl border bg-gradient-to-br via-white to-white p-4 shadow-sm shadow-slate-200/50', tones[tone])}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] opacity-75">{title}</p>
          <p className="mt-2 text-2xl font-bold tracking-tight">{value}</p>
          <p className="mt-1 text-xs font-medium opacity-70">{subtitle}</p>
        </div>
        <div className={cx('flex h-9 w-9 items-center justify-center rounded-xl ring-1', iconTones[tone])}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

function MetricCells({ row, metric }: { row: LeaderboardOfficerRow; metric: 'plusOne' | 'disclosures' | 'processing' | 'fundings' }) {
  const groupStartClass = 'border-l border-slate-200';
  const numberClass = 'overflow-hidden whitespace-nowrap px-4 py-4 text-right tabular-nums';
  return (
    <>
      <td className={cx(numberClass, groupStartClass, 'font-bold text-slate-900')}>
        {formatCurrency(row[metric].volume)}
      </td>
      <td className={cx(numberClass, 'text-slate-600')}>
        {formatNumber(row[metric].units)}
      </td>
      {(metric === 'plusOne' || metric === 'processing' || metric === 'fundings') && (
        <td className={cx(numberClass, 'text-slate-600')}>
          {formatCurrency(row[metric].revenue)}
        </td>
      )}
    </>
  );
}

export function LeaderboardPage({ initialReport }: Props) {
  const [report, setReport] = useState(initialReport);
  const [preset, setPreset] = useState<LeaderboardRangePreset>(initialReport.filters.preset);
  const [startDate, setStartDate] = useState(dateInputValue(initialReport.filters.startDate));
  const [endDate, setEndDate] = useState(dateInputValue(initialReport.filters.endDate));
  const [selectedOfficerId, setSelectedOfficerId] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({
    key: 'plusOne.volume',
    direction: 'desc',
  });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const {
    widths: columnWidths,
    resizingCol,
    startResize,
    reset: resetColumnWidths,
  } = useColumnWidths<LeaderboardColumnId>(
    LEADERBOARD_COLUMNS,
    LEADERBOARD_COLUMN_WIDTHS_KEY
  );

  const sortedRows = useMemo(() => {
    const multiplier = sortMultiplier(sort.direction);
    return [...report.rows].sort((a, b) => {
      const aValue = sortValue(a, sort.key);
      const bValue = sortValue(b, sort.key);
      const primary =
        typeof aValue === 'string' && typeof bValue === 'string'
          ? compareText(aValue, bValue)
          : Number(aValue) - Number(bValue);
      if (primary !== 0) return primary * multiplier;
      return compareText(a.loanOfficerName, b.loanOfficerName);
    });
  }, [report.rows, sort.direction, sort.key]);

  const selectedOfficer = selectedOfficerId
    ? report.rows.find((row) => row.loanOfficerId === selectedOfficerId) || null
    : null;

  const selectedOfficerDetails = useMemo(() => {
    if (!selectedOfficerId) return [];
    return report.detailRows.filter((row) => row.creditedLoanOfficerId === selectedOfficerId);
  }, [report.detailRows, selectedOfficerId]);

  const tableWidth = useMemo(
    () => LEADERBOARD_COLUMNS.reduce((sum, column) => sum + columnWidths[column.id], 0),
    [columnWidths]
  );

  function updateSort(key: SortKey) {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc',
    }));
  }

  function loadReport(nextFilters?: Partial<LeaderboardReportFilters>) {
    const filters: LeaderboardReportFilters = {
      preset,
      startDate,
      endDate,
      ...nextFilters,
    };

    startTransition(async () => {
      setError(null);
      try {
        const nextReport = await getLeaderboardReport(filters);
        setReport(nextReport);
        setPreset(nextReport.filters.preset);
        setStartDate(dateInputValue(nextReport.filters.startDate));
        setEndDate(dateInputValue(nextReport.filters.endDate));
        setSelectedOfficerId(null);
      } catch (err) {
        console.error(err);
        setError('Unable to load Leaderboard metrics. Please try again.');
      }
    });
  }

  function handlePresetChange(nextPreset: LeaderboardRangePreset) {
    setPreset(nextPreset);
    if (nextPreset !== 'custom') {
      loadReport({ preset: nextPreset });
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1700px] space-y-6">
      <div className="app-page-header flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-100 bg-amber-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-amber-700">
            <Trophy className="h-3.5 w-3.5" />
            Leaderboard
          </div>
          <h1 className="app-page-title mt-3">Leaderboard</h1>
          <p className="app-page-subtitle max-w-3xl">
            Rank loan officer production by +1s, disclosures, processing submissions, and fundings. Secondary LOs receive credit when assigned.
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

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="+1 Volume"
          value={formatCurrency(report.totals.plusOne.volume)}
          subtitle={`${formatNumber(report.totals.plusOne.units)} units / ${formatCurrency(report.totals.plusOne.revenue)} revenue`}
          Icon={Home}
          tone="emerald"
        />
        <KpiCard
          title="Disclosure Volume"
          value={formatCurrency(report.totals.disclosures.volume)}
          subtitle={`${formatNumber(report.totals.disclosures.units)} submitted disclosures`}
          Icon={ClipboardCheck}
          tone="blue"
        />
        <KpiCard
          title="Processing/QC Volume"
          value={formatCurrency(report.totals.processing.volume)}
          subtitle={`${formatNumber(report.totals.processing.units)} units / ${formatCurrency(report.totals.processing.revenue)} revenue`}
          Icon={FileText}
          tone="purple"
        />
        <KpiCard
          title="Funding Volume"
          value={formatCurrency(report.totals.fundings.volume)}
          subtitle={`${formatNumber(report.totals.fundings.units)} units / ${formatCurrency(report.totals.fundings.revenue)} revenue`}
          Icon={CircleDollarSign}
          tone="amber"
        />
      </section>

      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm shadow-slate-200/70">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-slate-950">
              <Medal className="h-5 w-5 text-amber-600" />
              Production leaderboard
            </h2>
            <p className="mt-1 text-sm font-medium text-slate-500">
              {formatDate(report.filters.startDate)} - {formatDate(report.filters.endDate)}. Click a loan officer to view credited loans.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={resetColumnWidths}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
              title="Reset leaderboard column widths"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset columns
            </button>
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-500">
              <CalendarDays className="h-3.5 w-3.5" />
              Generated {formatDateTime(report.generatedAt)}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ tableLayout: 'fixed', minWidth: `${tableWidth}px` }}>
            <colgroup>
              {LEADERBOARD_COLUMNS.map((column) => (
                <col key={column.id} style={{ width: `${columnWidths[column.id]}px` }} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-[1] bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <tr className="border-b border-slate-100">
                <ResizableHeaderCell
                  column={LEADERBOARD_COLUMNS[0]}
                  activeKey={sort.key}
                  direction={sort.direction}
                  onSort={updateSort}
                  onStartResize={startResize('loanOfficerName', LEADERBOARD_COLUMNS[0].minWidth)}
                  isResizing={resizingCol === 'loanOfficerName'}
                  rowSpan={2}
                />
                <th colSpan={3} className="border-l border-slate-200 bg-emerald-50/60 px-4 py-2 text-center text-emerald-700">
                  +1s
                </th>
                <th colSpan={2} className="border-l border-slate-200 bg-blue-50/60 px-4 py-2 text-center text-blue-700">
                  Disclosures
                </th>
                <th colSpan={3} className="border-l border-slate-200 bg-purple-50/60 px-4 py-2 text-center text-purple-700">
                  Submitted to Processing/QC
                </th>
                <th colSpan={3} className="border-l border-slate-200 bg-amber-50/60 px-4 py-2 text-center text-amber-700">
                  Fundings
                </th>
              </tr>
              <tr className="border-b border-slate-200">
                {LEADERBOARD_COLUMNS.slice(1).map((column) => (
                  <ResizableHeaderCell
                    key={column.id}
                    column={column}
                    activeKey={sort.key}
                    direction={sort.direction}
                    onSort={updateSort}
                    onStartResize={startResize(column.id, column.minWidth)}
                    isResizing={resizingCol === column.id}
                    groupStart={
                      column.id === 'plusOne.volume' ||
                      column.id === 'disclosures.volume' ||
                      column.id === 'processing.volume' ||
                      column.id === 'fundings.volume'
                    }
                  />
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedRows.map((row, index) => {
                const isStriped = index % 2 === 0;
                const rowSurface = isStriped ? 'bg-slate-50/55' : 'bg-white';
                const stickySurface = isStriped ? 'bg-slate-50' : 'bg-white';
                return (
                <tr key={row.loanOfficerId} className={cx(rowSurface, 'transition-colors hover:bg-blue-50/40')}>
                  <td className={cx('sticky left-0 z-[1] overflow-hidden px-4 py-4 shadow-[1px_0_0_#e2e8f0]', stickySurface)}>
                    <button
                      type="button"
                      onClick={() => setSelectedOfficerId(row.loanOfficerId)}
                      className="flex w-full min-w-0 items-center gap-3 rounded-xl text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xs font-bold text-slate-600 ring-1 ring-slate-200">
                        {index + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-bold text-slate-950">{row.loanOfficerName}</span>
                        <span className="block truncate text-xs font-medium text-slate-500">
                          {row.loanOfficerEmail} / {formatNumber(activityTotal(row))} total units
                        </span>
                      </span>
                    </button>
                  </td>
                  <MetricCells row={row} metric="plusOne" />
                  <MetricCells row={row} metric="disclosures" />
                  <MetricCells row={row} metric="processing" />
                  <MetricCells row={row} metric="fundings" />
                </tr>
                );
              })}
              {sortedRows.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-5 py-12 text-center text-sm text-slate-500">
                    No loan officers are available for this leaderboard.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selectedOfficer && (
        <OfficerDetailsModal
          officer={selectedOfficer}
          rows={selectedOfficerDetails}
          rangeLabel={`${formatDate(report.filters.startDate)} - ${formatDate(report.filters.endDate)}`}
          onClose={() => setSelectedOfficerId(null)}
        />
      )}
    </div>
  );
}

function OfficerDetailsModal({
  officer,
  rows,
  rangeLabel,
  onClose,
}: {
  officer: LeaderboardOfficerRow;
  rows: LeaderboardDetailRow[];
  rangeLabel: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/45 p-4"
      onClick={onClose}
      data-live-refresh-pause="true"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${officer.loanOfficerName} leaderboard details`}
        className="max-h-[90vh] w-full max-w-6xl overflow-hidden rounded-[24px] border border-slate-200/70 bg-slate-50 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-6 border-b border-slate-200/70 bg-white px-6 py-5">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 text-lg font-bold text-white shadow-lg shadow-blue-600/20 ring-4 ring-white">
              {initials(officer.loanOfficerName)}
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-2xl font-extrabold tracking-tight text-slate-950">
                {officer.loanOfficerName}
              </h2>
              <p className="mt-1 text-sm font-medium text-slate-500">
                {officer.loanOfficerEmail} / {rangeLabel}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 transition hover:bg-slate-50 hover:text-slate-600 hover:shadow-sm"
            aria-label="Close loan officer details"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-4 border-b border-slate-200/70 bg-slate-50 px-6 py-5 md:grid-cols-4">
          <MiniMetric title="+1s" value={formatCurrency(officer.plusOne.volume)} detail={`${formatNumber(officer.plusOne.units)} units`} />
          <MiniMetric title="Disclosures" value={formatCurrency(officer.disclosures.volume)} detail={`${formatNumber(officer.disclosures.units)} units`} />
          <MiniMetric title="Processing/QC" value={formatCurrency(officer.processing.volume)} detail={`${formatNumber(officer.processing.units)} units`} />
          <MiniMetric title="Fundings" value={formatCurrency(officer.fundings.volume)} detail={`${formatNumber(officer.fundings.units)} units`} />
        </div>

        <div className="max-h-[56vh] overflow-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="sticky top-0 z-[1] bg-slate-100 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3 text-left">Loan</th>
                <th className="px-5 py-3 text-left">Milestone</th>
                <th className="px-5 py-3 text-right">Volume</th>
                <th className="px-5 py-3 text-right">Revenue</th>
                <th className="px-5 py-3 text-left">Details</th>
                <th className="px-5 py-3 text-left">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.map((row) => (
                <tr key={`${row.milestone}:${row.id}`} className="hover:bg-slate-50/70">
                  <td className="px-5 py-4">
                    <p className="font-bold text-slate-950">{row.borrowerName}</p>
                    <p className="mt-1 font-mono text-xs font-semibold text-slate-500">{row.loanNumber}</p>
                  </td>
                  <td className="px-5 py-4">
                    <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-700">
                      {row.milestoneLabel}
                    </span>
                    <p className="mt-1 text-xs font-medium text-slate-500">{formatStatus(row.status)}</p>
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 text-right font-bold text-slate-900">
                    {formatCurrency(row.amount)}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 text-right text-slate-600">
                    {formatCurrency(row.revenue)}
                  </td>
                  <td className="px-5 py-4 text-slate-600">
                    <p className="font-semibold text-slate-800">
                      {row.lender || row.leadSource || row.program || 'N/A'}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Primary: {row.primaryLoanOfficerName || 'N/A'} / Secondary: {row.secondaryLoanOfficerName || 'N/A'}
                    </p>
                    {row.propertyAddress && (
                      <p className="mt-1 max-w-[260px] truncate text-xs text-slate-500">{row.propertyAddress}</p>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 text-xs font-medium text-slate-500">
                    {formatDateTime(row.occurredAt)}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-sm text-slate-500">
                    No credited loans matched this loan officer for the selected range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MiniMetric({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">{title}</p>
      <p className="mt-1 text-lg font-bold text-slate-950">{value}</p>
      <p className="mt-0.5 text-xs font-medium text-slate-500">{detail}</p>
    </div>
  );
}
