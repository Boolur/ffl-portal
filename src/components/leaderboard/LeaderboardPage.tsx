'use client';

import React, { useMemo, useState, useTransition } from 'react';
import {
  ChevronDown,
  CircleDollarSign,
  ClipboardCheck,
  Download,
  Edit3,
  FileText,
  Home,
  Loader2,
  Medal,
  FileSpreadsheet,
  RefreshCw,
  RotateCcw,
  Trophy,
  Users2,
  X,
} from 'lucide-react';
import {
  getLeaderboardReport,
  updateLeaderboardLoanDetails,
  type LeaderboardDetailRow,
  type LeaderboardEditInput,
  type LeaderboardLeadSourceRow,
  type LeaderboardLenderRow,
  type LeaderboardLoanOfficerOption,
  type LeaderboardMilestoneKey,
  type LeaderboardOfficerRow,
  type LeaderboardRangePreset,
  type LeaderboardReport,
  type LeaderboardReportFilters,
} from '@/app/actions/leaderboardActions';
import {
  ResizeHandle,
  useColumnWidths,
} from '@/components/admin/leads/shared/columnCustomization';
import {
  teamColorClasses,
} from '@/components/admin/leads/LeadUserTeamManager';

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
type LeaderboardView = 'loanOfficers' | 'lenders' | 'leadSources';
type DisplayLeaderboardRow = {
  id: string;
  label: string;
  subLabel: string;
  source: LeaderboardView;
  plusOne: LeaderboardOfficerRow['plusOne'];
  disclosures: LeaderboardOfficerRow['disclosures'];
  processing: LeaderboardOfficerRow['processing'];
  fundings: LeaderboardOfficerRow['fundings'];
};

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
  align: 'left' | 'center' | 'right';
}> = [
  { id: 'loanOfficerName', label: 'Loan Officer', defaultWidth: 290, minWidth: 220, align: 'left' },
  { id: 'plusOne.volume', label: 'Volume', defaultWidth: 140, minWidth: 118, align: 'center' },
  { id: 'plusOne.units', label: 'Units', defaultWidth: 86, minWidth: 74, align: 'center' },
  { id: 'plusOne.revenue', label: 'Revenue', defaultWidth: 128, minWidth: 112, align: 'center' },
  { id: 'disclosures.volume', label: 'Volume', defaultWidth: 140, minWidth: 118, align: 'center' },
  { id: 'disclosures.units', label: 'Units', defaultWidth: 86, minWidth: 74, align: 'center' },
  { id: 'processing.volume', label: 'Volume', defaultWidth: 150, minWidth: 122, align: 'center' },
  { id: 'processing.units', label: 'Units', defaultWidth: 86, minWidth: 74, align: 'center' },
  { id: 'processing.revenue', label: 'Revenue', defaultWidth: 128, minWidth: 112, align: 'center' },
  { id: 'fundings.volume', label: 'Volume', defaultWidth: 140, minWidth: 118, align: 'center' },
  { id: 'fundings.units', label: 'Units', defaultWidth: 86, minWidth: 74, align: 'center' },
  { id: 'fundings.revenue', label: 'Revenue', defaultWidth: 128, minWidth: 112, align: 'center' },
];

const LEADERBOARD_COLUMN_WIDTHS_KEY = 'ffl:leaderboard-column-widths:v1';
const PORTAL_TIME_ZONE = 'America/Los_Angeles';
const LEAD_SOURCE_EDIT_OPTIONS = [
  'Lead Buy',
  'Mailer',
  'Warm Transfer',
  'Referral',
  'Return Client',
  'Self Generated',
  'Other',
];

const MILESTONE_TONES = {
  plusOne: 'border-emerald-300 bg-emerald-100 text-emerald-800',
  disclosures: 'border-blue-300 bg-blue-100 text-blue-800',
  processing: 'border-purple-300 bg-purple-100 text-purple-800',
  fundings: 'border-amber-300 bg-amber-100 text-amber-800',
} satisfies Record<LeaderboardDetailRow['milestone'], string>;

const DETAIL_MILESTONE_LABELS = {
  plusOne: '+1s',
  disclosures: 'Disclosures',
  processing: 'Processing/QC',
  fundings: 'Fundings',
} satisfies Record<LeaderboardMilestoneKey, string>;

const MODAL_METRIC_TONES = {
  plusOne: {
    card: 'border-emerald-100 bg-gradient-to-br from-emerald-50/90 via-white to-white',
    activeCard: 'border-emerald-300 bg-emerald-600 text-white shadow-lg shadow-emerald-200/70 ring-2 ring-emerald-200',
    label: 'text-emerald-700',
    value: 'text-emerald-950',
    activeLabel: 'text-emerald-50',
    activeValue: 'text-white',
    activeDetail: 'text-emerald-50/85',
  },
  disclosures: {
    card: 'border-blue-100 bg-gradient-to-br from-blue-50/90 via-white to-white',
    activeCard: 'border-blue-300 bg-blue-600 text-white shadow-lg shadow-blue-200/70 ring-2 ring-blue-200',
    label: 'text-blue-700',
    value: 'text-blue-950',
    activeLabel: 'text-blue-50',
    activeValue: 'text-white',
    activeDetail: 'text-blue-50/85',
  },
  processing: {
    card: 'border-purple-100 bg-gradient-to-br from-purple-50/90 via-white to-white',
    activeCard: 'border-purple-300 bg-purple-600 text-white shadow-lg shadow-purple-200/70 ring-2 ring-purple-200',
    label: 'text-purple-700',
    value: 'text-purple-950',
    activeLabel: 'text-purple-50',
    activeValue: 'text-white',
    activeDetail: 'text-purple-50/85',
  },
  fundings: {
    card: 'border-amber-100 bg-gradient-to-br from-amber-50/90 via-white to-white',
    activeCard: 'border-amber-300 bg-amber-500 text-white shadow-lg shadow-amber-200/70 ring-2 ring-amber-200',
    label: 'text-amber-700',
    value: 'text-amber-950',
    activeLabel: 'text-amber-50',
    activeValue: 'text-white',
    activeDetail: 'text-amber-50/85',
  },
} satisfies Record<'plusOne' | 'disclosures' | 'processing' | 'fundings', {
  card: string;
  activeCard: string;
  label: string;
  value: string;
  activeLabel: string;
  activeValue: string;
  activeDetail: string;
}>;

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

function moneyInputValue(value: number | null) {
  if (value === null) return '';
  return String(Math.round(value * 100) / 100);
}

function excelEscape(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function excelMoneyCell(value: number) {
  return `<td class="money">${Math.round(value * 100) / 100}</td>`;
}

function excelNumberCell(value: number) {
  return `<td class="number">${value}</td>`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function exportLoanOfficerLeaderboard(report: LeaderboardReport) {
  const start = dateInputValue(report.filters.startDate);
  const end = dateInputValue(report.filters.endDate);
  const generatedAt = formatDateTime(report.generatedAt);
  const rows = [...report.rows].sort(
    (a, b) =>
      b.plusOne.volume - a.plusOne.volume ||
      b.plusOne.units - a.plusOne.units ||
      a.loanOfficerName.localeCompare(b.loanOfficerName)
  );
  const totals = rows.reduce(
    (sum, row) => {
      sum.plusOne.volume += row.plusOne.volume;
      sum.plusOne.units += row.plusOne.units;
      sum.plusOne.revenue += row.plusOne.revenue;
      sum.disclosures.volume += row.disclosures.volume;
      sum.disclosures.units += row.disclosures.units;
      sum.processing.volume += row.processing.volume;
      sum.processing.units += row.processing.units;
      sum.processing.revenue += row.processing.revenue;
      sum.fundings.volume += row.fundings.volume;
      sum.fundings.units += row.fundings.units;
      sum.fundings.revenue += row.fundings.revenue;
      return sum;
    },
    {
      plusOne: { volume: 0, units: 0, revenue: 0 },
      disclosures: { volume: 0, units: 0 },
      processing: { volume: 0, units: 0, revenue: 0 },
      fundings: { volume: 0, units: 0, revenue: 0 },
    }
  );

  const bodyRows = rows.map((row, index) => `
    <tr class="${index % 2 === 0 ? 'row-white' : 'row-muted'}">
      <td class="rank">${index + 1}</td>
      <td class="name">${excelEscape(row.loanOfficerName)}</td>
      <td class="email">${excelEscape(row.loanOfficerEmail)}</td>
      ${excelMoneyCell(row.plusOne.volume)}
      ${excelNumberCell(row.plusOne.units)}
      ${excelMoneyCell(row.plusOne.revenue)}
      ${excelMoneyCell(row.disclosures.volume)}
      ${excelNumberCell(row.disclosures.units)}
      ${excelMoneyCell(row.processing.volume)}
      ${excelNumberCell(row.processing.units)}
      ${excelMoneyCell(row.processing.revenue)}
      ${excelMoneyCell(row.fundings.volume)}
      ${excelNumberCell(row.fundings.units)}
      ${excelMoneyCell(row.fundings.revenue)}
    </tr>
  `).join('');

  const workbookHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    table { border-collapse: collapse; font-family: Calibri, Arial, sans-serif; font-size: 11pt; }
    th, td { border: 1px solid #cbd5e1; padding: 8px 10px; }
    .title { background: #0f172a; color: #ffffff; font-size: 18pt; font-weight: 800; text-align: left; }
    .subtitle { background: #e2e8f0; color: #334155; font-weight: 700; text-align: left; }
    .group { color: #ffffff; font-weight: 800; text-align: center; }
    .plus-one { background: #047857; }
    .disclosures { background: #1d4ed8; }
    .processing { background: #7e22ce; }
    .fundings { background: #b45309; }
    .column { background: #f8fafc; color: #475569; font-weight: 800; text-align: center; }
    .rank { background: #f1f5f9; color: #0f172a; font-weight: 800; text-align: center; }
    .name { color: #0f172a; font-weight: 800; min-width: 190px; }
    .email { color: #64748b; min-width: 220px; }
    .money { mso-number-format:"$#,##0"; text-align: right; font-weight: 700; }
    .number { mso-number-format:"0"; text-align: center; font-weight: 700; }
    .total { background: #dbeafe; color: #0f172a; font-weight: 900; }
    .row-white { background: #ffffff; }
    .row-muted { background: #f8fafc; }
  </style>
</head>
<body>
  <table>
    <tr><th class="title" colspan="14">Federal First Lending - Loan Officer Production Leaderboard</th></tr>
    <tr><td class="subtitle" colspan="14">Range: ${excelEscape(formatDate(report.filters.startDate))} - ${excelEscape(formatDate(report.filters.endDate))} &nbsp; | &nbsp; Generated: ${excelEscape(generatedAt)}</td></tr>
    <tr>
      <th class="column" rowspan="2">Rank</th>
      <th class="column" rowspan="2">Loan Officer</th>
      <th class="column" rowspan="2">Email</th>
      <th class="group plus-one" colspan="3">+1s</th>
      <th class="group disclosures" colspan="2">Disclosures</th>
      <th class="group processing" colspan="3">Submitted to Processing/QC</th>
      <th class="group fundings" colspan="3">Fundings</th>
    </tr>
    <tr>
      <th class="column">Volume</th>
      <th class="column">Units</th>
      <th class="column">Revenue</th>
      <th class="column">Volume</th>
      <th class="column">Units</th>
      <th class="column">Volume</th>
      <th class="column">Units</th>
      <th class="column">Revenue</th>
      <th class="column">Volume</th>
      <th class="column">Units</th>
      <th class="column">Revenue</th>
    </tr>
    <tr class="total">
      <td class="rank">Total</td>
      <td class="name">All Loan Officers</td>
      <td class="email">${rows.length} loan officers</td>
      ${excelMoneyCell(totals.plusOne.volume)}
      ${excelNumberCell(totals.plusOne.units)}
      ${excelMoneyCell(totals.plusOne.revenue)}
      ${excelMoneyCell(totals.disclosures.volume)}
      ${excelNumberCell(totals.disclosures.units)}
      ${excelMoneyCell(totals.processing.volume)}
      ${excelNumberCell(totals.processing.units)}
      ${excelMoneyCell(totals.processing.revenue)}
      ${excelMoneyCell(totals.fundings.volume)}
      ${excelNumberCell(totals.fundings.units)}
      ${excelMoneyCell(totals.fundings.revenue)}
    </tr>
    ${bodyRows}
  </table>
</body>
</html>`;

  downloadBlob(
    new Blob([workbookHtml], { type: 'application/vnd.ms-excel;charset=utf-8;' }),
    `loan-officer-leaderboard-${start}-to-${end}.xls`
  );
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

function sortValue(row: DisplayLeaderboardRow, key: SortKey) {
  if (key === 'loanOfficerName') return row.label;
  const [milestone, field] = key.split('.') as [
    'plusOne' | 'disclosures' | 'processing' | 'fundings',
    'volume' | 'units' | 'revenue',
  ];
  return row[milestone][field];
}

function emptyMetric() {
  return { volume: 0, units: 0, revenue: 0 };
}

function totalMetric(rows: Array<Pick<DisplayLeaderboardRow, 'plusOne' | 'disclosures' | 'processing' | 'fundings'>>, metric: 'plusOne' | 'disclosures' | 'processing' | 'fundings') {
  return rows.reduce(
    (total, row) => {
      total.volume += row[metric].volume;
      total.units += row[metric].units;
      total.revenue += row[metric].revenue;
      return total;
    },
    emptyMetric()
  );
}

function renderTeamDots(colors: string[] | undefined) {
  const safe = (colors && colors.length > 0 ? colors : ['blue']).slice(0, 3);
  return (
    <span className="inline-flex shrink-0 items-center -space-x-0.5">
      {safe.map((color, index) => (
        <span
          key={`${color}-${index}`}
          className={cx(
            'inline-block h-2 w-2 rounded-full ring-1 ring-white',
            teamColorClasses(color).dot
          )}
        />
      ))}
    </span>
  );
}

function rankBadgeClassName(index: number) {
  const base = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-extrabold ring-1 transition';
  if (index === 0) {
    return cx(
      base,
      'bg-gradient-to-br from-amber-200 via-yellow-100 to-amber-300 text-amber-950 shadow-sm shadow-amber-200/70 ring-amber-300 motion-safe:animate-pulse'
    );
  }
  if (index === 1) {
    return cx(
      base,
      'bg-gradient-to-br from-slate-200 via-white to-slate-300 text-slate-800 shadow-sm shadow-slate-200/70 ring-slate-300 motion-safe:animate-pulse'
    );
  }
  if (index === 2) {
    return cx(
      base,
      'bg-gradient-to-br from-orange-200 via-amber-50 to-orange-300 text-orange-950 shadow-sm shadow-orange-200/70 ring-orange-300 motion-safe:animate-pulse'
    );
  }
  return cx(base, 'bg-slate-100 text-slate-600 ring-slate-200');
}

function toOfficerDisplayRow(row: LeaderboardOfficerRow): DisplayLeaderboardRow {
  return {
    id: row.loanOfficerId,
    label: row.loanOfficerName,
    subLabel: row.loanOfficerEmail,
    source: 'loanOfficers',
    plusOne: row.plusOne,
    disclosures: row.disclosures,
    processing: row.processing,
    fundings: row.fundings,
  };
}

function toLenderDisplayRow(row: LeaderboardLenderRow): DisplayLeaderboardRow {
  return {
    id: row.lenderKey,
    label: row.lenderName,
    subLabel: 'Lender / Investor',
    source: 'lenders',
    plusOne: row.plusOne,
    disclosures: row.disclosures,
    processing: row.processing,
    fundings: row.fundings,
  };
}

function toLeadSourceDisplayRow(row: LeaderboardLeadSourceRow): DisplayLeaderboardRow {
  return {
    id: row.leadSourceKey,
    label: row.leadSourceName,
    subLabel: 'Lead Source',
    source: 'leadSources',
    plusOne: row.plusOne,
    disclosures: row.disclosures,
    processing: row.processing,
    fundings: row.fundings,
  };
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  direction,
  align = 'center',
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  direction: SortDirection;
  align?: 'left' | 'center' | 'right';
  onSort: (key: SortKey) => void;
}) {
  const active = sortKey === activeKey;

  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={cx(
        'inline-flex items-center gap-1 rounded-md px-1 py-0.5 font-bold transition hover:bg-slate-100 hover:text-slate-700',
        align === 'center' && 'mx-auto',
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
        column.align === 'center' ? 'text-center' : column.align === 'right' ? 'text-right' : 'text-left',
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

function MilestoneGroupHeader({
  label,
  colSpan,
  tone,
}: {
  label: string;
  colSpan: number;
  tone: 'emerald' | 'blue' | 'purple' | 'amber';
}) {
  const tones = {
    emerald: {
      cell: 'border-emerald-100 bg-emerald-50/60',
      label: 'text-emerald-700',
      dot: 'bg-emerald-500',
    },
    blue: {
      cell: 'border-blue-100 bg-blue-50/60',
      label: 'text-blue-700',
      dot: 'bg-blue-500',
    },
    purple: {
      cell: 'border-purple-100 bg-purple-50/60',
      label: 'text-purple-700',
      dot: 'bg-purple-500',
    },
    amber: {
      cell: 'border-amber-100 bg-amber-50/60',
      label: 'text-amber-700',
      dot: 'bg-amber-500',
    },
  } satisfies Record<typeof tone, { cell: string; label: string; dot: string }>;
  const classes = tones[tone];

  return (
    <th colSpan={colSpan} className={cx('border-l px-3 py-2 text-center', classes.cell)}>
      <span className={cx('inline-flex items-center justify-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.16em]', classes.label)}>
        <span className={cx('h-2 w-2 rounded-full shadow-sm ring-2 ring-white', classes.dot)} />
        {label}
      </span>
    </th>
  );
}

function LeaderboardViewSwitch({
  view,
  onChange,
}: {
  view: LeaderboardView;
  onChange: (view: LeaderboardView) => void;
}) {
  return (
    <div className="inline-flex rounded-full border border-slate-200 bg-white p-1 shadow-sm shadow-slate-200/60">
      <button
        type="button"
        onClick={() => onChange('loanOfficers')}
        className={cx(
          'rounded-full px-3 py-1.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200',
          view === 'loanOfficers'
            ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-100'
            : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
        )}
      >
        Loan Officers
      </button>
      <button
        type="button"
        onClick={() => onChange('lenders')}
        className={cx(
          'rounded-full px-3 py-1.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200',
          view === 'lenders'
            ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-100'
            : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
        )}
      >
        Lenders
      </button>
      <button
        type="button"
        onClick={() => onChange('leadSources')}
        className={cx(
          'rounded-full px-3 py-1.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200',
          view === 'leadSources'
            ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-100'
            : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
        )}
      >
        Lead Source
      </button>
    </div>
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

function MetricCells({ row, metric }: { row: DisplayLeaderboardRow; metric: 'plusOne' | 'disclosures' | 'processing' | 'fundings' }) {
  const groupStartClass = 'border-l border-slate-200';
  const numberClass = 'overflow-hidden whitespace-nowrap px-4 py-4 text-center tabular-nums';
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

function TeamFilterChips({
  teams,
  selectedTeamIds,
  onSelectTeam,
}: {
  teams: LeaderboardReport['teams'];
  selectedTeamIds: Set<string>;
  onSelectTeam: (teamId: string | null) => void;
}) {
  if (teams.length === 0) return null;
  const hasSelectedTeams = selectedTeamIds.size > 0;

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto whitespace-nowrap pr-2 [scrollbar-width:thin]">
      <div className="mr-1 flex shrink-0 items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
        <Users2 className="h-3.5 w-3.5" />
        Teams
      </div>
      <button
        type="button"
        onClick={() => onSelectTeam(null)}
        className={cx(
          'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
          !hasSelectedTeams
            ? 'border-slate-300 bg-slate-100 text-slate-800 ring-1 ring-slate-300'
            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
        )}
      >
        All
      </button>
      {teams.map((team) => {
        const accent = team.colors?.[0] ?? team.color;
        const classes = teamColorClasses(accent);
        const isActive = selectedTeamIds.has(team.id);
        return (
          <button
            key={team.id}
            type="button"
            onClick={() => onSelectTeam(team.id)}
            className={cx(
              'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              isActive ? classes.chipActive : classes.chipInactive,
              isActive && `ring-1 ${classes.ring}`
            )}
            title={
              isActive
                ? `Showing ${team.name} members - click to remove team`
                : `Add ${team.name} members`
            }
          >
            {renderTeamDots(team.colors ?? [accent])}
            <span className="max-w-[150px] truncate">{team.name}</span>
            <span className="text-[10px] font-semibold tabular-nums opacity-70">
              {team.memberCount}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function LeaderboardPage({ initialReport }: Props) {
  const [report, setReport] = useState(initialReport);
  const [preset, setPreset] = useState<LeaderboardRangePreset>(initialReport.filters.preset);
  const [startDate, setStartDate] = useState(dateInputValue(initialReport.filters.startDate));
  const [endDate, setEndDate] = useState(dateInputValue(initialReport.filters.endDate));
  const [view, setView] = useState<LeaderboardView>('loanOfficers');
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [editingRow, setEditingRow] = useState<LeaderboardDetailRow | null>(null);
  const [isReportsOpen, setIsReportsOpen] = useState(false);
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

  const selectedTeamIdSet = useMemo(() => new Set(selectedTeamIds), [selectedTeamIds]);

  const selectedTeams = useMemo(
    () => report.teams.filter((team) => selectedTeamIdSet.has(team.id)),
    [report.teams, selectedTeamIdSet]
  );

  const selectedTeamMemberIds = useMemo(() => {
    if (selectedTeams.length === 0) return null;
    const memberIds = new Set<string>();
    for (const team of selectedTeams) {
      for (const memberId of team.memberIds) {
        memberIds.add(memberId);
      }
    }
    return memberIds;
  }, [selectedTeams]);

  const filteredRows = useMemo(() => {
    if (!selectedTeamMemberIds) return report.rows;
    return report.rows.filter((row) => selectedTeamMemberIds.has(row.loanOfficerId));
  }, [report.rows, selectedTeamMemberIds]);

  const activeRows = useMemo<DisplayLeaderboardRow[]>(() => {
    if (view === 'lenders') return report.lenderRows.map(toLenderDisplayRow);
    if (view === 'leadSources') return report.leadSourceRows.map(toLeadSourceDisplayRow);
    return filteredRows.map(toOfficerDisplayRow);
  }, [filteredRows, report.leadSourceRows, report.lenderRows, view]);

  const activeDetailRows = useMemo(() => {
    if (view === 'lenders' || view === 'leadSources') return report.detailRows;
    if (!selectedTeamMemberIds) return report.detailRows;
    return report.detailRows.filter((row) => selectedTeamMemberIds.has(row.creditedLoanOfficerId));
  }, [report.detailRows, selectedTeamMemberIds, view]);

  const visibleTotals = useMemo(() => ({
    plusOne: totalMetric(activeRows, 'plusOne'),
    disclosures: totalMetric(activeRows, 'disclosures'),
    processing: totalMetric(activeRows, 'processing'),
    fundings: totalMetric(activeRows, 'fundings'),
  }), [activeRows]);

  const sortedRows = useMemo(() => {
    const multiplier = sortMultiplier(sort.direction);
    return [...activeRows].sort((a, b) => {
      const aValue = sortValue(a, sort.key);
      const bValue = sortValue(b, sort.key);
      const primary =
        typeof aValue === 'string' && typeof bValue === 'string'
          ? compareText(aValue, bValue)
          : Number(aValue) - Number(bValue);
      if (primary !== 0) return primary * multiplier;
      return compareText(a.label, b.label);
    });
  }, [activeRows, sort.direction, sort.key]);

  const selectedRow = selectedRowId
    ? activeRows.find((row) => row.id === selectedRowId) || null
    : null;

  const selectedDetails = useMemo(() => {
    if (!selectedRowId) return [];
    if (view === 'lenders') {
      return activeDetailRows.filter((row) => row.lenderKey === selectedRowId);
    }
    if (view === 'leadSources') {
      return activeDetailRows.filter((row) => row.leadSourceKey === selectedRowId);
    }
    return activeDetailRows.filter((row) => row.creditedLoanOfficerId === selectedRowId);
  }, [activeDetailRows, selectedRowId, view]);

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

  function loadReport(
    nextFilters?: Partial<LeaderboardReportFilters>,
    options?: { preserveSelection?: boolean }
  ) {
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
        if (!options?.preserveSelection) {
          setSelectedRowId(null);
        }
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

  function handleTeamSelect(teamId: string | null) {
    setSelectedTeamIds((current) => {
      if (!teamId) return [];
      return current.includes(teamId)
        ? current.filter((id) => id !== teamId)
        : [...current, teamId];
    });
    setSelectedRowId(null);
  }

  function handleViewChange(nextView: LeaderboardView) {
    setView(nextView);
    setSelectedRowId(null);
    setEditingRow(null);
  }

  async function handleApplyEdit(input: LeaderboardEditInput) {
    const result = await updateLeaderboardLoanDetails(input);
    if (result.success) {
      setEditingRow(null);
      loadReport(undefined, { preserveSelection: true });
    }
    return result;
  }

  const teamFilterLabel =
    selectedTeams.length === 0
      ? 'Click a loan officer to view credited loans.'
      : selectedTeams.length === 1
        ? `${selectedTeams[0].name} members only.`
        : `${selectedTeams.length} teams selected.`;

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

      <div className="relative space-y-4" aria-busy={isPending}>
        {isPending && (
          <div
            className="absolute inset-0 z-40 flex items-center justify-center rounded-[28px] bg-white/70 backdrop-blur-[2px]"
            role="status"
            aria-live="polite"
          >
            <div className="inline-flex items-center gap-3 rounded-2xl border border-blue-100 bg-white px-5 py-4 text-sm font-bold text-slate-700 shadow-xl shadow-slate-200/70">
              <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
              Refreshing leaderboard
            </div>
          </div>
        )}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            title="+1 Volume"
            value={formatCurrency(visibleTotals.plusOne.volume)}
            subtitle={`${formatNumber(visibleTotals.plusOne.units)} units / ${formatCurrency(visibleTotals.plusOne.revenue)} revenue`}
            Icon={Home}
            tone="emerald"
          />
          <KpiCard
            title="Disclosure Volume"
            value={formatCurrency(visibleTotals.disclosures.volume)}
            subtitle={`${formatNumber(visibleTotals.disclosures.units)} submitted disclosures`}
            Icon={ClipboardCheck}
            tone="blue"
          />
          <KpiCard
            title="Processing/QC Volume"
            value={formatCurrency(visibleTotals.processing.volume)}
            subtitle={`${formatNumber(visibleTotals.processing.units)} units / ${formatCurrency(visibleTotals.processing.revenue)} revenue`}
            Icon={FileText}
            tone="purple"
          />
          <KpiCard
            title="Funding Volume"
            value={formatCurrency(visibleTotals.fundings.volume)}
            subtitle={`${formatNumber(visibleTotals.fundings.units)} units / ${formatCurrency(visibleTotals.fundings.revenue)} revenue`}
            Icon={CircleDollarSign}
            tone="amber"
          />
        </section>

        <div className="flex flex-wrap items-center justify-start gap-2">
          <LeaderboardViewSwitch view={view} onChange={handleViewChange} />
          {report.canEdit && (
            <button
              type="button"
              onClick={() => setIsReportsOpen(true)}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs font-extrabold text-slate-700 shadow-sm shadow-slate-200/60 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
            >
              <FileSpreadsheet className="h-4 w-4 text-blue-600" />
              Reports
            </button>
          )}
        </div>

        <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm shadow-slate-200/70">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-slate-950">
              <Medal className="h-5 w-5 text-amber-600" />
              Production leaderboard
            </h2>
            <p className="mt-1 text-sm font-medium text-slate-500">
              {formatDate(report.filters.startDate)} - {formatDate(report.filters.endDate)}. {
                view === 'lenders'
                  ? 'Click a lender to view submitted loans.'
                  : view === 'leadSources'
                    ? 'Click a lead source to view submitted loans.'
                  : teamFilterLabel
              }
            </p>
          </div>
          {view === 'loanOfficers' && (
            <TeamFilterChips
              teams={report.teams}
              selectedTeamIds={selectedTeamIdSet}
              onSelectTeam={handleTeamSelect}
            />
          )}
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={resetColumnWidths}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
              title="Reset leaderboard column widths"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset columns
            </button>
          </div>
        </div>

        <div className="overflow-x-hidden">
          <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              {LEADERBOARD_COLUMNS.map((column) => (
                <col
                  key={column.id}
                  style={{ width: `${(columnWidths[column.id] / tableWidth) * 100}%` }}
                />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-[1] bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <tr className="border-b border-slate-100">
                <ResizableHeaderCell
                  column={{
                    ...LEADERBOARD_COLUMNS[0],
                    label: view === 'lenders'
                      ? 'Lender'
                      : view === 'leadSources'
                        ? 'Lead Source'
                        : 'Loan Officer',
                  }}
                  activeKey={sort.key}
                  direction={sort.direction}
                  onSort={updateSort}
                  onStartResize={startResize('loanOfficerName', LEADERBOARD_COLUMNS[0].minWidth)}
                  isResizing={resizingCol === 'loanOfficerName'}
                  rowSpan={2}
                />
                <MilestoneGroupHeader label="+1s" colSpan={3} tone="emerald" />
                <MilestoneGroupHeader label="Disclosures" colSpan={2} tone="blue" />
                <MilestoneGroupHeader label="Submitted to Processing/QC" colSpan={3} tone="purple" />
                <MilestoneGroupHeader label="Fundings" colSpan={3} tone="amber" />
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
                const isStriped = index % 2 === 1;
                const rowSurface = isStriped ? 'bg-slate-50/55' : 'bg-white';
                const stickySurface = isStriped ? 'bg-slate-50' : 'bg-white';
                return (
                <tr key={`${row.source}:${row.id}`} className={cx(rowSurface, 'transition-colors hover:bg-blue-50/40')}>
                  <td className={cx('sticky left-0 z-[1] overflow-hidden px-4 py-4 shadow-[1px_0_0_#e2e8f0]', stickySurface)}>
                    <button
                      type="button"
                      onClick={() => setSelectedRowId(row.id)}
                      className="flex w-full min-w-0 items-center gap-3 rounded-xl text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                    >
                      <span className={rankBadgeClassName(index)}>
                        {index + 1}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-bold text-slate-950">{row.label}</span>
                        <span className="block truncate text-xs font-medium text-slate-500">
                          {row.subLabel}
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
                    {view === 'lenders'
                      ? 'No lenders are available for this leaderboard.'
                      : view === 'leadSources'
                        ? 'No lead sources are available for this leaderboard.'
                      : selectedTeams.length > 0
                        ? 'No loan officers are assigned to the selected teams.'
                        : 'No loan officers are available for this leaderboard.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </section>
      </div>

      {isReportsOpen && (
        <LeaderboardReportsModal
          report={report}
          onClose={() => setIsReportsOpen(false)}
        />
      )}
      {selectedRow && (
        <OfficerDetailsModal
          entity={selectedRow}
          rows={selectedDetails}
          rangeLabel={`${formatDate(report.filters.startDate)} - ${formatDate(report.filters.endDate)}`}
          canEdit={report.canEdit}
          onEditRow={setEditingRow}
          onClose={() => setSelectedRowId(null)}
        />
      )}
      {editingRow && (
        <LeaderboardEditModal
          row={editingRow}
          loanOfficerOptions={report.loanOfficerOptions}
          onApply={handleApplyEdit}
          onClose={() => setEditingRow(null)}
        />
      )}
    </div>
  );
}

function LeaderboardReportsModal({
  report,
  onClose,
}: {
  report: LeaderboardReport;
  onClose: () => void;
}) {
  function handleLoanOfficerExport() {
    exportLoanOfficerLeaderboard(report);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/45 p-4"
      onClick={onClose}
      data-live-refresh-pause="true"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Leaderboard reports"
        className="w-full max-w-xl overflow-hidden rounded-[28px] border border-slate-200/70 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-5 border-b border-slate-200/70 px-6 py-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">Admin reports</p>
            <h2 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">
              Export Reports
            </h2>
            <p className="mt-1 text-sm font-medium text-slate-500">
              Choose which leaderboard report to pull for the selected date range.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 transition hover:bg-slate-50 hover:text-slate-600 hover:shadow-sm"
            aria-label="Close reports"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3 bg-slate-50 px-6 py-5">
          <button
            type="button"
            onClick={handleLoanOfficerExport}
            className="group flex w-full items-start gap-4 rounded-2xl border border-blue-100 bg-white p-4 text-left shadow-sm shadow-slate-200/60 transition hover:border-blue-200 hover:bg-blue-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-100 text-blue-700 ring-1 ring-blue-200 transition group-hover:bg-blue-600 group-hover:text-white">
              <FileSpreadsheet className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-extrabold text-slate-950">
                Loan Officer Leaderboard Export
              </span>
              <span className="mt-1 block text-sm font-medium text-slate-500">
                Downloads the full Production Leaderboard for loan officers with colored grouped headers, totals, and Excel formatting.
              </span>
              <span className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-blue-700">
                <Download className="h-3.5 w-3.5" />
                Export Excel sheet
              </span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function OfficerDetailsModal({
  entity,
  rows,
  rangeLabel,
  canEdit,
  onEditRow,
  onClose,
}: {
  entity: DisplayLeaderboardRow;
  rows: LeaderboardDetailRow[];
  rangeLabel: string;
  canEdit: boolean;
  onEditRow: (row: LeaderboardDetailRow) => void;
  onClose: () => void;
}) {
  const [selectedMilestone, setSelectedMilestone] = useState<LeaderboardMilestoneKey | null>(null);
  const visibleRows = useMemo(
    () => selectedMilestone
      ? rows.filter((row) => row.milestone === selectedMilestone)
      : rows,
    [rows, selectedMilestone]
  );
  const selectedMilestoneLabel = selectedMilestone ? DETAIL_MILESTONE_LABELS[selectedMilestone] : null;

  function toggleMilestone(milestone: LeaderboardMilestoneKey) {
    setSelectedMilestone((current) => current === milestone ? null : milestone);
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/45 p-4"
      onClick={onClose}
      data-live-refresh-pause="true"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${entity.label} leaderboard details`}
        className="max-h-[90vh] w-full max-w-6xl overflow-hidden rounded-[28px] border border-slate-200/70 bg-slate-50 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-6 border-b border-slate-200/70 bg-white px-6 py-5">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 text-lg font-extrabold text-white shadow-lg shadow-blue-600/20 ring-4 ring-white">
              {initials(entity.label)}
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-2xl font-extrabold tracking-tight text-slate-950">
                {entity.label}
              </h2>
              <p className="mt-1 text-sm font-medium text-slate-500">
                {entity.subLabel} / {rangeLabel}
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
          <MiniMetric
            tone="plusOne"
            title="+1s"
            value={formatCurrency(entity.plusOne.volume)}
            detail={`${formatNumber(entity.plusOne.units)} units`}
            selected={selectedMilestone === 'plusOne'}
            onClick={() => toggleMilestone('plusOne')}
          />
          <MiniMetric
            tone="disclosures"
            title="Disclosures"
            value={formatCurrency(entity.disclosures.volume)}
            detail={`${formatNumber(entity.disclosures.units)} units`}
            selected={selectedMilestone === 'disclosures'}
            onClick={() => toggleMilestone('disclosures')}
          />
          <MiniMetric
            tone="processing"
            title="Processing/QC"
            value={formatCurrency(entity.processing.volume)}
            detail={`${formatNumber(entity.processing.units)} units`}
            selected={selectedMilestone === 'processing'}
            onClick={() => toggleMilestone('processing')}
          />
          <MiniMetric
            tone="fundings"
            title="Fundings"
            value={formatCurrency(entity.fundings.volume)}
            detail={`${formatNumber(entity.fundings.units)} units`}
            selected={selectedMilestone === 'fundings'}
            onClick={() => toggleMilestone('fundings')}
          />
        </div>

        <div className="max-h-[56vh] overflow-auto">
          <table className="w-full min-w-[1040px] text-sm">
            <thead className="sticky top-0 z-[1] bg-slate-100 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3 text-left">Loan</th>
                <th className="px-5 py-3 text-center">Milestone</th>
                <th className="px-5 py-3 text-right">Volume</th>
                <th className="px-5 py-3 text-right">Revenue</th>
                <th className="px-5 py-3 text-left">Details</th>
                <th className="px-5 py-3 text-right">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleRows.map((row, index) => {
                const isStriped = index % 2 === 1;
                return (
                <tr
                  key={`${row.milestone}:${row.id}`}
                  className={cx(
                    isStriped ? 'bg-slate-50/55' : 'bg-white',
                    'transition-colors hover:bg-blue-50/40'
                  )}
                >
                  <td className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-bold text-slate-950">{row.borrowerName}</p>
                        <p className="mt-1 font-mono text-xs font-semibold text-slate-500">{row.loanNumber}</p>
                      </div>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => onEditRow(row)}
                          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-600 shadow-sm transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                          Edit
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-4 text-center">
                    <span className={cx('inline-flex max-w-[150px] items-center justify-center rounded-full border px-3 py-1 text-center text-xs font-bold leading-tight', MILESTONE_TONES[row.milestone])}>
                      {row.milestoneLabel}
                    </span>
                    <p className="mt-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">{formatStatus(row.status)}</p>
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 text-right font-bold tabular-nums text-slate-900">
                    {formatCurrency(row.amount)}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 text-right tabular-nums text-slate-600">
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
                  <td className="whitespace-nowrap px-5 py-4 text-right text-xs font-semibold text-slate-500">
                    {formatDateTime(row.occurredAt)}
                  </td>
                </tr>
                );
              })}
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-sm text-slate-500">
                    {selectedMilestoneLabel
                      ? `No ${selectedMilestoneLabel} loans matched this selection.`
                      : 'No credited loans matched this selection for the selected range.'}
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

function LeaderboardEditModal({
  row,
  loanOfficerOptions,
  onApply,
  onClose,
}: {
  row: LeaderboardDetailRow;
  loanOfficerOptions: LeaderboardLoanOfficerOption[];
  onApply: (input: LeaderboardEditInput) => Promise<{ success: boolean; error?: string }>;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    borrowerName: row.borrowerName || '',
    loanNumber: row.loanNumber || '',
    primaryLoanOfficerId: row.primaryLoanOfficerId || '',
    secondaryLoanOfficerId: row.secondaryLoanOfficerId || '',
    loanAmount: moneyInputValue(row.amount),
    revenue: moneyInputValue(row.revenue),
    lender: row.lender || '',
    leadSource: row.leadSource || '',
    reason: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();
  const tracksRevenue =
    row.milestone === 'plusOne' || row.milestone === 'processing' || row.milestone === 'fundings';

  function updateField(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleApply() {
    if (!window.confirm('Are you sure you want to apply these changes?')) return;
    setError(null);
    startSaving(async () => {
      const result = await onApply({
        id: row.id,
        milestone: row.milestone,
        loanId: row.loanId,
        borrowerName: form.borrowerName,
        loanNumber: form.loanNumber,
        primaryLoanOfficerId: form.primaryLoanOfficerId,
        secondaryLoanOfficerId: form.secondaryLoanOfficerId || null,
        loanAmount: form.loanAmount,
        revenue: form.revenue,
        lender: form.lender,
        leadSource: form.leadSource,
        reason: form.reason,
      });
      if (!result.success) {
        setError(result.error || 'Unable to apply changes.');
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/50 p-4"
      onClick={onClose}
      data-live-refresh-pause="true"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${row.borrowerName} leaderboard details`}
        className="max-h-[92vh] w-full max-w-3xl overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-6 border-b border-slate-200 px-6 py-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">Admin edit</p>
            <h3 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950">
              Edit Loan Details
            </h3>
            <p className="mt-1 text-sm font-medium text-slate-500">
              {row.milestoneLabel} / {row.borrowerName} / {row.loanNumber}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 transition hover:bg-slate-50 hover:text-slate-600 hover:shadow-sm"
            aria-label="Close edit loan details"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[62vh] overflow-auto px-6 py-5">
          <div className="grid gap-4 md:grid-cols-2">
            <EditField
              label="Borrower name"
              value={form.borrowerName}
              onChange={(value) => updateField('borrowerName', value)}
            />
            <EditField
              label="Loan number"
              value={form.loanNumber}
              onChange={(value) => updateField('loanNumber', value)}
            />
            <EditSelect
              label="Primary LO"
              value={form.primaryLoanOfficerId}
              onChange={(value) => updateField('primaryLoanOfficerId', value)}
            >
              <option value="">Select Primary LO</option>
              {loanOfficerOptions.map((officer) => (
                <option key={officer.id} value={officer.id}>
                  {officer.name} ({officer.email})
                </option>
              ))}
            </EditSelect>
            <EditSelect
              label="Secondary LO"
              value={form.secondaryLoanOfficerId}
              onChange={(value) => updateField('secondaryLoanOfficerId', value)}
            >
              <option value="">N/A</option>
              {loanOfficerOptions.map((officer) => (
                <option key={officer.id} value={officer.id}>
                  {officer.name} ({officer.email})
                </option>
              ))}
            </EditSelect>
            <EditField
              label="Loan amount"
              value={form.loanAmount}
              onChange={(value) => updateField('loanAmount', value)}
              inputMode="decimal"
              placeholder="450000"
            />
            <EditField
              label={tracksRevenue ? 'Revenue' : 'Revenue (not tracked)'}
              value={form.revenue}
              onChange={(value) => updateField('revenue', value)}
              inputMode="decimal"
              placeholder="12000"
              disabled={!tracksRevenue}
            />
            <EditField
              label="Lender"
              value={form.lender}
              onChange={(value) => updateField('lender', value)}
            />
            <EditSelect
              label="Lead source"
              value={form.leadSource}
              onChange={(value) => updateField('leadSource', value)}
            >
              <option value="">Select lead source</option>
              {LEAD_SOURCE_EDIT_OPTIONS.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
              {form.leadSource && !LEAD_SOURCE_EDIT_OPTIONS.includes(form.leadSource) && (
                <option value={form.leadSource}>{form.leadSource}</option>
              )}
            </EditSelect>
            <div className="md:col-span-2">
              <EditField
                label="Reason / note for audit log"
                value={form.reason}
                onChange={(value) => updateField('reason', value)}
                placeholder="Optional context for this correction"
              />
            </div>
          </div>
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
            Applying this will update the source loan details and the selected leaderboard source row, then write an audit log.
          </div>
          {error && (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={isSaving}
            className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-5 py-2 text-sm font-extrabold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
  inputMode,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode={inputMode}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 shadow-sm outline-none transition placeholder:text-slate-300 focus:border-blue-300 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-400"
      />
    </label>
  );
}

function EditSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 shadow-sm outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-100"
      >
        {children}
      </select>
    </label>
  );
}

function MiniMetric({
  title,
  value,
  detail,
  tone,
  selected,
  onClick,
}: {
  title: string;
  value: string;
  detail: string;
  tone: 'plusOne' | 'disclosures' | 'processing' | 'fundings';
  selected: boolean;
  onClick: () => void;
}) {
  const classes = MODAL_METRIC_TONES[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cx(
        'rounded-2xl border px-4 py-3 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200',
        selected ? classes.activeCard : classes.card
      )}
      title={selected ? `Showing ${title} loans - click to clear filter` : `Show only ${title} loans`}
    >
      <p className={cx('text-[11px] font-bold uppercase tracking-[0.14em]', selected ? classes.activeLabel : classes.label)}>{title}</p>
      <p className={cx('mt-1 text-lg font-bold', selected ? classes.activeValue : classes.value)}>{value}</p>
      <p className={cx('mt-0.5 text-xs font-medium', selected ? classes.activeDetail : 'text-slate-500')}>{detail}</p>
    </button>
  );
}
